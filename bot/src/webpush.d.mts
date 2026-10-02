import type { PushSub } from "./reminders.mjs";
export type VapidKeys = { publicKey: string; privateKey: string; subject: string };
export function validSubscription(sub: unknown): sub is PushSub;
export function b64u(bytes: Uint8Array | string): string;
export function fromB64u(s: string): Uint8Array;
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now?: number): Promise<string>;
export function sendPush(sub: PushSub, keys: VapidKeys, opts?: { ttl?: number; fetchImpl?: typeof fetch; now?: number }): Promise<number>;
export const TOPIC: string;
