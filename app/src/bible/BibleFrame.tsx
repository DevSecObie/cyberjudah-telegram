import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";

import { useTheme } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { assetUrl } from "@/lib/asset";
import { useBibleSettings, type BibleSettings } from "./settings";
import "./strong-reader.css";

/**
 * The Bible is Bible Strong's reader (strong/, at /app/strong), in one frame for the whole app: it
 * loads in the background after launch and stays loaded, so the Bible tab opens at once, where the
 * reader left off, as a tab of a phone app does. A chapter link moves the same reader by message
 * instead of reloading it. The frame and the app talk by postMessage (strong/…/cyberjudahBridge.ts):
 * the reader asks the app to open its screens and links, to buzz, and says whether it can go back;
 * the app gives it passages, Back and the theme. Origin and source are checked both ways.
 */
const ORIGIN = location.origin;
export const isBiblePath = (path: string) => /^\/(?:bible|read)(?:\/|$)/.test(path);

type FromReader =
  | { type: "ready" }
  | { type: "navigate"; path: string }
  | { type: "open"; url: string }
  | { type: "haptic"; kind: "select" | "tap" | "success" }
  | { type: "depth"; canGoBack: boolean }
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
export const useReaderCanGoBack = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => canGoBack);

export function BibleFrame() {
  const location = useLocation();
  const navigate = useNavigate();
  const shown = isBiblePath(location.pathname);
  // Loaded when the Bible is first opened, or quietly a moment after launch.
  const [mounted, setMounted] = useState(shown);
  useEffect(() => {
    if (mounted) return;
    if (shown) { setMounted(true); return; }
    const id = window.setTimeout(() => setMounted(true), 2500);
    return () => window.clearTimeout(id);
  }, [mounted, shown]);

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
      else if (m.type === "appearance") {
        const a = appearance.current;
        if (a && (a.preferredColorScheme !== m.preferredColorScheme || a.preferredLightTheme !== m.preferredLightTheme || a.preferredDarkTheme !== m.preferredDarkTheme))
          settingsRef.current({ preferredColorScheme: m.preferredColorScheme, preferredLightTheme: m.preferredLightTheme, preferredDarkTheme: m.preferredDarkTheme });
      }
    };
    window.addEventListener("message", onMessage);
    return () => { window.removeEventListener("message", onMessage); frame = null; ready = false; };
  }, [mounted]);

  if (!mounted) return null;
  return (
    <div className={shown ? "strong-reader" : "strong-reader strong-reader--away"} aria-hidden={!shown}>
      <iframe ref={ref} className="strong-reader__frame" src="/app/strong/" title="Bible" allow="clipboard-write; web-share; fullscreen" />
      <div className="strong-reader__splash" data-done={loaded ? "" : undefined} aria-hidden="true">
        <img src={assetUrl("brand/cyber-lion.webp")} alt="" width={96} height={96} />
      </div>
    </div>
  );
}
