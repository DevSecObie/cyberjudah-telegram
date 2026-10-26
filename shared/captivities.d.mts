import type { TimelineSection } from "./timeline.mjs";
export type Captivity = { id: string; age: string; years: string; from: number; to: number; color: string; page: number; prophets: string[]; figures: string[]; note?: string };
export const CAPTIVITIES: Captivity[];
export const PLACES: Record<string, { under: string } | { cut: { under: string; title?: string; subTitle: string; startYear: number; endYear: number; interval: number }[] }>;
export function captivityOf(s: TimelineSection): Captivity | undefined;
export function byCaptivity(sections: TimelineSection[]): TimelineSection[];
