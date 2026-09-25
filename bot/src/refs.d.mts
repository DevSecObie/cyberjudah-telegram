export type BookRow = { book: string; slug: string; chapters: number; verses?: number; testament?: string; url?: string; chapterIds?: number[] };
export type Reference = { book: string; slug: string; chapter: number; verse?: number; verseEnd?: number; label: string };
export function findBook(name: string, books: readonly BookRow[]): BookRow | null;
export function parseReference(query: string, books: readonly BookRow[]): Reference | null;
