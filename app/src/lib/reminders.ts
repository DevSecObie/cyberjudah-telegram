import { app, api, ApiError } from "@/tg/sdk";

/**
 * Reading reminders, the app's side (the rules are in bot/src/reminders.mjs). Inside
 * Telegram the reader is known by the launch data; in a browser by a device credential the
 * Worker hands out on the first save and this device keeps. Push is only offered in a
 * browser that can receive it.
 */
export type Channels = { telegram: boolean; push: boolean };
export type Pending = { day?: number; chapters: { slug: string; chapter: number }[]; date: string };
export type ReminderView = {
  ok: boolean; on: boolean; hour: number; tz: string; channels: Channels;
  telegramLinked: boolean; pushEndpoint: string | null; pausedUntil: string | null; done: string | null;
  pending: Pending[]; notice: "push-fallback" | null; publicKey: string | null;
  identity?: "telegram" | "device" | "none"; linked?: boolean; device?: string;
};
export type Content = { plan: { day: number; perDay: number } | null; last: { slug: string; chapter: number } | null };

const DEVICE = "cj:remind-device";
const device = (): string | null => { try { return localStorage.getItem(DEVICE); } catch { return null; } };
const keepDevice = (d: string) => { try { localStorage.setItem(DEVICE, d); } catch { /* private mode: asked again next time */ } };
/** Whether this browser has a reminder record (so the app syncs it on open). */
export const hasDevice = () => !!device();

export const timeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  if (app) return api<T>(path, init);
  const headers = new Headers(init?.headers);
  const d = device();
  if (d) headers.set("x-cj-device", d);
  let body = init?.body;
  if (init?.json !== undefined) { headers.set("content-type", "application/json"); body = JSON.stringify(init.json); }
  const res = await fetch(path, { ...init, headers, body });
  if (!res.ok) throw new ApiError(res.status, path);
  return (await res.json()) as T;
}

export const getReminder = () => call<ReminderView>(`/api/reminders?tz=${encodeURIComponent(timeZone())}`);
export async function saveReminder(body: { settings?: Partial<{ on: boolean; hour: number; tz: string; channels: Partial<Channels>; paused: boolean }>; content?: Content; push?: PushSubscriptionJSON | null; notice?: false }): Promise<ReminderView> {
  const v = await call<ReminderView>("/api/reminders", { method: "PUT", json: body });
  if (v.device) keepDevice(v.device);
  return v;
}
export const ackReminder = (dates: string[]) => call<ReminderView>("/api/reminders/ack", { method: "POST", json: { dates } });
export const linkLink = () => call<{ ok: boolean; link: string }>("/api/reminders/link", { method: "POST" });

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

/** Ask the browser for permission and subscribe. Resolves to the subscription, or why not. */
export async function subscribePush(publicKey: string): Promise<PushSubscriptionJSON | "denied" | "failed"> {
  try {
    const permission = await Notification.requestPermission();
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
export async function unsubscribePush(): Promise<void> {
  try { const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL); await (await reg?.pushManager.getSubscription())?.unsubscribe(); } catch { /* nothing to undo */ }
}

/** "7:00", "18:00". */
export const hourLabel = (h: number) => `${h}:00`;
