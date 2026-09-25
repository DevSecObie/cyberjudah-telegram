import type { HomeScreenStatus, InvoiceStatus, PopupParams, WebApp } from "./types";

/**
 * A thin layer over Telegram's SDK: one place that knows which client version supports what,
 * so the screens call `tg.share(...)` or `tg.haptic("tap")` and get the best the client can do.
 * Outside Telegram (a browser tab) every call is a safe no-op or a web fallback, so the same
 * build serves as a plain mobile web app and can be developed in a browser.
 */
export const app: WebApp | null = (() => {
  const w = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;
  // The SDK exists on any page that loads it; a real launch has a platform and init data.
  return w && w.platform !== "unknown" && w.initData ? w : null;
})();

export const inTelegram = app !== null;
export const has = (v: string) => app?.isVersionAtLeast(v) ?? false;
export const platform = app?.platform ?? "web";
export const isMobile = platform === "ios" || platform === "android";
export const user = app?.initDataUnsafe.user ?? null;
export const startParam = app?.initDataUnsafe.start_param ?? new URLSearchParams(location.search).get("tgWebAppStartParam") ?? undefined;

/** Feature availability, for the Settings screen and for choosing a fallback. */
export const features = {
  haptics: has("6.1"), popups: has("6.2"), qr: has("6.4"), clipboard: has("6.4"), inline: has("6.7"), cloud: has("6.9"), writeAccess: has("6.9"), contact: has("6.9"),
  settingsButton: has("6.10"), closingConfirmation: has("6.2"), biometrics: has("7.2"), swipes: has("7.7"), story: has("7.8"), secondaryButton: has("7.10"), bottomBarColor: has("7.10"),
  fullscreen: has("8.0"), homeScreen: has("8.0"), sensors: has("8.0"), location: has("8.0"), shareMessage: has("8.0"), emojiStatus: has("8.0"), download: has("8.0"), safeArea: has("8.0"),
  deviceStorage: has("9.0"), secureStorage: has("9.0"), hideKeyboard: has("9.1"), invoices: has("6.1"),
};

export function haptic(kind: "tap" | "select" | "success" | "warning" | "error" | "heavy" = "tap") {
  if (!features.haptics) return;
  const h = app!.HapticFeedback;
  if (kind === "select") h.selectionChanged();
  else if (kind === "success" || kind === "warning" || kind === "error") h.notificationOccurred(kind);
  else h.impactOccurred(kind === "heavy" ? "medium" : "light");
}

export function openLink(url: string, opts?: { instantView?: boolean }) {
  if (!app) { window.open(url, "_blank", "noopener"); return; }
  if (/^https:\/\/t\.me\//.test(url)) app.openTelegramLink(url);
  else app.openLink(url, opts?.instantView ? { try_instant_view: true } : undefined);
}

/** A file through Telegram's download sheet (8.0), else the browser. */
export function downloadFile(url: string, fileName: string) {
  if (features.download) app!.downloadFile({ url, file_name: fileName });
  else openLink(url);
}

export function popup(p: PopupParams): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (features.popups) app!.showPopup(p, (id) => resolve(id));
    else { console.info(p.message); resolve(undefined); }
  });
}
export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => { if (features.popups) app!.showConfirm(message, resolve); else resolve(window.confirm(message)); });
}
export function alert(message: string): Promise<void> {
  return new Promise((resolve) => { if (features.popups) app!.showAlert(message, () => resolve()); else { window.alert(message); resolve(); } });
}

/** Text from the clipboard: only for apps opened from the attachment menu; null otherwise. */
export function readClipboard(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!features.clipboard) return resolve(null);
    try { app!.readTextFromClipboard((t) => resolve(t ?? null)); } catch { resolve(null); }
  });
}

/** Scan a QR code and resolve with its text, once. */
export function scanQr(text: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!features.qr) return resolve(null);
    let done = false;
    app!.showScanQrPopup({ text }, (data) => { if (done) return; done = true; resolve(data); return true; });
    const off = () => { app!.offEvent("scanQrPopupClosed", off); if (!done) { done = true; resolve(null); } };
    app!.onEvent("scanQrPopupClosed", off);
  });
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => { if (features.writeAccess) app!.requestWriteAccess(resolve); else resolve(false); });
}
export function requestContact(): Promise<boolean> {
  return new Promise((resolve) => { if (features.contact) app!.requestContact(resolve); else resolve(false); });
}

