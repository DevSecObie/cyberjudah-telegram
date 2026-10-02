import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { data } from "@/api/data";
import { advance, planDay } from "@/lib/plan";
import { markRead, useLast, usePlan, useProgress } from "@/lib/marks";
import {
  ackReminder, currentEndpoint, currentSubscription, forgetReminder, getReminder, hasDevice, linkLink, PAUSE_FOREVER, pushState, saveReminder, subscribePush, timeLabel, timeZone, unsubscribePush,
  type Channels, type Content, type PushState, type ReminderView,
} from "@/lib/reminders";
import { useBackButton, useStored } from "@/tg/hooks";
import { alert, app, confirm, haptic, openLink, requestWriteAccess } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Icon, List, Row, Screen, Section } from "@/ui/ui";

/**
 * Reading reminders, after Bible Strong's reminder settings (ReminderSettings.tsx): a switch,
 * the time, and where it is delivered, with what each choice means where the reader is now.
 * Off until the reader turns it on.
 */

const FALLBACK = "Push stopped working on this device. We sent your reminder to Telegram instead. Turn push on again?";

type Delivery = "telegram" | "push" | "both";
const deliveryOf = (c: Channels): Delivery | null => (c.telegram && c.push ? "both" : c.telegram ? "telegram" : c.push ? "push" : null);
const channelsOf = (d: Delivery): Channels => ({ telegram: d !== "push", push: d !== "telegram" });

/** The reader's place, as the reminder needs it: the plan's day and pace, and the last chapter. */
function useContent(): Content | null {
  const [plan, , planLoaded] = usePlan();
  const [last, , lastLoaded] = useLast();
  if (!planLoaded || !lastLoaded) return null;
  return { plan: plan ? { day: plan.day, perDay: plan.perDay } : null, last: last ? { slug: last.slug, chapter: last.chapter } : null };
}

/** A browser linked to Telegram reminds from the Telegram app's plan, so only the Telegram app (or an unlinked browser) sends its place. */
const sendsContent = (v: ReminderView | null) => !!app || !v?.linked;

function Choice({ checked, disabled, onPick, title, children }: { checked: boolean; disabled?: boolean; onPick: () => void; title: string; children?: React.ReactNode }) {
  return (
    <div className="remind-choice" data-disabled={disabled ? "" : undefined}>
      <button type="button" role="radio" aria-checked={checked} disabled={disabled} className="toggle" onClick={() => { haptic("select"); onPick(); }}>
        <span><b>{title}</b></span>
        {checked ? <Icon name="check" size={20} /> : <span className="remind-choice__dot" aria-hidden="true" />}
      </button>
      {children ? <div className="remind-choice__why">{children}</div> : null}
    </div>
  );
}

