import { useEffect, useState } from "react";

import { countdown, sabbath } from "@/lib/sun";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { app, features, haptic, popup } from "@/tg/sdk";
import { Card, Empty, Icon, Screen, Section } from "@/ui/ui";

type Loc = { lat: number; lng: number; name?: string };

/**
 * The Sabbath begins at sunset. With the reader's location (Telegram's LocationManager, 8.0,
 * or the browser's geolocation), the app knows tonight's sunset and counts down to it.
 * The location is kept in CloudStorage so every device shows the same time.
 */
export function Sabbath() {
  useBackButton(false);
  const [loc, setLoc] = useStored<Loc | null>("loc", null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  const state = loc ? sabbath(now, loc.lat, loc.lng) : null;

  const locate = () => {
    setBusy(true);
    const done = (lat: number, lng: number) => { setLoc({ lat: +lat.toFixed(3), lng: +lng.toFixed(3) }); haptic("success"); setBusy(false); };
    const fail = () => { setBusy(false); void popup({ title: "Location", message: "CyberJudah could not read your location. Allow it in Telegram's settings for this app, then try again.", buttons: [{ type: "ok" }] }); };
    if (features.location) {
      const lm = app!.LocationManager;
      const get = () => lm.getLocation((d) => { if (d) done(d.latitude, d.longitude); else { if (lm.isAccessRequested && !lm.isAccessGranted) lm.openSettings(); fail(); } });
      if (lm.isInited) get(); else lm.init(get);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => done(p.coords.latitude, p.coords.longitude), fail, { timeout: 10_000 });
    } else fail();
  };
  useBottomButtons({ text: loc ? "Update my location" : "Use my location", onClick: locate, progress: busy }, loc ? { text: "Forget", onClick: () => setLoc(null) } : null);

  return (
    <Screen title="Sabbath" kicker="From even unto even · Leviticus 23:32">
      {!loc ? (
        <Empty title="Where are you?">Sunset depends on where you are. Share your location once and the app keeps it, on every device.</Empty>
      ) : !state ? (
        <Empty title="No sunset here today">Above the polar circle the sun does not set for part of the year.</Empty>
      ) : (
        <>
          <Card glow>
            <p className="card__label">{state.sabbath ? "It is the Sabbath" : "Until the Sabbath"}</p>
            <p className="verse" style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 34, letterSpacing: "-0.02em" }}>{state.sabbath ? "Shabbat shalom" : countdown(state.next, now)}</p>
            <p className="card__ref">{state.label} · {state.next.toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" })}</p>
          </Card>
          <Section title="Today">
            <div className="stat">
              <div><b>{state.sunsetToday ? state.sunsetToday.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—"}</b><span>Sunset</span></div>
              <div><b>{now.toLocaleDateString(undefined, { weekday: "short" })}</b><span>Today</span></div>
              <div><b>{loc.lat.toFixed(1)}°, {loc.lng.toFixed(1)}°</b><span>Location</span></div>
            </div>
          </Section>
          <p className="hint"><Icon name="sun" size={14} /> Sunset is computed from your location with the NOAA solar equations, to the minute. Local custom may keep the Sabbath from a few minutes before.</p>
        </>
      )}
    </Screen>
  );
}