export function homeScreenStatus(): Promise<HomeScreenStatus> {
  return new Promise((resolve) => { if (features.homeScreen) app!.checkHomeScreenStatus(resolve); else resolve("unsupported"); });
}
export const addToHomeScreen = () => { if (features.homeScreen) app!.addToHomeScreen(); };

export function openInvoice(link: string): Promise<InvoiceStatus> {
  return new Promise((resolve) => { if (features.invoices) app!.openInvoice(link, resolve); else { openLink(link); resolve("pending"); } });
}

/** Share a prepared inline message (8.0); resolves true when it was sent. */
export function shareMessage(id: string): Promise<boolean> {
  return new Promise((resolve) => { if (features.shareMessage) app!.shareMessage(id, resolve); else resolve(false); });
}
/** Post to a story with a link widget (7.8). Premium users get the widget; others the text. */
export function shareToStory(mediaUrl: string, text: string, link: { url: string; name: string }) {
  if (features.story) app!.shareToStory(mediaUrl, { text, widget_link: link });
}
/** Ask Telegram to pick a chat and paste an inline query (6.7). */
export function switchInline(query: string) {
  if (features.inline) app!.switchInlineQuery(query, ["users", "groups", "channels"]);
}
/** The universal fallback: Telegram's share sheet with a link. */
export function shareUrl(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (app) app.openTelegramLink(share);
  else if (navigator.share) void navigator.share({ url, text }).catch(() => {});
  else window.open(share, "_blank", "noopener");
}

export function setClosingConfirmation(on: boolean) {
  if (!features.closingConfirmation) return;
  if (on) app!.enableClosingConfirmation(); else app!.disableClosingConfirmation();
}
export function setFullscreen(on: boolean) {
  if (!features.fullscreen) return;
  if (on) app!.requestFullscreen(); else app!.exitFullscreen();
}
export function lockPortrait(on: boolean) {
  if (!features.fullscreen) return;
  if (on) app!.lockOrientation(); else app!.unlockOrientation();
}
export const hideKeyboard = () => { if (features.hideKeyboard) app!.hideKeyboard(); else (document.activeElement as HTMLElement | null)?.blur(); };

/** The bot backend, authenticated with the launch data. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `tma ${app?.initData ?? ""}`);
  let body = init?.body;
  if (init?.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return (await res.json()) as T;
}

/**
 * Boot: tell Telegram the app is ready, expand, paint the chrome in the app's colours, keep
 * a downward swipe scrolling, and mirror the client's theme, viewport and safe areas into CSS
 * variables the stylesheet reads (--tg-* are set by the SDK; these add the app's own).
 */
export function boot(colors: { bg: string; header: string; bottomBar: string }) {
  const root = document.documentElement;
  root.dataset.platform = platform;
  if (!app) { root.dataset.tg = "no"; return; }
  root.dataset.tg = "yes";
  app.ready();
  app.expand();
  if (has("6.1")) { app.setHeaderColor(colors.header); app.setBackgroundColor(colors.bg); }
  if (features.bottomBarColor) app.setBottomBarColor(colors.bottomBar);
  if (features.swipes) app.disableVerticalSwipes();
  const insets = () => {
    const s = app.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    const c = app.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
    root.style.setProperty("--safe-top", `${s.top + c.top}px`);
    root.style.setProperty("--safe-bottom", `${s.bottom}px`);
    root.style.setProperty("--safe-left", `${s.left}px`);
    root.style.setProperty("--safe-right", `${s.right}px`);
    root.dataset.fullscreen = app.isFullscreen ? "yes" : "no";
  };
  const viewport = () => { root.style.setProperty("--vh", `${app.viewportStableHeight}px`); root.dataset.expanded = app.isExpanded ? "yes" : "no"; };
  const theme = () => { root.dataset.scheme = app.colorScheme; };
  insets(); viewport(); theme();
  app.onEvent("safeAreaChanged", insets);
  app.onEvent("contentSafeAreaChanged", insets);
  app.onEvent("fullscreenChanged", insets);
  app.onEvent("viewportChanged", viewport);
  app.onEvent("themeChanged", theme);
  app.onEvent("activated", () => root.dispatchEvent(new CustomEvent("tg:activated")));
  app.onEvent("deactivated", () => root.dispatchEvent(new CustomEvent("tg:deactivated")));
}
