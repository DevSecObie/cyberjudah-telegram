export type HolyKind = "sabbath" | "feast" | "newmoon";
export type ListedDay = { date: string; kind: "feast" | "newmoon"; name?: string };
export type Pause = { kind: HolyKind; name: string; from: number; until: number; zone: string };

export const DEFAULT_ZONE: string;
export const FULL_DARK_DEG: number;
export const HOLY_DAYS: ListedDay[];
export function zoneOf(tz: unknown): string;
export function coordsOf(tz: unknown): [number, number];
export function localDate(ms: number, tz: unknown): string;
export function localHour(ms: number, tz: unknown): number;
export function addDays(date: string, n: number): string;
export function fullDark(date: string, lat: number, lon: number, deg?: number): { at: number; deepest: boolean };
export function fullDarkIn(date: string, tz: unknown): number;
export function holyDay(date: string, days?: ListedDay[]): { kind: HolyKind; name: string } | null;
export function topupPause(now: number, tz: unknown, days?: ListedDay[]): Pause | null;
export function pauseDay(p: Pause): string;
export function pauseMessage(p: Pause): string;
export function eveOfHolyDay(now: number, tz: unknown, days?: ListedDay[]): { date: string; kind: HolyKind; name: string } | null;
