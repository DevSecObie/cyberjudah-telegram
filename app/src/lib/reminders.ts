import { api, app, deviceCredential, dropDevice, keepDevice } from "@/tg/sdk";

/**
 * Reading reminders, the app's side (the rules are in bot/src/reminders.mjs). Inside
 * Telegram the reader is known by the launch data; in a browser by a device credential the
 * Worker hands out on the first save and this device keeps. Push is only offered in a
 * browser that can receive it.
 */
export type Channels = { telegram: boolean; push: boolean };
export type Pending = { day?: number; chapters: { slug: string; chapter: number }[]; date: string };
export type ReminderView = {
  ok: boolean; on: boolean; hour: number; minute: number; tz: string; channels: Channels;
  telegramLinked: boolean; pushEndpoints: string[]; pausedUntil: string | null; done: string | null;
  pending: Pending[]; notice: "push-fallback" | null; publicKey: string | null;
  identity?: "telegram" | "device" | "none"; linked?: boolean; device?: string;
};
export type Content = { plan: { day: number; perDay: number } | null; last: { slug: string; chapter: number } | null };

/** Whether this browser has a credential (so the app syncs its reminder on open). */
export const hasDevice = () => !!deviceCredential();

export const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

/** Telegram launch data, else this browser's credential (tg/sdk authHeaders). */
const call = api;

export const getReminder = () => call<ReminderView>(`/api/reminders?tz=${encodeURIComponent(timeZone())}`);
export type Settings = Partial<{ on: boolean; hour: number; minute: number; tz: string; channels: Partial<Channels>; paused: boolean; pauseDays: number; pauseUntil: string }>;
/** A pause: until tomorrow, a week, a chosen date, or until resumed (bot/src/reminders.mjs pause). */
export const PAUSE_FOREVER = "9999-12-31";
export async function saveReminder(body: { settings?: Settings; content?: Content; push?: PushSubscriptionJSON; pushRemove?: string; notice?: false }): Promise<ReminderView> {
  const v = await call<ReminderView>("/api/reminders", { method: "PUT", json: body });
  if (v.device) keepDevice(v.device);
  return v;
}
export const ackReminder = (dates: string[]) => call<ReminderView>("/api/reminders/ack", { method: "POST", json: { dates } });
export const linkLink = () => call<{ ok: boolean; link: string }>("/api/reminders/link", { method: "POST" });
/** Forget: this browser's credential and subscription (or, in Telegram, the whole reminder). */
export async function forgetReminder(endpoint: string | null): Promise<void> {
  await call<{ ok: boolean }>("/api/reminders", { method: "DELETE", json: { endpoint } });
  dropDevice();
}

/** Where push stands in this environment, for the settings screen's explanations. */
export type PushState = "telegram" | "ios-browser" | "unsupported" | "no-server" | "denied" | "ask" | "granted";
export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isStandalone() {
  return (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
export function pushState(publicKey: string | null): PushState {
  if (app) return "telegram";
  if (isIos() && !isStandalone()) return "ios-browser";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (!publicKey) return "no-server";
  if (Notification.permission === "denied") return "denied";
  return Notification.permission === "granted" ? "granted" : "ask";
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Ask the browser for permission and subscribe. Resolves to the subscription, or why not:
 * "denied" when the reader said no (the browser will not ask again), "dismissed" when the
 * prompt was closed without an answer (it can be asked again), "failed" when the browser
 * could not subscribe.
 */
export async function subscribePush(publicKey: string): Promise<PushSubscriptionJSON | "denied" | "dismissed" | "failed"> {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "default") return "dismissed";
    if (permission !== "granted") return "denied";
    const base = import.meta.env.BASE_URL;
    const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    return sub.toJSON();
  } catch {
    return "failed";
  }
}
/** This browser's own push endpoint, if it has subscribed. */
export async function currentEndpoint(): Promise<string | null> {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
  } catch { return null; }
}
/** This browser's subscription, to refresh it with the Worker on each open (web.dev: re-sync on every visit). */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  try {
    if (!("serviceWorker" in navigator) || Notification.permission !== "granted") return null;
    const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
    return (await reg?.pushManager.getSubscription())?.toJSON() ?? null;
  } catch { return null; }
}
export async function unsubscribePush(): Promise<void> {
  try { const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL); await (await reg?.pushManager.getSubscription())?.unsubscribe(); } catch { /* nothing to undo */ }
}

/** "7:00", "18:45". */
export const timeLabel = (h: number, m = 0) => `${h}:${String(m).padStart(2, "0")}`;
