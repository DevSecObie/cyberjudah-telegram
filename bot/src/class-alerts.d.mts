import type { LiveNow, RecentVideo } from "./live.mjs";
export type ClassAlert = { video: string; title: string; live: boolean };
export const SEEN_LIMIT: number;
export const ALERTS_PER_RUN: number;
export const FRESH_MS: number;
export function planClassAlerts(input: { videos: RecentVideo[]; live: LiveNow | null; seen: string[] | null; now: number }): { alerts: ClassAlert[]; seen: string[] };
export function fcmMessage(alert: ClassAlert, topic: string): { message: Record<string, unknown> };
