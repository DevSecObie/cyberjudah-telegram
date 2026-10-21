import Fuse from "fuse.js";
import bookCatalog from "../../../bot/data/bs-books.json";
import type { Bookmark, Highlight } from "@/bible/store";
import type { Annotation } from "@/studies/storage";

/** Bible Strong's entityListQuery: the sorts its saved-item lists offer. */
export type EntityListSort = "newest" | "oldest" | "title-asc" | "title-desc" | "created-newest" | "created-oldest";
export type EntityListRow = { id: string; title: string; description?: string; date?: number; createdAt?: number };
export const ENTITY_LIST_SORTS: [EntityListSort, string][] = [["newest", "Newest"], ["oldest", "Oldest"], ["title-asc", "Title A–Z"], ["title-desc", "Title Z–A"]];

/** Bible Strong's searchFuzzy.searchWithMatches with its default options. */
export function searchWithMatches<T extends { title: string; description?: string }>(targets: T[], keyword: string): T[] {
  const trimmed = keyword.trim();
  if (trimmed.length < 2) return [];
  return new Fuse(targets, { keys: ["title", "description"], threshold: 0.15, ignoreDiacritics: true }).search(trimmed).map((result) => result.item);
}

const titleCompare = (left: EntityListRow, right: EntityListRow) =>
  left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);

/** Bible Strong's queryEntityList: search, then sort, keeping ties stable by id. */
export function queryEntityList<T extends EntityListRow>(rows: readonly T[], state: { query: string; sort: EntityListSort }): T[] {
  const matching = state.query.trim() ? searchWithMatches([...rows], state.query) : [...rows];
  return matching.sort((left, right) => {
    switch (state.sort) {
      case "created-newest": return Number(right.createdAt || 0) - Number(left.createdAt || 0) || left.id.localeCompare(right.id);
      case "created-oldest": return Number(left.createdAt || 0) - Number(right.createdAt || 0) || left.id.localeCompare(right.id);
      case "oldest": return Number(left.date || 0) - Number(right.date || 0) || left.id.localeCompare(right.id);
      case "title-asc": return titleCompare(left, right);
      case "title-desc": return -left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);
      case "newest":
      default: return Number(right.date || 0) - Number(left.date || 0) || left.id.localeCompare(right.id);
    }
  });
}

export type BasicListQuery = { query: string; sort: EntityListSort; tagId: string | null };
export const DEFAULT_NOTES_QUERY: BasicListQuery = { query: "", sort: "newest", tagId: null };
export function normalizeListQuery(value: unknown): BasicListQuery {
  const v = value && typeof value === "object" ? value as Partial<BasicListQuery> : {};
  return { query: typeof v.query === "string" ? v.query : "", sort: [...ENTITY_LIST_SORTS.map(([sort]) => sort), "created-newest", "created-oldest"].includes(v.sort ?? "") ? v.sort! : "newest", tagId: typeof v.tagId === "string" ? v.tagId : null };
}

export type HighlightFilters = { colorId?: string; tagId?: string; typeFilter?: "all" | "highlights" | "annotations"; testament?: "all" | "old" | "new"; book?: string; sort?: "newest" | "oldest" | "bible" };
export const bookNumber = (slug: string) => bookCatalog.find(book => book.slug === slug)?.id ?? 1000;
export const inTestament = (slug: string, testament?: HighlightFilters["testament"]) => !testament || testament === "all" || (testament === "old" ? bookNumber(slug) <= 39 : bookNumber(slug) >= 40 && bookNumber(slug) <= 66);
export function normalizeHighlightFilters(value: unknown): HighlightFilters {
  if (!value || typeof value !== "object") return {};
  const v = value as HighlightFilters;
  const testament = ["all", "old", "new"].includes(String(v.testament)) ? v.testament : "all";
  return { colorId: typeof v.colorId === "string" ? v.colorId : undefined, tagId: typeof v.tagId === "string" ? v.tagId : undefined, typeFilter: ["all", "highlights", "annotations"].includes(String(v.typeFilter)) ? v.typeFilter : undefined, testament, book: typeof v.book === "string" && bookNumber(v.book) !== 1000 && inTestament(v.book, testament) ? v.book : undefined, sort: ["newest", "oldest", "bible"].includes(String(v.sort)) ? v.sort : "newest" };
}

