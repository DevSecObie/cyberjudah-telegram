import { searchWithMatches } from "./entity-list";
import type { Highlight, Link, Note, Tag } from "@/bible/store";
import type { Annotation } from "@/studies/storage";

export type TagSort = "name-asc" | "name-desc" | "count-asc" | "count-desc";
export type TagQuery = { query: string; sort: TagSort };
export const TAG_SORTS: [TagSort, string][] = [["name-asc", "Name A–Z"], ["name-desc", "Name Z–A"], ["count-asc", "Item count ascending"], ["count-desc", "Item count descending"]];
export const DEFAULT_TAG_QUERY: TagQuery = { query: "", sort: "name-asc" };
export function normalizeTagQuery(value: unknown): TagQuery {
  const state = value && typeof value === "object" ? value as Partial<TagQuery> : {};
  return { query: typeof state.query === "string" ? state.query : "", sort: TAG_SORTS.some(([sort]) => sort === state.sort) ? state.sort! : "name-asc" };
}

export type TaggedItem = { id: string; kind: "highlight" | "word" | "note" | "link"; date: number; references: string[]; tags?: Record<string, true>; title?: string; description?: string; color?: string; url?: string; style?: Annotation["style"] };
export type TagChapter = { slug: string; chapter: number; kind: "h" | "n" | "l"; records: Record<string, Highlight | Note | Link> };

export function buildTagInventory(chapters: TagChapter[], annotations: Annotation[]): TaggedItem[] {
  const rows: TaggedItem[] = [];
  for (const chapter of chapters) for (const [key, record] of Object.entries(chapter.records)) {
    const references = key.split("/").map(Number).filter(v => Number.isInteger(v) && v > 0).map(v => `${chapter.slug}-${chapter.chapter}-${v}`);
    if (!references.length) continue;
    if (chapter.kind === "h") rows.push({ id: references[0], kind: "highlight", references, ...record as Highlight });
    else rows.push({ ...record as Note | Link, kind: chapter.kind === "n" ? "note" : "link", references });
  }
  for (const record of [...annotations].sort((a, b) => a.verseKey.localeCompare(b.verseKey, undefined, { numeric: true }) || a.start - b.start)) rows.push({ id: record.group ?? record.id, kind: "word", references: [record.verseKey], date: Date.parse(record.created) || 0, tags: record.tags, color: record.color, style: record.style, description: record.quote });
  return rows;
}

/** 27.2.0 groups verse highlights by their creation date and annotations by mark identity. */
export function itemsForTag(inventory: TaggedItem[], tag: string): TaggedItem[] {
  const groups = new Map<string, TaggedItem>();
  for (const row of inventory.filter(row => row.tags?.[tag])) {
    const key = `${row.kind}:${row.kind === "highlight" ? row.date : row.id}`;
    const previous = groups.get(key);
    if (!previous) groups.set(key, { ...row, id: key, references: [...row.references] });
    else {
      previous.references = [...new Set([...previous.references, ...row.references])];
      if (row.kind === "word") previous.description = `${previous.description?.trim()} … ${row.description?.trim()}`;
    }
  }
  return [...groups.values()].sort((a, b) => b.date - a.date || a.id.localeCompare(b.id));
}

export function queryTags(tags: Tag[], inventory: TaggedItem[], state: TagQuery) {
  const rows = tags.map(tag => {
    const items = itemsForTag(inventory, tag.id);
    const counts = { highlights: items.filter(item => item.kind === "highlight" || item.kind === "word").length, notes: items.filter(item => item.kind === "note").length, links: items.filter(item => item.kind === "link").length };
    // The reference sorts by live entity count, while the chip counts grouped highlights.
    const itemCount = inventory.filter(item => item.kind === "highlight" && item.tags?.[tag.id]).length + items.filter(item => item.kind !== "highlight").length;
    return { id: tag.id, title: tag.name, tag, counts, itemCount };
  });
  const matching = state.query.trim() ? searchWithMatches(rows, state.query) : rows;
  return matching.sort((a, b) => {
    const order = state.sort.startsWith("count") ? a.itemCount - b.itemCount : a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    return (state.sort.endsWith("desc") ? -order : order) || a.id.localeCompare(b.id);
  });
}
