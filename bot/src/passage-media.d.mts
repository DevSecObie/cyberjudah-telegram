export type PassageMediaMoment = { verses?: string; label?: string; date?: string; teacher?: string; video?: string; t?: number; ts?: string };
export type PassageMediaCatalog = {
  attribution: { label: string; url: string; termsUrl: string };
  works: { id: string; categories: string[]; editions: { en: Record<string, unknown> }; anchors: Record<string, unknown>[] }[];
  indexes: { chapters: Record<string, string[]>; strongs: Record<string, string[]>; library: string[] };
};
export const SLUGS: string[];
export function emptyCatalog(): PassageMediaCatalog;
/** A class reading a verse aloud in a recording (the concordance's `read`). */
export type PassageMediaReading = { video?: string; t?: number; ts?: string; title?: string; date?: string; teacher?: string };
export function buildCatalog(book: number, chapter: number, list: PassageMediaMoment[], read?: Record<string, PassageMediaReading[]>): PassageMediaCatalog;
