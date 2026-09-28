import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { app, features, haptic, has } from "./sdk";
import { json, store } from "./store";

/**
 * React hooks over the SDK. Buttons are declared by the screen that owns them and cleaned up
 * when it unmounts, so Telegram's chrome always shows the current screen's controls.
 */

/** Telegram's back button walks the app's own history; on a root tab it becomes Close. */
export function useBackButton(root: boolean, onBack?: () => boolean | void) {
  const navigate = useNavigate();
  const handler = useRef(onBack);
  handler.current = onBack;
  const canGoBack = (window.history.state?.idx ?? 0) > 0;
  useEffect(() => {
    if (!has("6.1")) return;
    const cb = () => {
      haptic("select");
      // An open sheet closes first, like a phone app.
      const sheet = document.querySelector<HTMLElement>("[data-sheet-open]");
      if (sheet) { sheet.closest(".sheet__scrim")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); return; }
      if (handler.current?.() === true) return;
      if (canGoBack) navigate(-1); else navigate("/", { replace: true });
    };
    const show = !root || canGoBack;
    if (show) { app!.BackButton.onClick(cb); app!.BackButton.show(); } else app!.BackButton.hide();
    return () => { app!.BackButton.offClick(cb); };
  }, [root, canGoBack, navigate]);
}

export type Action = { text: string; onClick: () => void; quiet?: boolean; progress?: boolean; disabled?: boolean; shine?: boolean };
/** Telegram's bottom buttons in the app's current palette, so they match light and dark alike. */
function colors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    main: { color: v("--color-cyan", "#00e5ff"), text_color: v("--color-void", "#05070f") },
    quiet: { color: v("--color-panel-2", "#101833"), text_color: v("--color-ink-2", "#dbe5f0") },
  };
}

/** The screen's actions on Telegram's bottom bar: `main` full width, `secondary` beside it. */
export function useBottomButtons(main: Action | null, secondary: Action | null = null) {
  const h = useRef({ main, secondary });
  h.current = { main, secondary };
  const key = JSON.stringify([document.documentElement.dataset.theme, main?.text, main?.quiet, main?.progress, main?.disabled, main?.shine, secondary?.text, secondary?.progress, secondary?.disabled]);
  useEffect(() => {
    if (!app) return;
    const M = app.MainButton, S = features.secondaryButton ? app.SecondaryButton : null;
    const cm = () => { haptic(); h.current.main?.onClick(); };
    const cs = () => { haptic(); h.current.secondary?.onClick(); };
    const { main: m, secondary: s } = h.current;
    const COLORS = colors();
    if (m) {
      M.setParams({ text: m.text, ...(m.quiet ? COLORS.quiet : COLORS.main), is_active: !m.disabled, is_visible: true, has_shine_effect: !!m.shine });
      if (m.progress) M.showProgress(true); else M.hideProgress();
      M.onClick(cm);
    } else M.hide();
    if (S) {
      if (s) { S.setParams({ text: s.text, ...COLORS.quiet, position: "left", is_active: !s.disabled, is_visible: true }); if (s.progress) S.showProgress(true); else S.hideProgress(); S.onClick(cs); }
      else S.hide();
    }
    return () => { M.offClick(cm); M.hide(); M.hideProgress(); S?.offClick(cs); S?.hide(); };
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
    let live = true;
    void json.get(key, fallback).then((v) => { if (live) { setValue(v); setLoaded(true); } });
    const off = store.subscribe(key, (raw) => { if (!live) return; try { setValue(raw === null ? fallback : (JSON.parse(raw) as T)); } catch { /* ignore */ } });
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
