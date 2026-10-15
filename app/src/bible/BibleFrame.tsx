import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useLocation, useNavigate } from "react-router";

import { useTheme } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { assetUrl } from "@/lib/asset";
import { useBibleSettings, type BibleSettings } from "./settings";
import { loadSnapshot, restoreScroll, saveSnapshot, snapshotFits, takeSnapshot } from "./readerSnapshot";
import { strongBookNumber } from "./strongRoutes";
import "./strong-reader.css";

/**
 * The Bible is Bible Strong's reader (strong/, at /app/strong), in one frame for the whole app: it
 * loads in the background after launch and stays loaded, so the Bible tab opens at once, where the
 * reader left off, as a tab of a phone app does. A chapter link moves the same reader by message
 * instead of reloading it. The frame and the app talk by postMessage (strong/…/cyberjudahBridge.ts):
 * the reader asks the app to open its screens and links, to buzz, and says whether it can go back;
 * the app gives it passages, Back and the theme. Origin and source are checked both ways.
 *
 * The frame sits below the top safe area (strong-reader.css), so in Telegram's full screen the
 * whole reader stays clear of the status bar and Telegram's buttons; the reader says the colour
 * of its header ("chrome") so the band above it matches.
 */
const ORIGIN = location.origin;
export const isBiblePath = (path: string) => /^\/(?:bible|read)(?:\/|$)/.test(path);

type FromReader =
  | { type: "ready" }
  | { type: "navigate"; path: string }
  | { type: "open"; url: string }
  | { type: "haptic"; kind: "select" | "tap" | "success" }
  | { type: "depth"; canGoBack: boolean }
  | { type: "chrome"; color: string }
  | ({ type: "appearance" } & Appearance);
type Appearance = Pick<BibleSettings, "preferredColorScheme" | "preferredLightTheme" | "preferredDarkTheme">;
type ToReader = { type: "open"; path: string } | { type: "back" } | ({ type: "appearance"; scheme: "light" | "dark" } & Appearance);

// What the route screens need from the frame: send it a passage or Back, and know its depth.
let frame: HTMLIFrameElement | null = null;
let ready = false;
let queue: ToReader[] = [];
let canGoBack = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
export function sendToReader(message: ToReader) {
  if (!ready || !frame?.contentWindow) { queue = [...queue.filter((m) => m.type !== message.type), message]; return; }
  frame.contentWindow.postMessage({ source: "cj-app", ...message }, ORIGIN);
}
// The reader's header colour, kept for the next launch so the band above it is right at once.
const CHROME_KEY = "cj:bible-chrome";
const isColor = (c: unknown): c is string => typeof c === "string" && c.length < 64 && /^(#[0-9a-f]{3,8}|(rgba?|hsla?)\([\d\s.,%/]+\))$/i.test(c);
const savedChrome = () => { try { const c = localStorage.getItem(CHROME_KEY); return isColor(c) ? c : null; } catch { return null; } };

export const useReaderCanGoBack = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => canGoBack);

