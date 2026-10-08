import { useStored } from "@/tg/hooks";

/**
 * The reader's marks, in CloudStorage: bookmarks (a verse or a note kept for later, with the
 * text so the list reads without a fetch), coloured highlights and notes per chapter, reading
 * progress (chapters read, compressed per book), the reading plan, the last place read and
 * the history. Every value stays inside CloudStorage's 4 KB.
 */
export type Bookmark = { id: string; kind: "verse" | "note"; title: string; text: string; href: string; tags?: string[]; at: number };
/** "16:y,17-18:g" per chapter key "john/3". */
export type Highlights = Record<string, string>;
/** Notes per verse, keyed "john/3" -> { "16": "..." }. One CloudStorage key per chapter. */
export type VerseNotes = Record<string, string>;
export type Progress = Record<string, string>;
export type Last = { slug: string; chapter: number; name: string; at: number };
export type HistoryRow = { slug: string; chapter: number; name: string; at: number };
export type Plan = { startedAt: string; day: number; streak: number; lastDone?: string; perDay: number; books?: string[]; name?: string } | null;

export const COLORS = [
  { id: "y", label: "Yellow", css: "#fcee0a" }, { id: "g", label: "Green", css: "#3ddc84" }, { id: "b", label: "Blue", css: "#00e5ff" },
  { id: "p", label: "Pink", css: "#ff2d78" }, { id: "o", label: "Orange", css: "#ff9f1c" }, { id: "v", label: "Violet", css: "#a78bfa" },
];

export const useBookmarks = () => useStored<Bookmark[]>("bm", []);
export const useHighlights = () => useStored<Highlights>("hl", {});
export const useProgress = () => useStored<Progress>("read", {});
export const useLast = () => useStored<Last | null>("last", null);
/** The last class or episode opened, to continue watching from Home. */
export const useLastNote = () => useStored<{ href: string; title: string; at: number } | null>("lastnote", null);
export const useHistory = () => useStored<HistoryRow[]>("hist", []);
export const usePlan = () => useStored<Plan>("plan", null);
export const useRecentSearches = () => useStored<string[]>("recent", []);
export const useVerseNotes = (slug: string, ch: number) => useStored<VerseNotes>(`nt_${slug}_${ch}`, {});

export function toggleBookmark(list: Bookmark[], b: Omit<Bookmark, "at">): Bookmark[] {
  const has = list.some((x) => x.id === b.id);
  const next = has ? list.filter((x) => x.id !== b.id) : [{ ...b, at: Date.now() }, ...list];
  return next.slice(0, 40).map((x) => ({ ...x, text: x.text.slice(0, 140) }));
}
export function tagBookmark(list: Bookmark[], id: string, tags: string[]): Bookmark[] {
  return list.map((x) => (x.id === id ? { ...x, tags: tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 5) } : x));
}

/** "1-3,7" <-> chapters. */
export function expand(spec?: string): Set<number> {
  const out = new Set<number>();
  for (const part of (spec ?? "").split(",")) { const m = /^(\d+)(?:-(\d+))?$/.exec(part); if (!m) continue; for (let v = +m[1]; v <= (m[2] ? +m[2] : +m[1]); v++) out.add(v); }
  return out;
}
export function compress(set: Iterable<number>): string {
  const s = [...new Set(set)].sort((a, b) => a - b); const out: string[] = [];
  for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i])); i = j; }
  return out.join(",");
}
export function markRead(p: Progress, slug: string, ch: number): Progress {
  const set = expand(p[slug]); if (set.has(ch)) return p; set.add(ch);
  return { ...p, [slug]: compress(set) };
}
export function unmarkRead(p: Progress, slug: string, ch: number): Progress {
  const set = expand(p[slug]); if (!set.delete(ch)) return p;
  const next = { ...p }; const s = compress(set);
  if (s) next[slug] = s; else delete next[slug];
  return next;
}
export const isRead = (p: Progress, slug: string, ch: number) => expand(p[slug]).has(ch);
export const chaptersRead = (p: Progress) => Object.values(p).reduce((n, s) => n + expand(s).size, 0);

/** Highlights: verse -> colour id for one chapter. */
export function parseHl(spec?: string): Map<number, string> {
  const m = new Map<number, string>();
  for (const part of (spec ?? "").split(",")) {
    const [range, color = "y"] = part.split(":");
    for (const v of expand(range)) m.set(v, color);
  }
  return m;
}
export function serializeHl(m: Map<number, string>): string {
  const byColor = new Map<string, number[]>();
  for (const [v, c] of m) byColor.set(c, [...(byColor.get(c) ?? []), v]);
  return [...byColor].map(([c, vs]) => compress(vs).split(",").map((r) => `${r}:${c}`).join(",")).join(",");
}
export function setHighlight(hl: Highlights, key: string, verses: number[], color: string | null): Highlights {
  const m = parseHl(hl[key]);
  for (const v of verses) color ? m.set(v, color) : m.delete(v);
  const next = { ...hl }; const s = serializeHl(m);
  if (s) next[key] = s; else delete next[key];
  return next;
}

export function pushHistory(h: HistoryRow[], row: Omit<HistoryRow, "at">): HistoryRow[] {
  return [{ ...row, at: Date.now() }, ...h.filter((x) => !(x.slug === row.slug && x.chapter === row.chapter))].slice(0, 30);
}

/** Yesterday / today as YYYY-MM-DD in local time, for streaks. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
