export const VERSES: readonly (readonly [string, number, number])[];
export function bookLabel(slug: string): string;
export function verseOfDay(date?: Date | string): { ref: string; slug: string; chapter: number; verse: number };
