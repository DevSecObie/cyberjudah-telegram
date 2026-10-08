import { saveFile } from "@/studies/files";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { data, type Book } from "@/api/data";
import { offlineSupported, removeBook, saveBook, saveNarration, savedBooks } from "@/lib/offline";
import { narrationHint, narrationStatus, removeNarration, type NarrationStatus } from "@/lib/narration";
import { recordingJson, type RecordingCredit } from "@/lib/recordings";
import { useBackButton, useStored, useTheme } from "@/tg/hooks";
import { alert, api, app, confirm, features, haptic, platform, requestWriteAccess, setFullscreen, lockPortrait } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { collect, parseBackup, restore, sendBackup } from "@/lib/backup";
import { useSheet } from "@/ui/sheet";
import { Icon, List, Row, Screen, FormSection as Section, Segmented } from "@/ui/ui";
import { useRelationsDisplay } from "@/lib/relations";
import { useBibleSettings } from "@/bible/settings";
import type { Font, Spacing } from "@/ui/theme";
import { DARK_THEMES, LIGHT_THEMES } from "@/bible/theme";

/** A setting's current value, iOS style: quiet text before the chevron. */
export function Value({ children }: { children: string }) {
  return <span className="row__value">{children}<Icon name="chevron" size={16} /></span>;
}

function Toggle({ on, onChange, title, sub, disabled }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string; disabled?: boolean }) {
  return <button type="button" className="toggle" role="switch" aria-checked={on} disabled={disabled} onClick={() => { haptic("select"); onChange(!on); }}><span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><span className="switch" /></button>;
}

