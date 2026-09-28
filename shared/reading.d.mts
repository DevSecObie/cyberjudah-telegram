export type ReadingChapter = { slug: string; book: string; chapter: number };
export type ReadingLog = { slug: string; chapter: number; day: string };
export type ReadingSettings = { timezone: string; time: string; enabled: boolean; weekly: boolean };
export function localClock(now: Date, timezone: string): { day: string; time: string };
export function shiftDay(day: string, n: number): string;
export function validReadingSettings(value: unknown): value is ReadingSettings;
export function readingSummary(catalog: ReadingChapter[], logs: ReadingLog[], day: string): {
 day: string; chapters: (ReadingChapter & { read: boolean })[]; count: number; totalRead: number; total: number; streak: number;
 calendar: { day: string; count: number }[]; completed: string[]; finished: boolean;
};
