import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { data } from "@/api/data";
import { offlineSupported, removeBook, saveBook, savedBooks } from "@/lib/offline";
import { useBackButton, useStored, useTheme } from "@/tg/hooks";
import { alert, api, app, features, haptic, openInvoice, platform, requestWriteAccess, setFullscreen, lockPortrait } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { useSheet } from "@/ui/sheet";
import { Icon, List, Row, Screen, Section, Segmented } from "@/ui/ui";
import { useRelationsDisplay } from "@/lib/relations";

/** A setting's current value, iOS style: quiet text before the chevron. */
function Value({ children }: { children: string }) {
  return <span className="row__value">{children}<Icon name="chevron" size={16} /></span>;
}

function Toggle({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return <button type="button" className="toggle" role="switch" aria-checked={on} onClick={() => { haptic("select"); onChange(!on); }}><span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><span className="switch" /></button>;
}

export type Theme = "dark" | "sepia" | "light" | "system";
export type Font = "serif" | "sans";
export type Spacing = "tight" | "regular" | "airy";

export function Settings() {
  useBackButton(false);
  const sheet = useSheet();
  const [size, setSize] = useStored<"compact" | "regular" | "large">("size", "regular");
  const [theme, setTheme] = useStored<Theme>("theme", "system");
  const [font, setFont] = useStored<Font>("font", "serif");
  const [spacing, setSpacing] = useStored<Spacing>("spacing", "regular");
  const [justify, setJustify] = useStored("justify", false);
  const [relDisplay, setRelDisplay] = useRelationsDisplay();
  const [fullscreen, setFs, fsLoaded] = useStored("fullscreen", true);
  const [portrait, setPortrait] = useStored("portrait", false);
  const [daily, setDaily] = useState<boolean | null>(null);
  const [me, setMe] = useState<{ user: { id: number }; admin?: boolean; canEdit?: boolean } | null>(null);
  const [hour, setHour] = useStored("daily-hour", 8);
  const [lock, setLock] = useState(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState<{ slug: string; pct: number } | null>(null);
  useEffect(() => { void api<{ subscribed: boolean; user: { id: number }; admin?: boolean; canEdit?: boolean }>("/api/me").then((m) => { setDaily(m.subscribed); setMe(m); }).catch(() => setDaily(false)); void secure.get("lock").then((v) => setLock(v === "on")); void savedBooks().then(setSaved); }, []);
  useEffect(() => { if (!fsLoaded) return; setFullscreen(fullscreen); try { localStorage.setItem("cj:fullscreen", fullscreen ? "on" : "off"); } catch { /* private mode */ } }, [fullscreen, fsLoaded]);
  useEffect(() => { lockPortrait(portrait); }, [portrait]);

  const subscribe = async (on: boolean, h = hour) => {
    if (on && !(await requestWriteAccess())) { void alert("Telegram needs permission for the bot to message you. Try again and allow it."); return; }
    try { const r = await api<{ subscribed: boolean }>("/api/subscribe", { method: "POST", json: { on, hour: h, tz: -new Date().getTimezoneOffset() } }); setDaily(r.subscribed); haptic(r.subscribed ? "success" : "tap"); }
    catch { void alert("Could not update the daily verse right now."); }
  };
  const pickHour = async () => {
    const a = await sheet.open({ title: "When should the verse arrive?", items: [6, 7, 8, 9, 12, 18, 20, 21].map((h) => ({ id: String(h), text: `${h}:00` })) });
    if (a) { setHour(+a.id); if (daily) void subscribe(true, +a.id); }
  };
  const toggleLock = async (on: boolean) => {
    const bm = app!.BiometricManager;
    const finish = () => { if (!bm.isBiometricAvailable) { void alert("This device has no biometrics set up."); return; } bm.requestAccess({ reason: "Lock CyberJudah with your fingerprint or face" }, (ok) => { if (!ok) return; secure.set("lock", on ? "on" : null); setLock(on); haptic("success"); }); };
    if (bm.isInited) finish(); else bm.init(finish);
  };
  const support = async (stars: number) => {
    try { const { link } = await api<{ link: string }>("/api/invoice", { method: "POST", json: { stars } }); const s = await openInvoice(link); if (s === "paid") { haptic("success"); void alert("Thank you. Your support keeps the library free."); } }
    catch { void alert("Support through Stars is not set up yet."); }
  };
  const offline = async () => {
    const list = books.data ?? [];
    const a = await sheet.open({ title: "Save a book for offline reading", items: list.filter((b) => !saved.includes(b.slug)).map((b) => ({ id: b.slug, text: b.book, hint: `${b.chapters} chapters` })) });
    const b = a && list.find((x) => x.slug === a.id);
    if (!b) return;
    setSaving({ slug: b.slug, pct: 0 });
    await saveBook(b, (d, t) => setSaving({ slug: b.slug, pct: Math.round((d / t) * 100) }));
    setSaving(null); setSaved(await savedBooks()); haptic("success");
  };
  const forget = async (slug: string) => { const b = books.data?.find((x) => x.slug === slug); if (b) { await removeBook(b); setSaved(await savedBooks()); } };

  return (
    <Screen title="Settings">
      <Section title="Reading">
        <Segmented label="Theme" value={theme} onChange={setTheme} options={[["system", "Automatic"], ["light", "Light"], ["dark", "Dark"], ["sepia", "Sepia"]]} />
        <List>
          <Row onClick={() => setSize(size === "compact" ? "regular" : size === "regular" ? "large" : "compact")} title="Text size" trailing={<Value>{{ compact: "Small", regular: "Regular", large: "Large" }[size]}</Value>} />
          <Row onClick={() => setFont(font === "serif" ? "sans" : "serif")} title="Typeface" trailing={<Value>{font === "serif" ? "Newsreader" : "System"}</Value>} />
          <Row onClick={() => setSpacing(spacing === "tight" ? "regular" : spacing === "regular" ? "airy" : "tight")} title="Line spacing" trailing={<Value>{{ tight: "Tight", regular: "Regular", airy: "Airy" }[spacing]}</Value>} />
          <Toggle on={justify} onChange={setJustify} title="Justify the text" />
          <Row onClick={() => setRelDisplay(relDisplay === "inline" ? "block" : "inline")} title="Related passages" sub={relDisplay === "inline" ? "Shown as tags under each verse" : "Shown as a count beside the verse number"} trailing={<Value>{relDisplay === "inline" ? "Tags" : "Count"}</Value>} />
          {features.fullscreen ? <Toggle on={fullscreen} onChange={setFs} title="Full screen" sub="The app fills the screen, without Telegram's header" /> : null}
          {features.fullscreen && (platform === "ios" || platform === "android") ? <Toggle on={portrait} onChange={setPortrait} title="Lock portrait" sub="Keep the reader upright" /> : null}
        </List>
      </Section>
      {offlineSupported ? (
        <Section title="Offline books" action={<button type="button" className="link" onClick={() => void offline()}>Save a book</button>}>
          {saving ? <div className="progress"><i style={{ width: `${saving.pct}%` }} /></div> : null}
          {saved.length ? <List>{saved.map((s) => <Row key={s} onClick={() => void forget(s)} title={books.data?.find((b) => b.slug === s)?.book ?? s} sub="Saved on this device · tap to remove" trailing={<span className="pill pill--ok">offline</span>} />)}</List> : <p className="hint">Saved books read without a connection.</p>}
        </Section>
      ) : null}
      <Section title="Daily verse">
        <List>
          <Toggle on={!!daily} onChange={(v) => void subscribe(v)} title="A verse every morning" sub={daily === null ? "Checking…" : daily ? `The bot sends it at ${hour}:00` : "Sent by the CyberJudah bot, with a button to read the chapter"} />
          <Row onClick={() => void pickHour()} title="Time" sub="In your time zone" trailing={<Value>{`${hour}:00`}</Value>} />
        </List>
      </Section>
      {features.biometrics && features.secureStorage ? (
        <Section title="Privacy"><List><Toggle on={lock} onChange={(v) => void toggleLock(v)} title="Lock with biometrics" sub="Ask for your fingerprint or face when the app opens" /></List></Section>
      ) : null}
      <Section title="Support CyberJudah">
        <div className="btn--row">{[50, 100, 500].map((n) => <button key={n} type="button" className="btn btn--quiet" onClick={() => void support(n)}>⭐ {n}</button>)}</div>
        <p className="hint">Telegram Stars go toward hosting the library. The text and the notes stay free.</p>
      </Section>
      {me?.admin ? <AskUsage /> : null}
      <Section title="This app">
        {me ? <List><Row title="Your Telegram id" sub={me.canEdit ? "You can edit notes from the app" : me.admin ? "Admin; editing needs the CYBERJUDAH_TOKEN secret on the deploy" : "Notes are read-only for this account"} trailing={<span className="pill">{me.user.id}</span>} onClick={() => { void navigator.clipboard?.writeText(String(me.user.id)).then(() => haptic("success")).catch(() => undefined); }} /></List> : null}
        <p className="hint">{app ? `Telegram ${app.version} on ${app.platform}. ` : "Running in a browser. "}{Object.entries(features).filter(([, v]) => v).length} of {Object.keys(features).length} Mini App features available here.</p>
      </Section>
    </Screen>
  );
}

/** Applies the reader's theme, face and spacing to the document (mounted once in App). */
export function ThemeApplier() {
  const [theme] = useStored<Theme>("theme", "system");
  const { scheme } = useTheme();
  const [font] = useStored<Font>("font", "serif");
  const [spacing] = useStored<Spacing>("spacing", "regular");
  const [justify] = useStored("justify", false);
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? scheme : theme;
    root.dataset.theme = resolved; root.dataset.font = font; root.dataset.spacing = spacing; root.dataset.justify = justify ? "yes" : "no";
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    const bg = getComputedStyle(root).getPropertyValue("--color-void").trim() || "#05070f";
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg);
  }, [theme, scheme, font, spacing, justify]);
  return null;
}