export function Settings() {
  const navigate = useNavigate();
  useBackButton(false);
  const sheet = useSheet();
  const [size, setSize] = useStored<"compact" | "regular" | "large">("size", "regular");
  const [transparency, setTransparency] = useStored<"system" | "reduced">("transparency", "system");
  const [font, setFont] = useStored<Font>("font", "serif");
  const [spacing, setSpacing] = useStored<Spacing>("spacing", "regular");
  const [justify, setJustify] = useStored("justify", false);
  const [relDisplay, setRelDisplay] = useRelationsDisplay();
  // One typeface for reading: the notes and the Bible both follow this row, and it names the face the Bible is really set in.
  const [bible, setBible] = useBibleSettings();
  const face = ["System", "Avenir", "normal", "Roboto"].includes(bible.fontFamily) ? "System" : bible.fontFamily;
  const [fullscreen, setFs, fsLoaded] = useStored("fullscreen", false);
  const [portrait, setPortrait] = useStored("portrait", false);
  const [daily, setDaily] = useState<boolean | null>(null);
  const [me, setMe] = useState<{ user: { id: number }; admin?: boolean; canEdit?: boolean } | null>(null);
  const [hour, setHour] = useStored("daily-hour", 8);
  const [lock, setLock] = useState(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState<{ slug: string; pct: number } | null>(null);
  const [narration, setNarration] = useState<Record<string, NarrationStatus>>({});
  useEffect(() => { void api<{ subscribed: boolean; user: { id: number }; admin?: boolean; canEdit?: boolean }>("/api/me").then((m) => { setDaily(m.subscribed); setMe(m); }).catch(() => setDaily(false)); void secure.get("lock").then((v) => setLock(v === "on")); void savedBooks().then(setSaved); }, []);
  const refreshNarration = async (slug: string) => {
    const b = books.data?.find((x) => x.slug === slug);
    if (!b) return;
    const status = await narrationStatus(b);
    setNarration((prev) => ({ ...prev, [slug]: status }));
  };
  useEffect(() => { if (!books.data) return; saved.forEach((s) => void refreshNarration(s)); }, [saved, books.data]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /** Narration bytes for one book from the recordings catalog; a plain explanation when the catalog itself can't be read. */
  const narrationBytes = async (slug: string): Promise<{ bytes: number | null; failed: boolean }> => {
    try {
      const catalog = await recordingJson<{ chapters: RecordingCredit[] }>("/api/recordings/catalog");
      const bytes = catalog.chapters.filter((r) => r.slug === slug).reduce((sum, r) => sum + r.bytes, 0);
      return { bytes, failed: false };
    } catch { return { bytes: null, failed: true }; }
  };
  const downloadNarration = async (b: Book) => {
    setSaving({ slug: b.slug, pct: 0 });
    const complete = await saveNarration(b, (d, t) => setSaving({ slug: b.slug, pct: Math.round(d / t * 100) }));
    setSaving(null); haptic(complete ? "success" : "error");
    if (!complete) void alert("Some narration could not be downloaded. The saved text is unaffected; retry while connected to finish it.");
    await refreshNarration(b.slug);
  };
  const offline = async () => {
    const list = books.data ?? [];
    const a = await sheet.open({ title: "Save a book for offline reading", items: list.filter((b) => !saved.includes(b.slug)).map((b) => ({ id: b.slug, text: b.book, hint: `${b.chapters} chapters` })) });
    const b = a && list.find((x) => x.slug === a.id);
    if (!b) return;
    setSaving({ slug: b.slug, pct: 0 });
    const complete = await saveBook(b, (d, t) => setSaving({ slug: b.slug, pct: Math.round((d / t) * 100) }));
    setSaving(null); setSaved(await savedBooks()); haptic(complete ? "success" : "error");
    if (!complete) { void alert("The book download is incomplete. Please retry while connected to save all text."); return; }
    const { bytes, failed } = await narrationBytes(b.slug);
    if (failed) { void alert(`Text saved. ${narrationHint(null, true)}`); return; }
    if (bytes && bytes > 0 && await confirm(`Text saved. Also save narration (${narrationHint(bytes, false)})?`)) await downloadNarration(b);
    else await refreshNarration(b.slug);
  };
  /** Text removal and narration removal are separate actions (CYB-123): neither requires the other. */
  const manageNarration = async (slug: string) => {
    const b = books.data?.find((x) => x.slug === slug);
    if (!b) return;
    const status = narration[slug] ?? "none";
    const { bytes, failed } = status === "complete" ? { bytes: null, failed: false } : await narrationBytes(slug);
    const items = [
      ...(status !== "complete" && (failed || (bytes ?? 0) > 0) ? [{ id: "download", text: status === "partial" ? "Finish downloading narration" : "Download narration", hint: narrationHint(bytes, failed) }] : []),
      ...(status !== "none" ? [{ id: "remove-narration", text: "Remove narration only", destructive: true }] : []),
      { id: "remove-book", text: "Remove text and narration", destructive: true },
    ];
    const a = await sheet.open({ title: b.book, items });
    if (!a) return;
    if (a.id === "download") await downloadNarration(b);
    else if (a.id === "remove-narration") { await removeNarration(b); await refreshNarration(b.slug); haptic("success"); }
    else if (a.id === "remove-book") { await removeBook(b); setSaved(await savedBooks()); setNarration((prev) => { const next = { ...prev }; delete next[slug]; return next; }); haptic("success"); }
  };

  return (
    <Screen title="Settings">
      <Section title="Study library"><List><Row title="Study resources" sub="Install, remove or roll back offline resources" onClick={() => navigate("/resources")} /></List></Section>
      <Section title="Listening"><List><Row title="Audio settings" sub="Voice, speed, pitch and ambient sound" onClick={() => navigate("/settings/audio")} /></List></Section>
      <Section title="Reading">
        <Segmented label="Theme" value={bible.preferredColorScheme} onChange={(v) => setBible({ preferredColorScheme: v })} options={[["auto", "Automatic"], ["light", "Day"], ["dark", "Night"]]} />
        <List>
          {/* The Bible's own colours, worn by the whole app: the same choice as Font and settings in the reader. */}
          <Row onClick={() => { const i = LIGHT_THEMES.findIndex((t) => t.id === bible.preferredLightTheme); setBible({ preferredLightTheme: LIGHT_THEMES[(i + 1) % LIGHT_THEMES.length].id }); }} title="Day colour" sub="The whole app takes the Bible’s colours" trailing={<Value>{LIGHT_THEMES.find((t) => t.id === bible.preferredLightTheme)?.label ?? ""}</Value>} />
          <Row onClick={() => { const i = DARK_THEMES.findIndex((t) => t.id === bible.preferredDarkTheme); setBible({ preferredDarkTheme: DARK_THEMES[(i + 1) % DARK_THEMES.length].id }); }} title="Night colour" trailing={<Value>{DARK_THEMES.find((t) => t.id === bible.preferredDarkTheme)?.label ?? ""}</Value>} />
          <Row onClick={() => setSize(size === "compact" ? "regular" : size === "regular" ? "large" : "compact")} title="Text size" trailing={<Value>{{ compact: "Small", regular: "Regular", large: "Large" }[size]}</Value>} />
          <Row onClick={() => { const serif = face !== "Newsreader"; setFont(serif ? "serif" : "sans"); setBible({ fontFamily: serif ? "Newsreader" : "System" }); }} title="Typeface" sub={face === "Newsreader" || face === "System" ? undefined : "Chosen in the Bible’s own settings"} trailing={<Value>{face}</Value>} />
          <Row onClick={() => setSpacing(spacing === "tight" ? "regular" : spacing === "regular" ? "airy" : "tight")} title="Line spacing" trailing={<Value>{{ tight: "Tight", regular: "Regular", airy: "Airy" }[spacing]}</Value>} />
          <Toggle on={justify} onChange={setJustify} title="Justify the text" />
          <Row onClick={() => setRelDisplay(relDisplay === "inline" ? "block" : "inline")} title="Precepts in the reader" sub={relDisplay === "inline" ? "Shown as tags after each verse" : "Shown as a count beside the verse number"} trailing={<Value>{relDisplay === "inline" ? "Tags" : "Count"}</Value>} />
          <Toggle on={transparency === "reduced"} onChange={(v) => setTransparency(v ? "reduced" : "system")} title="Reduce transparency" sub="Solid bars and panels instead of see-through glass" />
          {features.fullscreen ? <Toggle on={fullscreen} onChange={setFs} title="Full screen" sub="The app fills the screen, without Telegram's header" /> : null}
          {features.fullscreen && (platform === "ios" || platform === "android") ? <Toggle on={portrait} onChange={setPortrait} title="Lock portrait" sub="Keep the reader upright" /> : null}
        </List>
      </Section>
      {offlineSupported ? (
        <Section title="Offline Books" action={<button type="button" className="link" disabled={books.isPending || !!saving} onClick={() => void offline()}>Save a book</button>}>
          {saving ? <div className="progress"><i style={{ width: `${saving.pct}%` }} /></div> : null}
          {saved.length ? <List>{saved.map((s) => {
            const status = narration[s];
            const narrationLabel = status === "complete" ? "narration saved" : status === "partial" ? "narration partial" : "narration not saved";
            return <Row key={s} onClick={() => void manageNarration(s)} title={books.data?.find((b) => b.slug === s)?.book ?? s} sub={`Text saved on this device · ${narrationLabel} · tap to manage`} trailing={
              <span style={{ display: "flex", gap: 6 }}>
                <span className="pill pill--ok">text</span>
                <span className={`pill ${status === "complete" ? "pill--ok" : ""}`}>{status === "complete" ? "narration" : status === "partial" ? "partial" : "no narration"}</span>
              </span>
            } />;
          })}</List> : <p className="hint">Save the text to read without a connection. Available narration is an optional extra download.</p>}
        </Section>
      ) : null}
      <Section title="Reading Reminders">
        <List><Row title="Reading reminders" sub="Today's reading, at your time, in Telegram or as a push notification" onClick={() => navigate("/settings/reminders")} /></List>
        <List><Row title="Privacy" sub="What is kept, who sees it, and your choices: download or delete your data" onClick={() => navigate("/privacy")} /></List>
        <List><Row title="Terms" sub="What your Ask balance buys, refunds, and what happens to it when you delete your data" onClick={() => navigate("/terms")} /></List>
      </Section>
      <Section title="Daily Verse">
        <List>
          {/* Outside Telegram there is no chat for the bot to send to: said here, at the switch. */}
          <Toggle on={!!daily} disabled={!app} onChange={(v) => void subscribe(v)} title="A verse every morning" sub={!app ? "Sent by the CyberJudah bot in Telegram. Open CyberJudah in Telegram to turn it on." : daily === null ? "Checking…" : daily ? `The bot sends it at ${hour}:00` : "Sent by the CyberJudah bot, with a button to read the chapter"} />
          {app ? <Row onClick={() => void pickHour()} title="Time" sub="In your time zone" trailing={<Value>{`${hour}:00`}</Value>} /> : null}
        </List>
      </Section>
      {features.biometrics && features.secureStorage ? (
        <Section title="Privacy"><List><Toggle on={lock} onChange={(v) => void toggleLock(v)} title="Lock with biometrics" sub="Ask for your fingerprint or face when the app opens" /></List></Section>
      ) : null}
      <List><Row icon="gear" title="Account & personal studies" onClick={() => navigate("/settings/account")} /></List>
      <BackupSection />
      <Section title="Support CyberJudah">
        <List><Row title="Support CyberJudah" sub="Telegram Stars, any amount, or give another way" onClick={() => navigate("/settings/donate")} /></List>
      </Section>
      {me?.admin ? <Section title="Content"><List><Row title="Admin" sub="Edit content, check reviews and publish approved changes" onClick={() => navigate("/settings/admin")} /></List></Section> : null}
      {me?.admin ? <AskUsage /> : null}
      {me?.admin ? <Section title="Notes"><List><Row title="Requested notes" sub="Classes readers asked notes for, the most asked first" onClick={() => navigate("/settings/requests")} /></List></Section> : null}
      <Section title="This App">
        <List><Row title="Credits" sub="Narrators, recordings and licences" onClick={() => navigate("/settings/credits")} /></List>
        {me ? <List><Row title="Your Telegram id" sub={me.canEdit ? "You can edit notes from the app" : me.admin ? "Admin; editing needs the CYBERJUDAH_TOKEN secret on the deploy" : "Notes are read-only for this account"} trailing={<span className="pill">{me.user.id}</span>} onClick={() => { void navigator.clipboard?.writeText(String(me.user.id)).then(() => haptic("success")).catch(() => undefined); }} /></List> : null}
        <p className="hint">{app ? `Telegram ${app.version} on ${app.platform}. ${Object.entries(features).filter(([, v]) => v).length} of ${Object.keys(features).length} Mini App features available here.` : "Open in a browser: reading, the classes and the library all work here. Searching the classes, Ask, the daily verse and Stars work when CyberJudah is opened in Telegram."}</p>
      </Section>
    </Screen>
  );
}


/** For admins: what Ask CyberJudah answers cost, day by day, to price the plans by. */
function AskUsage() {
  const [u, setU] = useState<{ usdPerMtok: number; days: { day: string; questions: number; people: number; units: number; usd: number }[]; reminders?: { telegram: number; push: number; both: number; paused: number; off: number } | null } | null>(null);
  useEffect(() => { void api<typeof u>("/api/admin/usage").then(setU).catch(() => undefined); }, []);
  if (!u) return null;
  const week = u.days.slice(0, 7), q = week.reduce((a, d) => a + d.questions, 0), usd = week.reduce((a, d) => a + d.usd, 0);
  return (
    <Section title="Ask Usage">
      <div className="stat">
        <div><b>{q}</b><span>answers, 7 days</span></div>
        <div><b>${q ? (usd / q).toFixed(2) : "0.00"}</b><span>per answer</span></div>
        <div><b>${usd.toFixed(2)}</b><span>cost, 7 days</span></div>
      </div>
      <List>{u.days.filter((d) => d.questions).slice(0, 7).map((d) => <Row key={d.day} title={d.day} sub={`${d.questions} answers · ${d.people} people`} trailing={<span className="row__value">${d.usd.toFixed(2)}</span>} />)}</List>
      <p className="hint">At ${u.usdPerMtok} per million input tokens (ASK_USD_PER_MTOK); output counts five times. Check it against Anthropic's price for the model.</p>
      {u.reminders ? (
        <div className="stat" aria-label="Reading reminders by channel">
          <div><b>{u.reminders.telegram}</b><span>reminders, Telegram</span></div>
          <div><b>{u.reminders.push}</b><span>reminders, push</span></div>
          <div><b>{u.reminders.both}</b><span>reminders, both</span></div>
        </div>
      ) : null}
      {u.reminders ? <p className="hint">Reading reminders on: {u.reminders.telegram + u.reminders.push + u.reminders.both}, of which {u.reminders.paused} paused; {u.reminders.off} off.</p> : null}
    </Section>
  );
}

/** Bible Strong's Backup screen: everything kept, as a file in your chat; a file, read back in. */
function BackupSection() {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"send" | "restore" | null>(null);
  const [status, setStatus] = useState("");
  const send = async () => {
    setBusy("send"); setStatus("");
    if (!app) {
      try { await saveFile("cyberjudah-backup.json", JSON.stringify({ app: "cyberjudah", version: 1, date: new Date().toISOString(), keys: await collect() }, null, 2)); setStatus("Backup downloaded."); } catch { setStatus("The backup could not be exported. Your saved data is unchanged."); }
      setBusy(null); return;
    }
    const r = await sendBackup();
    setBusy(null);
    if (r.ok) { haptic("success"); setStatus(`Sent to your chat with the bot: ${r.entries} entries.`); } else { haptic("error"); setStatus(r.error); }
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy("restore"); setStatus("");
    const b = parseBackup(await f.text());
    if (typeof b === "string") { setBusy(null); haptic("error"); setStatus(b); return; }
    const n = Object.keys(b.keys).length;
    if (!(await confirm(`Restore ${n} entries from ${b.date || "this backup"}? Anything kept under the same keys is replaced.`))) { setBusy(null); return; }
    restore(b); setBusy(null); haptic("success"); setStatus(`Restored ${n} ${n === 1 ? "entry" : "entries"}.`);
  };
  return (
    <Section title="Backup">
      <List>
        <Row onClick={() => void send()} icon="download" title={busy === "send" ? "Preparing…" : app ? "Send a backup to your chat" : "Download a backup"} sub="Highlights, notes, tags, bookmarks, links, plan and settings, as one file" />
        <Row onClick={() => file.current?.click()} icon="retry" title={busy === "restore" ? "Restoring…" : "Restore from a file"} sub="A backup file from your chat" />
      </List>
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} aria-label="Backup file" />
      {status ? <p className="hint" role="status">{status}</p> : null}
    </Section>
  );
}
