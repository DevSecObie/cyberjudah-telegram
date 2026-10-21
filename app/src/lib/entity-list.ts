import Fuse from "fuse.js";

/** Bible Strong's entityListQuery: the sorts its saved-item lists offer. */
export type EntityListSort = "newest" | "oldest" | "title-asc" | "title-desc";
export type EntityListRow = { id: string; title: string; description?: string; date?: number };
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
      case "oldest": return Number(left.date || 0) - Number(right.date || 0) || left.id.localeCompare(right.id);
      case "title-asc": return titleCompare(left, right);
      case "title-desc": return -left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);
      case "newest":
      default: return Number(right.date || 0) - Number(left.date || 0) || left.id.localeCompare(right.id);
    }
  });
}

/** Bible Strong's tagListQuery: the tag list's sorts, by name or by how much each tag carries. */
export type TagListSort = "name-asc" | "name-desc" | "count-asc" | "count-desc";
export const TAG_LIST_SORTS: [TagListSort, string][] = [["name-asc", "Name A–Z"], ["name-desc", "Name Z–A"], ["count-asc", "Item count ascending"], ["count-desc", "Item count descending"]];
export type TagListRow = { id: string; title: string; itemCount: number };
export function queryTagList<T extends TagListRow>(rows: readonly T[], state: { query: string; sort: TagListSort }): T[] {
  const matching = state.query.trim() ? searchWithMatches([...rows], state.query) : [...rows];
  return matching.sort((left, right) => {
    switch (state.sort) {
      case "name-desc": return -left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);
      case "count-asc": return left.itemCount - right.itemCount || left.id.localeCompare(right.id);
      case "count-desc": return right.itemCount - left.itemCount || left.id.localeCompare(right.id);
      case "name-asc":
      default: return left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) || left.id.localeCompare(right.id);
    }
  });
}