export type HighlightChapter = { slug: string; chapter: number; verses: Record<string, Highlight> };
export type HighlightLocation = { slug: string; chapter: number; verse: number };
export type HighlightListItem = { id: string; kind: "highlight" | "annotation"; date: number; color: string; tags: Record<string, true>; locations: HighlightLocation[]; text?: string; style?: Annotation["style"] };
const location = (key: string): HighlightLocation | undefined => { const match = /^(.+)-(\d+)-(\d+)$/.exec(key); return match ? { slug: match[1], chapter: +match[2], verse: +match[3] } : undefined; };
const compareLocation = (a: HighlightLocation, b: HighlightLocation) => bookNumber(a.slug) - bookNumber(b.slug) || a.chapter - b.chapter || a.verse - b.verse;
export const highlightKey = (v: HighlightLocation) => `${v.slug}-${v.chapter}-${v.verse}`;

/** 27.2.0 groups verse highlights by date after filtering; word marks keep their whole span. */
export function queryHighlights(chapters: HighlightChapter[], annotations: Annotation[], filters: HighlightFilters): HighlightListItem[] {
  const matchesLocation = (v: HighlightLocation) => filters.book ? v.slug === filters.book : inTestament(v.slug, filters.testament);
  const matches = (v: { color?: string; tags?: Record<string, true> }) => (!filters.colorId || v.color === filters.colorId) && (!filters.tagId || v.tags?.[filters.tagId]);
  const groups = new Map<number, HighlightListItem>();
  if (filters.typeFilter !== "annotations") for (const chapter of chapters) for (const [verse, record] of Object.entries(chapter.verses)) {
    const at = { slug: chapter.slug, chapter: chapter.chapter, verse: +verse };
    if (!Number.isInteger(at.verse) || at.verse < 1 || !matches(record) || !matchesLocation(at)) continue;
    const group = groups.get(record.date) ?? { id: "", kind: "highlight", date: record.date, color: record.color, tags: {}, locations: [] };
    group.locations.push(at); Object.assign(group.tags, record.tags); groups.set(record.date, group);
  }
  const rows = [...groups.values()];
  for (const row of rows) { row.locations.sort(compareLocation); row.id = `highlight-${row.locations.map(highlightKey).join("/")}`; }
  if (filters.typeFilter !== "highlights") {
    const marks = new Map<string, Annotation[]>();
    for (const record of annotations) { const id = record.group ?? record.id; marks.set(id, [...(marks.get(id) ?? []), record]); }
    for (const [id, records] of marks) {
      records.sort((a, b) => a.verseKey.localeCompare(b.verseKey, undefined, { numeric: true }) || a.start - b.start);
      const first = records[0], locations = records.map(r => location(r.verseKey)).filter((v): v is HighlightLocation => !!v).sort(compareLocation);
      if (!matches(first) || !locations.some(matchesLocation)) continue;
      rows.push({ id: `annotation-${id}`, kind: "annotation", date: Date.parse(first.created) || 0, color: first.color ?? "color1", tags: first.tags ?? {}, locations, text: records.map(r => r.quote.trim()).join(" … "), style: first.style });
    }
  }
  return rows.sort((a, b) => (filters.sort === "bible" ? compareLocation(a.locations[0], b.locations[0]) : filters.sort === "oldest" ? a.date - b.date : b.date - a.date) || a.id.localeCompare(b.id));
}

/** Bookmarks use substring matching, including the reference; their query is session-local. */
export function queryBookmarks(rows: Bookmark[], state: { query: string; sort: "newest" | "oldest" }, reference: (b: Bookmark) => string): Bookmark[] {
  return rows.filter(b => `${b.name} ${reference(b)}`.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase())).sort((a, b) => state.sort === "oldest" ? a.date - b.date : b.date - a.date);
}

/** A note on a multi-verse word mark appears once, at its first verse. */
export function annotationNoteRows(annotations: Annotation[]) {
  const seen = new Set<string>();
  return [...annotations].sort((a, b) => a.verseKey.localeCompare(b.verseKey, undefined, { numeric: true }) || a.start - b.start).flatMap(record => {
    const id = record.group ?? record.id, at = location(record.verseKey);
    if (!record.note || !at || seen.has(id)) return [];
    seen.add(id);
    return [{ slug: at.slug, chapter: at.chapter, key: String(at.verse), note: { ...record.note, id: `annotation:${id}`, tags: record.tags }, annotation: true }];
  });
}
