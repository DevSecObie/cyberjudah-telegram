import { useEffect, useState } from "react";

import { useBackButton, useStored } from "@/tg/hooks";
import { alert, api, app, features, haptic, openInvoice, platform, popup, requestWriteAccess, setFullscreen, lockPortrait } from "@/tg/sdk";
import { secure } from "@/tg/store";
import { List, Row, Screen, Section } from "@/ui/ui";

function Toggle({ on, onChange, title, sub }: { on: boolean; onChange: (v: boolean) => void; title: string; sub?: string }) {
  return <button type="button" className="toggle" role="switch" aria-checked={on} onClick={() => { haptic("select"); onChange(!on); }}><span><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><span className="switch" /></button>;
}

export function Settings() {
  useBackButton(false);
  const [size, setSize] = useStored<"compact" | "regular" | "large">("size", "regular");
  const [fullscreen, setFs] = useStored("fullscreen", false);
  const [portrait, setPortrait] = useStored("portrait", false);
  const [daily, setDaily] = useState<boolean | null>(null);
  const [hour, setHour] = useStored("daily-hour", 8);
  const [lock, setLock] = useState(false);
  useEffect(() => { void api<{ subscribed: boolean }>("/api/me").then((m) => setDaily(m.subscribed)).catch(() => setDaily(false)); void secure.get("lock").then((v) => setLock(v === "on")); }, []);
  useEffect(() => { setFullscreen(fullscreen); }, [fullscreen]);
  useEffect(() => { lockPortrait(portrait); }, [portrait]);

  const subscribe = async (on: boolean, h = hour) => {
    if (on && !(await requestWriteAccess())) { void alert("Telegram needs permission for the bot to message you. Try again and allow it."); return; }
    try { const r = await api<{ subscribed: boolean }>("/api/subscribe", { method: "POST", json: { on, hour: h, tz: -new Date().getTimezoneOffset() } }); setDaily(r.subscribed); haptic(r.subscribed ? "success" : "tap"); }
    catch { void alert("Could not update the daily verse right now."); }
  };
  const pickHour = async () => {
    const id = await popup({ title: "Daily verse", message: "When should it arrive?", buttons: [{ id: "6", text: "6:00" }, { id: "8", text: "8:00" }, { id: "12", text: "Noon" }, { id: "20", text: "20:00" }] });
    if (id) { setHour(+id); if (daily) void subscribe(true, +id); }
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

  return (
    <Screen title="Settings">
      <Section title="Reading">
        <List>
          <Row onClick={() => setSize(size === "compact" ? "regular" : size === "regular" ? "large" : "compact")} title="Text size" sub={size} trailing={<span className="pill">Aa</span>} />
          {features.fullscreen ? <Toggle on={fullscreen} onChange={setFs} title="Full screen" sub="Hide Telegram's header while reading" /> : null}
          {features.fullscreen && (platform === "ios" || platform === "android") ? <Toggle on={portrait} onChange={setPortrait} title="Lock portrait" sub="Keep the reader upright" /> : null}
        </List>
      </Section>
      <Section title="Daily verse">
        <List>
          <Toggle on={!!daily} onChange={(v) => void subscribe(v)} title="A verse every morning" sub={daily === null ? "Checking…" : daily ? `The bot sends it at ${hour}:00` : "Sent by the CyberJudah bot, with a button to read the chapter"} />
          <Row onClick={() => void pickHour()} title="Time" sub={`${hour}:00 in your time zone`} />
        </List>
      </Section>
      {features.biometrics && features.secureStorage ? (
        <Section title="Privacy">
          <List><Toggle on={lock} onChange={(v) => void toggleLock(v)} title="Lock with biometrics" sub="Ask for your fingerprint or face when the app opens" /></List>
        </Section>
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
