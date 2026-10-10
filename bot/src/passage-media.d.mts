export type PassageMediaMoment = { verses?: string; label?: string; date?: string; teacher?: string; video?: string; t?: number; ts?: string };
export type PassageMediaCatalog = {
  attribution: { label: string; url: string; termsUrl: string };
  works: { id: string; categories: string[]; editions: { en: Record<string, unknown> }; anchors: Record<string, unknown>[] }[];
  indexes: { chapters: Record<string, string[]>; strongs: Record<string, string[]>; library: string[] };
};
export const SLUGS: string[];
export function emptyCatalog(): PassageMediaCatalog;
export function buildCatalog(book: number, chapter: number, list: PassageMediaMoment[]): PassageMediaCatalog;