/** For admins: what Ask CyberJudah answers cost, day by day, to price the plans by. */
function AskUsage() {
  const [u, setU] = useState<{ usdPerMtok: number; days: { day: string; questions: number; people: number; units: number; usd: number }[] } | null>(null);
  useEffect(() => { void api<typeof u>("/api/admin/usage").then(setU).catch(() => undefined); }, []);
  if (!u) return null;
  const week = u.days.slice(0, 7), q = week.reduce((a, d) => a + d.questions, 0), usd = week.reduce((a, d) => a + d.usd, 0);
  return (
    <Section title="Ask usage">
      <div className="stat">
        <div><b>{q}</b><span>answers, 7 days</span></div>
        <div><b>${q ? (usd / q).toFixed(2) : "0.00"}</b><span>per answer</span></div>
        <div><b>${usd.toFixed(2)}</b><span>cost, 7 days</span></div>
      </div>
      <List>{u.days.filter((d) => d.questions).slice(0, 7).map((d) => <Row key={d.day} title={d.day} sub={`${d.questions} answers · ${d.people} people`} trailing={<span className="row__value">${d.usd.toFixed(2)}</span>} />)}</List>
      <p className="hint">At ${u.usdPerMtok} per million input tokens (ASK_USD_PER_MTOK); output counts five times. Check it against Anthropic's price for the model.</p>
    </Section>
  );
}