export function BibleFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = isBiblePath(location.pathname);
  // Started once the app's first screen has painted, whether or not the Bible is open: the reader
  // runs on the app's own thread, and starting it in the first render would hold that screen back
  // by seconds. Until then the Bible shows the still copy of its last screen (below).
  const [mounted, setMounted] = useState(false);
  // When the copy is up, the reader starts once it has painted, so the two do not compete.
  const [stillShown, setStillShown] = useState(false);
  useEffect(() => {
    if (mounted) return;
    if (shown && stillFits && !stillShown) { const t = window.setTimeout(() => setStillShown(true), 1500); return () => window.clearTimeout(t); } // never wait on the copy for long
    let id = 0;
    const start = () => { id = window.setTimeout(() => setMounted(true), shown ? 0 : 150); };
    const raf = requestAnimationFrame(() => requestAnimationFrame(start));
    return () => { cancelAnimationFrame(raf); window.clearTimeout(id); };
  }, [mounted, shown, stillShown]); // eslint-disable-line react-hooks/exhaustive-deps
  // What is about to open: a passage (/read/john/3) or the reader's own last place (/bible).
  const m = /^\/read\/([^/]+)\/(\d+)/.exec(location.pathname);
  const book = m ? strongBookNumber(m[1]) : null;
  const requested = m ? (book ? `${book}-${Number(m[2])}` : "none") : null;
  // The still copy of the reader's last screen, shown while the reader starts (readerSnapshot.ts).
  const [snapshot] = useState(loadSnapshot);
  const stillFits = !!snapshot && snapshotFits(snapshot, requested, window.innerWidth);

  const [settings, setSettings] = useBibleSettings();
  const { scheme } = useTheme();
  const appearance = useRef<Appearance | null>(null);
  const settingsRef = useRef(setSettings);
  settingsRef.current = setSettings;
  const { preferredColorScheme, preferredLightTheme, preferredDarkTheme } = settings;
  useEffect(() => {
    appearance.current = { preferredColorScheme, preferredLightTheme, preferredDarkTheme };
    sendToReader({ type: "appearance", scheme, preferredColorScheme, preferredLightTheme, preferredDarkTheme });
  }, [scheme, preferredColorScheme, preferredLightTheme, preferredDarkTheme]);

  const ref = useRef<HTMLIFrameElement | null>(null);
  // The listener stays for the life of the frame: re-adding it on each route change would mark the
  // reader not ready, and passages sent after that would wait forever.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // The lion covers the reader until it says it is ready, then fades away.
  const [loaded, setLoaded] = useState(ready);
  const [chrome, setChrome] = useState(savedChrome);
  useEffect(() => {
    frame = ref.current;
    const onMessage = (event: MessageEvent<{ source?: string } & FromReader>) => {
      if (event.origin !== ORIGIN || !ref.current || event.source !== ref.current.contentWindow) return;
      const m = event.data;
      if (m?.source !== "cj-bible") return;
      if (m.type === "ready") {
        ready = true;
        setLoaded(true);
        const pending = queue; queue = [];
        pending.forEach(sendToReader);
      } else if (m.type === "navigate" && typeof m.path === "string" && m.path.startsWith("/")) navigateRef.current(m.path);
      else if (m.type === "open" && typeof m.url === "string" && /^https?:\/\//.test(m.url)) openLink(m.url);
      else if (m.type === "haptic") haptic(m.kind === "select" ? "select" : m.kind === "success" ? "success" : "tap");
      else if (m.type === "depth") { canGoBack = Boolean(m.canGoBack); changed(); }
      else if (m.type === "chrome" && isColor(m.color)) { setChrome(m.color); try { localStorage.setItem(CHROME_KEY, m.color); } catch { /* private mode */ } }
      else if (m.type === "appearance") {
        const a = appearance.current;
        if (a && (a.preferredColorScheme !== m.preferredColorScheme || a.preferredLightTheme !== m.preferredLightTheme || a.preferredDarkTheme !== m.preferredDarkTheme))
          settingsRef.current({ preferredColorScheme: m.preferredColorScheme, preferredLightTheme: m.preferredLightTheme, preferredDarkTheme: m.preferredDarkTheme });
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); frame = null; ready = false; };
  }, [mounted]);

  // Keep a fresh copy of the reader whenever the Bible is left or the app goes to the background.
  const wasShown = useRef(shown);
  useEffect(() => {
    const keep = () => { if (ready) saveSnapshot(takeSnapshot(ref.current)); };
    if (wasShown.current && !shown) keep();
    wasShown.current = shown;
    const onHide = () => { if (document.visibilityState === "hidden") keep(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", keep);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", keep); };
  }, [shown]);

  const still = !loaded && stillFits ? snapshot : null;
  if (!mounted && !(shown && still)) return null;
  return (
    <div className={shown ? "strong-reader" : "strong-reader strong-reader--away"} aria-hidden={!shown} style={chrome ? ({ "--reader-chrome": chrome } as CSSProperties) : undefined}>
      {mounted ? <iframe ref={ref} className="strong-reader__frame" src="/app/strong/" title="Bible" allow="clipboard-write; web-share; fullscreen" /> : null}
      {still ? (
        <iframe className="strong-reader__still" title="Bible (loading)" aria-hidden="true" tabIndex={-1} sandbox="allow-same-origin" srcDoc={still.html} onLoad={(e) => { restoreScroll(e.currentTarget); requestAnimationFrame(() => requestAnimationFrame(() => setStillShown(true))); }} />
      ) : (
        <div className="strong-reader__splash" data-done={loaded ? "" : undefined} aria-hidden="true">
          <img src={assetUrl("brand/cyber-lion.webp")} alt="" width={96} height={96} />
        </div>
      )}
    </div>
  );
}
