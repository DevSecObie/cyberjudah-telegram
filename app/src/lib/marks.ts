import { useStored } from "@/tg/hooks";

/**
 * The reader's marks, in CloudStorage: bookmarks (a verse or a note kept for later, with the
 * text so the list reads without a fetch), highlights (verses, per chapter), reading progress
 * (chapters read, compressed per book, for the 4-a-day plan) and the last place read.
 */
export type Bookmark = { id: string; kind: "verse" | "note"; title: string; text: string; href: string; at: number };
export type Highlights = Record<string, string>;
export type Progress = Record<string, string>;
export type Last = { slug: string; chapter: number; name: string; at: number };

export const useBookmarks = () => useStored<Bookmark[]>("bm", []);
export const useHighlights = () => useStored<Highlights>("hl", {});
export const useProgress = () => useStored<Progress>("read", {});
export const useLast = () => useStored<Last | null>("last", null);
export const useRecentSearches = () => useStored<string[]>("recent", []);

export function toggleBookmark(list: Bookmark[], b: Omit<Bookmark, "at">): Bookmark[] {
  const has = list.some((x) => x.id === b.id);
  const next = has ? list.filter((x) => x.id !== b.id) : [{ ...b, at: Date.now() }, ...list];
  // CloudStorage values are 4 KB; 40 marks with a line of text each stay well inside.
  return next.slice(0, 40).map((x) => ({ ...x, text: x.text.slice(0, 140) }));
}

/** "1-3,7" <-> chapters, per book, so a whole reading history fits in one value. */
export function expand(spec?: string): Set<number> {
  const out = new Set<number>();
  for (const part of (spec ?? "").split(",")) { const m = /^(\d+)(?:-(\d+))?$/.exec(part); if (!m) continue; for (let v = +m[1]; v <= (m[2] ? +m[2] : +m[1]); v++) out.add(v); }
  return out;
}
export function compress(set: Set<number>): string {
  const s = [...set].sort((a, b) => a - b); const out: string[] = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i])); i = j; }
  return out.join(",");
}
export function markRead(p: Progress, slug: string, ch: number): Progress {
  const set = expand(p[slug]); if (set.has(ch)) return p; set.add(ch);
  return { ...p, [slug]: compress(set) };
}
export const chaptersRead = (p: Progress) => Object.values(p).reduce((n, s) => n + expand(s).size, 0);
