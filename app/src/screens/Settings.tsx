import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { data } from "@/api/data";
import { offlineSupported, removeBook, saveBook, savedBooks } from "@/lib/offline";
import { useBackButton, useStored } from "@/tg/hooks";
import { alert, api, app, features, haptic, openInvoice, platform, requestWriteAccess, setFullscreen, lockPortrait } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { useSheet } from "@/ui/sheet";
import { List, Row, Screen, Section, Segmented } from "@/ui/ui";

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
  const [theme, setTheme] = useStored<Theme>("theme", "dark");
  const [font, setFont] = useStored<Font>("font", "serif");
  const [spacing, setSpacing] = useStored<Spacing>("spacing", "regular");
  const [justify, setJustify] = useStored("justify", false);
  const [fullscreen, setFs] = useStored("fullscreen", false);
  const [portrait, setPortrait] = useStored("portrait", false);
  const [daily, setDaily] = useState<boolean | null>(null);
  const [hour, setHour] = useStored("daily-hour", 8);
  const [lock, setLock] = useState(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [saved, setSaved] = useState<string[]>([]);
  const [saving, setSaving] = useState<{ slug: string; pct: number } | null>(null);
  useEffect(() => { void api<{ subscribed: boolean }>("/api/me").then((m) => setDaily(m.subscribed)).catch(() => setDaily(false)); void secure.get("lock").then((v) => setLock(v === "on")); void savedBooks().then(setSaved); }, []);
  useEffect(() => { setFullscreen(fullscreen); }, [fullscreen]);
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
        <Segmented label="Theme" value={theme} onChange={setTheme} options={[["dark", "Dark"], ["sepia", "Sepia"], ["light", "Light"], ["system", "Telegram's"]]} />
        <List>
          <Row onClick={() => setSize(size === "compact" ? "regular" : size === "regular" ? "large" : "compact")} title="Text size" sub={size} trailing={<span className="pill">Aa</span>} />
          <Row onClick={() => setFont(font === "serif" ? "sans" : "serif")} title="Typeface" sub={font === "serif" ? "Newsreader, a book face" : "The system face"} trailing={<span className="pill">{font === "serif" ? "Serif" : "Sans"}</span>} />
          <Row onClick={() => setSpacing(spacing === "tight" ? "regular" : spacing === "regular" ? "airy" : "tight")} title="Line spacing" sub={spacing} trailing={<span className="pill">≡</span>} />
          <Toggle on={justify} onChange={setJustify} title="Justify the text" />
          {features.fullscreen ? <Toggle on={fullscreen} onChange={setFs} title="Full screen" sub="Hide Telegram's header while reading" /> : null}
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
          <Row onClick={() => void pickHour()} title="Time" sub={`${hour}:00 in your time zone`} />
        </List>
      </Section>
      {features.biometrics && features.secureStorage ? (
        <Section title="Privacy"><List><Toggle on={lock} onChange={(v) => void toggleLock(v)} title="Lock with biometrics" sub="Ask for your fingerprint or face when the app opens" /></List></Section>
      ) : null}
      <Section title="Support CyberJudah">
        <div className="btn--row">{[50, 100, 500].map((n) => <button key={n} type="button" className="btn btn--quiet" onClick={() => void support(n)}>⭐ {n}</button>)}</div>
        <p className="hint">Telegram Stars go toward hosting the library. The text and the notes stay free.</p>
      </Section>
      <Section title="This app">
        <p className="hint">{app ? `Telegram ${app.version} on ${app.platform}. ` : "Running in a browser. "}{Object.entries(features).filter(([, v]) => v).length} of {Object.keys(features).length} Mini App features available here.</p>
      </Section>
    </Screen>
  );
}

/** Applies the reader's theme, face and spacing to the document (mounted once in App). */
export function ThemeApplier() {
  const [theme] = useStored<Theme>("theme", "dark");
  const [font] = useStored<Font>("font", "serif");
  const [spacing] = useStored<Spacing>("spacing", "regular");
  const [justify] = useStored("justify", false);
  useEffect(() => {
    const root = document.documentElement;
    const resolved = theme === "system" ? (app?.colorScheme === "light" ? "light" : "dark") : theme;
    root.dataset.theme = resolved; root.dataset.font = font; root.dataset.spacing = spacing; root.dataset.justify = justify ? "yes" : "no";
    root.style.colorScheme = resolved === "dark" ? "dark" : "light";
    const bg = getComputedStyle(root).getPropertyValue("--color-void").trim() || "#05070f";
    if (app && app.isVersionAtLeast("6.1")) { app.setHeaderColor(bg); app.setBackgroundColor(bg); }
    if (app && app.isVersionAtLeast("7.10")) app.setBottomBarColor(bg);
  }, [theme, font, spacing, justify]);
  return null;
}