export function Reminders() {
  useBackButton(true);
  const sheet = useSheet();
  const content = useContent();
  const [plan] = usePlan();
  const [last] = useLast();
  const [progress] = useProgress();
  const [, setEnabled] = useStored("remind", false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [view, setView] = useState<ReminderView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsBot, setNeedsBot] = useState(false);
  const [declined, setDeclined] = useState(false);
  /** The browser's permission prompt was closed without an answer: it can be asked again. */
  const [dismissed, setDismissed] = useState(false);
  const [notice, setNotice] = useState(false);
  const [here, setHere] = useState<string | null>(null);
  const [pickDate, setPickDate] = useState(false);
  useEffect(() => { void currentEndpoint().then(setHere); }, []);

  useEffect(() => {
    void getReminder().then((v) => {
      setView(v);
      // The fallback notice is shown here once, then cleared.
      if (v.notice === "push-fallback") { setNotice(true); void saveReminder({ notice: false }).catch(() => undefined); }
    }).catch(() => setFailed(true));
  }, []);

  const push: PushState = pushState(view?.publicKey ?? null);
  const pushOk = (push === "ask" || push === "granted") && !declined;
  const delivery = view ? deliveryOf(view.channels) : null;
  /** Whether this browser is one of the reader's push devices. */
  const herePushed = !!here && !!view?.pushEndpoints.includes(here);
  const todayKey = new Date().toLocaleDateString("en-CA");
  const pausedNow = !!view?.pausedUntil && view.pausedUntil > todayKey;
  const maxDate = new Date(Date.now() + 366 * 86400000).toLocaleDateString("en-CA");
  const botStarted = app ? !needsBot : !!view?.telegramLinked;

  const save = async (settings: Parameters<typeof saveReminder>[0]["settings"], extra: Partial<Parameters<typeof saveReminder>[0]> = {}) => {
    setBusy(true);
    try {
      const v = await saveReminder({ settings: { tz: timeZone(), ...settings }, ...(content && sendsContent(view) ? { content } : {}), ...extra });
      setView(v);
      setEnabled(v.on);
      haptic("success");
      return v;
    } catch {
      haptic("error");
      void alert("Could not save the reminder right now. Try again in a moment.");
      return null;
    } finally { setBusy(false); }
  };

  /** Telegram inside Telegram needs the bot allowed to write; in a browser, the bot's chat linked. */
  const telegramReady = async (): Promise<boolean> => {
    if (app) { const ok = await requestWriteAccess(); setNeedsBot(!ok); return ok; }
    return true;
  };
  const startBot = async () => {
    if (app) { if (await requestWriteAccess()) setNeedsBot(false); return; }
    try {
      // The browser needs a record of its own before it can be linked.
      if (!hasDevice()) await saveReminder({ settings: { tz: timeZone() } });
      const { link } = await linkLink();
      openLink(link);
    } catch { void alert("Could not reach the bot right now. Try again in a moment."); }
  };

  const choose = async (d: Delivery, turnOn = false) => {
    if (!view) return;
    const want = channelsOf(d);
    let sub: PushSubscriptionJSON | undefined;
    // Each browser subscribes for itself; a reader can have several (bot/src/reminders.mjs PUSH_DEVICES).
    if (want.push && !herePushed && !app) {
      if (!pushOk || !view.publicKey) return;
      const r = await subscribePush(view.publicKey);
      setDismissed(r === "dismissed");
      if (r === "denied") { setDeclined(true); haptic("error"); return; }
      if (r === "dismissed") return;
      if (r === "failed") { void alert("This browser could not turn on push notifications."); return; }
      sub = r;
      if (sub.endpoint) setHere(sub.endpoint);
    }
    if (want.telegram && !(await telegramReady())) return;
    // Push turned off here: this browser lets go of its subscription; others the reader has stay.
    const leaving = !want.push && herePushed ? here! : undefined;
    if (leaving) { await unsubscribePush(); setHere(null); }
    await save({ channels: want, ...(turnOn ? { on: true } : {}) }, sub ? { push: sub } : leaving ? { pushRemove: leaving } : {});
  };

  const toggle = async (on: boolean) => {
    if (!view) return;
    if (!on) { await save({ on: false }); return; }
    const d = delivery ?? (app || !pushOk ? "telegram" : "push");
    await choose(d, true);
  };

  /** The time in two steps, hour then quarter hour, in the reader's own time zone. */
  const pickTime = async () => {
    const h = await sheet.open({ title: "When should the reminder come?", items: Array.from({ length: 24 }, (_, n) => ({ id: String(n), text: `${n}:00 – ${n}:45` })) });
    if (!h) return;
    const m = await sheet.open({ title: "At", items: [0, 15, 30, 45].map((n) => ({ id: String(n), text: timeLabel(+h.id, n) })) });
    if (m) await save({ hour: +h.id, minute: +m.id });
  };
  /** Pause: until tomorrow, a week, a chosen date, or until resumed. */
  const pickPause = async () => {
    const a = await sheet.open({ title: "Pause reminders", items: [{ id: "1", text: "Until tomorrow" }, { id: "7", text: "For a week" }, { id: "date", text: "Until a date…" }, { id: "forever", text: "Until I resume" }] });
    if (!a) return;
    if (a.id === "date") { setPickDate(true); return; }
    await save(a.id === "forever" ? { paused: true, pauseUntil: "forever" } : { paused: true, pauseDays: +a.id });
  };
  const forget = async () => {
    const ok = await confirm(app ? "Delete your reading reminder and everything it keeps?" : "Forget this browser? Its reminders and push notifications stop here.");
    if (!ok) return;
    try {
      if (herePushed) await unsubscribePush();
      await forgetReminder(here);
      setHere(null); setEnabled(false);
      setView(await getReminder());
      haptic("success");
    } catch { void alert("Could not reach the server right now. Try again in a moment."); }
  };

  const today = plan && books.data ? planDay(plan, books.data, progress) : null;
  const about = today && today.chapters.length ? `Today's reading: day ${today.day + 1} of your plan, ${today.label}` : last ? `Continue where you left off: ${last.name}` : "Start the reading plan or read a chapter, and the reminder will take you back to it.";

  const pushWhy = (() => {
    if (push === "telegram") return <p>Push notifications aren't available inside Telegram. Open CyberJudah in your browser at cyberjudah.io/app to turn them on.</p>;
    if (push === "ios-browser") return <>
      <p>On iPhone, push works only after you add CyberJudah to your Home Screen (Share → Add to Home Screen, iOS 16.4 or later)</p>
      <ol className="remind-howto"><li>Open cyberjudah.io/app in Safari.</li><li>Tap Share, then Add to Home Screen.</li><li>Open CyberJudah from your Home Screen and come back here.</li></ol>
    </>;
    if (push === "denied" || declined) return <p>Notifications are blocked for this site. You can allow them in your browser settings.</p>;
    if (push === "unsupported") return <p>This browser can't receive push notifications.</p>;
    if (push === "no-server") return <p>Push notifications aren't set up yet.</p>;
    if (push === "ask" && !herePushed && dismissed) return <p>The browser's question was closed without an answer. Choose Push notification again to be asked.</p>;
    if (push === "ask" && !herePushed) return <p>Your browser will ask permission next.</p>;
    return null;
  })();
  const botWhy = <>
    <p>Sent by @CyberJudah_bot in your Telegram chat. Works on every device.</p>
    {!botStarted && (delivery === "telegram" || delivery === "both" || needsBot) ? <div className="remind-start"><p>Start the bot first so it can message you</p><button type="button" className="btn btn--quiet" onClick={() => void startBot()}>Start the bot</button></div> : null}
  </>;

  return (
    <Screen title="Reading reminders">
      {notice ? (
        <div className="remind-notice surface" role="status">
          <p>{FALLBACK}</p>
          <div className="btn--row">
            <button type="button" className="btn" disabled={!pushOk} onClick={() => { setNotice(false); void choose("both"); }}>Turn push on</button>
            <button type="button" className="btn btn--quiet" onClick={() => setNotice(false)}>Not now</button>
          </div>
        </div>
      ) : null}
      {failed ? <p className="hint" role="status">Reminders can't be reached right now. Try again when you're connected.</p> : null}
      <Section>
        <List>
          <button type="button" className="toggle" role="switch" aria-checked={!!view?.on} disabled={!view || busy} onClick={() => { haptic("select"); void toggle(!view?.on); }}>
            <span><b>Remind me to read</b><small>{!view ? "Checking…" : view.on ? `Every day at ${timeLabel(view.hour, view.minute)}` : "Off"}</small></span><span className="switch" />
          </button>
          <Row onClick={() => void pickTime()} title="Time" sub={`In your time zone${view ? ` (${view.tz})` : ""}`} trailing={<span className="row__value">{timeLabel(view?.hour ?? 7, view?.minute ?? 0)}<Icon name="chevron" size={16} /></span>} />
          {view?.on ? (
            pausedNow ? <Row onClick={() => void save({ paused: false })} title="Paused" sub={`${view.pausedUntil === PAUSE_FOREVER ? "Until you resume" : `Until ${view.pausedUntil}`} · tap to resume`} />
              : <Row onClick={() => void pickPause()} title="Pause" sub="Until tomorrow, for a week, until a date, or until you resume" />
          ) : null}
        </List>
        {pickDate ? (
          <div className="remind-date surface">
            <label htmlFor="remind-until">Pause until</label>
            <input id="remind-until" type="date" min={new Date(Date.now() + 86400000).toLocaleDateString("en-CA")} max={maxDate} onChange={(e) => { const v = e.target.value; if (v) { setPickDate(false); void save({ paused: true, pauseUntil: v }); } }} />
            <button type="button" className="btn btn--quiet" onClick={() => setPickDate(false)}>Cancel</button>
          </div>
        ) : null}
        <p className="hint">{about}</p>
      </Section>
      <Section title="Where to remind you">
        <div role="radiogroup" aria-label="Where to remind you" className="remind-choices list">
          <Choice title="Telegram" checked={delivery === "telegram"} disabled={!view || busy} onPick={() => void choose("telegram")}>{botWhy}</Choice>
          <Choice title="Push notification" checked={delivery === "push"} disabled={!view || busy || (!pushOk && !herePushed)} onPick={() => void choose("push")}>{pushWhy}</Choice>
          <Choice title="Both" checked={delivery === "both"} disabled={!view || busy || (!pushOk && !herePushed)} onPick={() => void choose("both")}>
            <p>You'll get one reminder in each place. Marking it Done in either one clears both.</p>
          </Choice>
        </div>
      </Section>
      {view && (view.on || view.pushEndpoints.length || hasDevice() || view.telegramLinked) ? (
        <List><Row title={app ? "Delete my reading reminder" : "Forget this browser"} sub={app ? "Removes the reminder and every browser it reaches" : "Removes this browser's reminders and push notifications"} onClick={() => void forget()} /></List>
      ) : null}
      <p className="hint">The reminder names the chapters to read, with Open to go straight to them and Done to mark them read. It never sends the text itself.</p>
    </Screen>
  );
}

