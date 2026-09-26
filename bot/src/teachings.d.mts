export const OPEN: string;
export const CLOSE: string;
export const FEEDS: string[];
export const FEED_LABEL: Record<string, string>;
export function passageExcerpt(marked: string, cuesJson: string | null, passageStart: number): { excerpt: string; start: number; timing: "caption" | "passage" };
export function runs(marked: string): { text: string; match: boolean }[];
