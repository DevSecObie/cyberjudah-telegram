import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";

import { app, features, haptic, has } from "./sdk";
import { json, store } from "./store";

/**
 * React hooks over the SDK. Buttons are declared by the screen that owns them and cleaned up
 * when it unmounts, so Telegram's chrome always shows the current screen's controls.
 */

/** How many sheets are open: while any is, Telegram's back button shows and closes the top one. */
let sheetsOpen = 0;
const sheetListeners = new Set<(n: number) => void>();
export function sheetOpened(): () => void {
  sheetsOpen++; sheetListeners.forEach((l) => l(sheetsOpen));
  return () => { sheetsOpen = Math.max(0, sheetsOpen - 1); sheetListeners.forEach((l) => l(sheetsOpen)); };
}
function useSheetsOpen() {
  const [n, setN] = useState(sheetsOpen);
  useEffect(() => { sheetListeners.add(setN); return () => { sheetListeners.delete(setN); }; }, []);
  return n;
}

/** Telegram's back button walks the app's own history; on a root tab it becomes Close. */
export function useBackButton(root: boolean, onBack?: () => boolean | void) {
  const navigate = useNavigate();
  const handler = useRef(onBack);
  handler.current = onBack;
  const canGoBack = (window.history.state?.idx ?? 0) > 0;
  const sheets = useSheetsOpen();
  useEffect(() => {
    if (!has("6.1")) return;
    const cb = () => {
      haptic("select");
      // An open sheet closes first, like a phone app.
      const all = document.querySelectorAll<HTMLElement>("[data-sheet-open]");
      const sheet = all[all.length - 1];
      if (sheet) { sheet.closest(".sheet__scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
      if (handler.current?.() === true) return;
      if (canGoBack) navigate(-1); else navigate("/", { replace: true });
    };
    const show = !root || canGoBack || sheets > 0;
    if (show) { app!.BackButton.onClick(cb); app!.BackButton.show(); } else app!.BackButton.hide();
    return () => { app!.BackButton.offClick(cb); };
  }, [root, canGoBack, navigate, sheets]);
}

export type Action = { text: string; onClick: () => void; quiet?: boolean; progress?: boolean; disabled?: boolean; shine?: boolean };
/**
 * A screen's actions (Open in YouTube, Share, Start the plan...). They used to be Telegram's own
 * bottom buttons, but Telegram draws those in its own bar over the bottom of the app, which hid
 * the tab bar on every screen that had one. Like Bible Strong, the actions now live in the app:
 * PageActions (ui/ui.tsx) shows them as glass buttons just above the tab bar, which stays.
 */
type Actions = { main: Action | null; secondary: Action | null };
let actions: Actions = { main: null, secondary: null };
const actionListeners = new Set<() => void>();
const setActions = (next: Actions) => { actions = next; actionListeners.forEach((l) => l()); };
export const usePageActions = () => useSyncExternalStore((l) => { actionListeners.add(l); return () => { actionListeners.delete(l); }; }, () => actions);

export function useBottomButtons(main: Action | null, secondary: Action | null = null) {
  const h = useRef({ main, secondary });
  h.current = { main, secondary };
  const key = JSON.stringify([main?.text, main?.quiet, main?.progress, main?.disabled, secondary?.text, secondary?.progress, secondary?.disabled]);
  useEffect(() => {
    // Telegram's own buttons stay hidden: the app shows the actions itself.
    if (app) { app.MainButton.hide(); if (features.secondaryButton) app.SecondaryButton.hide(); }
    const wrap = (which: "main" | "secondary"): Action | null => {
      const a = h.current[which];
      return a ? { ...a, onClick: () => { haptic(); h.current[which]?.onClick(); } } : null;
    };
    setActions({ main: wrap("main"), secondary: wrap("secondary") });
    return () => setActions({ main: null, secondary: null });
  }, [key]);
}

/** Telegram's ··· menu gets a Settings entry that opens the app's settings screen. */
export function useSettingsButton() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!features.settingsButton) return;
    const cb = () => { haptic("select"); if (location.pathname !== "/settings") navigate("/settings"); };
    app!.SettingsButton.onClick(cb);
    app!.SettingsButton.show();
    return () => { app!.SettingsButton.offClick(cb); };
  }, [navigate, location.pathname]);
}

/** A stored value that updates when the cloud copy arrives or another screen sets it. */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true, fresher = false;
    // The cloud copy can land before the first read returns; the first read must not undo it.
    void json.get(key, fallback).then((v) => { if (live) { if (!fresher) setValue(v); setLoaded(true); } });
    const off = store.subscribe(key, (raw) => { if (!live) return; fresher = true; try { setValue(raw === null ? fallback : (JSON.parse(raw) as T)); } catch { /* ignore */ } });
    return () => { live = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, (v: T) => json.set(key, v), loaded];
}

/** Re-runs `fn` when Telegram brings the app back to the foreground (8.0 `activated`). */
export function useActivated(fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const cb = () => ref.current();
    document.documentElement.addEventListener("tg:activated", cb);
    return () => document.documentElement.removeEventListener("tg:activated", cb);
  }, []);
}

/** Telegram's colour scheme and theme params, live. */
export function useTheme() {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const now = (): "light" | "dark" => app?.colorScheme ?? (media && !media.matches ? "light" : "dark");
  const [scheme, setScheme] = useState<"light" | "dark">(now);
  useEffect(() => {
    const cb = () => setScheme(now());
    if (app) { const a = app; a.onEvent("themeChanged", cb); return () => a.offEvent("themeChanged", cb); }
    media?.addEventListener("change", cb);
    return () => media?.removeEventListener("change", cb);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { scheme, params: app?.themeParams ?? {} };
}