/**
 * Keeps the reminder in step with the reader, on every open: chapters marked Done from a
 * reminder are marked read here (and the plan moves on), the reader's place is sent, and the
 * push fallback notice is shown once.
 */
export function ReminderSync() {
  const [enabled, , enabledLoaded] = useStored("remind", false);
  const [plan, setPlan, planLoaded] = usePlan();
  const [progress, setProgress, progressLoaded] = useProgress();
  const [last, , lastLoaded] = useLast();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity, enabled: enabled || hasDevice() });
  const [notice, setNotice] = useState(false);
  const linked = useRef<boolean | null>(null);
  const synced = useRef(false);
  const navigate = useNavigate();
  const ready = enabledLoaded && planLoaded && progressLoaded && lastLoaded && !!books.data && (enabled || hasDevice());

  // Once per open: apply Done from the reminders, then send the place.
  useEffect(() => {
    if (!ready || synced.current) return;
    synced.current = true;
    void (async () => {
      const v = await getReminder().catch(() => null);
      if (!v?.ok) return;
      linked.current = !!v.linked;
      let p = plan, prog = progress;
      for (const done of v.pending) {
        for (const c of done.chapters) prog = markRead(prog, c.slug, c.chapter);
        if (p && done.day === p.day && planDay(p, books.data!, prog).done) p = advance(p, done.date);
      }
      if (v.pending.length) { setProgress(prog); if (p !== plan) setPlan(p); await ackReminder(v.pending.map((x) => x.date)).catch(() => undefined); }
      // This browser's push subscription is sent again on every open, so a renewed one is never missed.
      const sub = !app && v.channels.push ? await currentSubscription() : null;
      if (app || !v.linked || sub) await saveReminder({ ...(app || !v.linked ? { content: { plan: p ? { day: p.day, perDay: p.perDay } : null, last: last ? { slug: last.slug, chapter: last.chapter } : null } } : {}), ...(sub ? { push: sub } : {}) }).catch(() => undefined);
      // The fallback notice, once on the next open (Settings also shows it once).
      try {
        if (v.notice === "push-fallback" && localStorage.getItem("cj:remind-notice") !== "seen") { localStorage.setItem("cj:remind-notice", "seen"); setNotice(true); }
        if (!v.notice) localStorage.removeItem("cj:remind-notice");
      } catch { /* storage blocked: the Settings screen still shows it */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Afterwards, a change of place (a plan day done, another chapter read) is sent.
  const placeKey = `${plan?.day ?? "-"}/${plan?.perDay ?? "-"}/${last?.slug ?? "-"}/${last?.chapter ?? "-"}`;
  const firstKey = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !synced.current) return;
    if (firstKey.current === null) { firstKey.current = placeKey; return; }
    if (firstKey.current === placeKey || (!app && linked.current)) return;
    firstKey.current = placeKey;
    const t = window.setTimeout(() => void saveReminder({ content: { plan: plan ? { day: plan.day, perDay: plan.perDay } : null, last: last ? { slug: last.slug, chapter: last.chapter } : null } }).catch(() => undefined), 1500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, placeKey]);

  if (!notice) return null;
  return (
    <div className="toasts remind-toast">
      <div className="toast" role="status">
        <span className="toast__icon" aria-hidden="true"><Icon name="info" size={18} /></span>
        <span className="toast__text">{FALLBACK}</span>
        <button type="button" className="btn btn--quiet remind-toast__go" onClick={() => { setNotice(false); navigate("/settings/reminders"); }}>Turn on</button>
        <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => setNotice(false)}><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
}
