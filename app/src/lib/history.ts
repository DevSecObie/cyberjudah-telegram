/** Bible Strong 27.2.0 history identities, adapted to CyberJudah's existing route identifiers. */
export type BibleHistoryRow = { type?: "bible"; slug: string; chapter: number; verse?: number; name: string; at: number };
export type StrongHistoryRow = { type: "strong"; reference: string; name: string; original?: string; at: number };
/** Producers can supply their dataset identity; slug is the existing dictionary route. */
export type DictionaryHistoryRow = { type: "dictionary"; slug: string; name: string; resourceId?: string; language?: string; entryId?: string | number; dictionaryTitle?: string; at: number };
export type TopicHistoryRow = { type: "topic"; slug: string; name: string; at: number };
export type NaveHistoryRow = { type: "nave"; slug: string; name: string; at: number };
export type HistoryRow = BibleHistoryRow | StrongHistoryRow | DictionaryHistoryRow | TopicHistoryRow | NaveHistoryRow;
type WithoutTime<T> = T extends HistoryRow ? Omit<T, "at"> : never;
export type HistoryInput = WithoutTime<HistoryRow>;
export const MAX_HISTORY_ITEMS = 50;
export const MAX_HISTORY_BYTES = 4096;
const encoder = new TextEncoder();
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
// Bound display text without splitting a surrogate pair. Identifiers are validated, never truncated.
const label = (value: unknown) => Array.from(text(value)).slice(0, 160).join("");
const slug = (value: unknown) => { const s = text(value); return s.length <= 160 && /^[a-z0-9][a-z0-9_-]*$/i.test(s) ? s : ""; };
export function historyStrongReference(value: string): string | null {
  const match = /^([HG])0*(\d{1,5})$/i.exec(value.trim());
  return match && Number(match[2]) > 0 ? `${match[1].toUpperCase()}${Number(match[2])}` : null;
}

/** One identity per verse, canonical Strong number, dictionary resource/entry, or topic. */
export function getHistoryItemKey(row: HistoryInput | HistoryRow): string {
  switch (row.type) {
    case "strong": return `strong:${historyStrongReference(row.reference) ?? row.reference}`;
    case "dictionary": return JSON.stringify(["dictionary", row.resourceId ?? "legacy", row.language ?? "legacy", row.entryId ?? row.slug.toLowerCase()]);
    case "topic": return `topic:${row.slug.toLowerCase()}`;
    case "nave": return `nave:${row.slug}`;
    default: return `bible:${row.slug}:${row.chapter}:${row.verse ?? 1}:KJV`;
  }
}

/** Remove corrupt/unknown fields before writing a bounded CloudStorage value. */
function normalizeRow(value: unknown): HistoryRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!positive(row.at)) return null;
  const name = label(row.name), at = row.at;
  if (!name) return null;
  if (row.type === "strong") {
    const reference = historyStrongReference(text(row.reference));
    return reference ? { type: "strong", reference, name, ...(text(row.original) ? { original: label(row.original) } : {}), at } : null;
  }
  if (row.type === "nave") {
    const nameLower = text(row.slug);
    return nameLower && nameLower.length <= 512 ? { type: "nave", slug: nameLower, name, at } : null;
  }
  const route = slug(row.slug);
  if (!route) return null;
  if (row.type === "topic") return { type: "topic", slug: route, name, at };
  if (row.type === "dictionary") {
    const out: DictionaryHistoryRow = { type: "dictionary", slug: route, name, at };
    for (const field of ["resourceId", "language", "dictionaryTitle"] as const) if (text(row[field]) && text(row[field]).length <= 160) out[field] = text(row[field]);
    if (positive(row.entryId) || (text(row.entryId) && text(row.entryId).length <= 160)) out.entryId = row.entryId as string | number;
    return out;
  }
  if (row.type !== undefined && row.type !== "bible") return null;
  if (!positive(row.chapter) || (row.verse !== undefined && !positive(row.verse))) return null;
  return { type: "bible", slug: route, chapter: row.chapter, verse: row.verse as number | undefined ?? 1, name, at };
}

/** Newest first, deduplicated, at most 50 rows and 4096 UTF-8 bytes including JSON punctuation. */
export function normalizeHistory(value: unknown): HistoryRow[] {
  if (!Array.isArray(value)) return [];
  const rows = value.map(normalizeRow).filter((row): row is HistoryRow => !!row).sort((a, b) => b.at - a.at);
  const seen = new Set<string>(), out: HistoryRow[] = [];
  for (const row of rows) {
    const key = getHistoryItemKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    if (encoder.encode(JSON.stringify([...out, row])).byteLength > MAX_HISTORY_BYTES) break;
    out.push(row);
    if (out.length === MAX_HISTORY_ITEMS) break;
  }
  return out;
}

/** Legacy Bible calls remain valid; revisiting any kind replaces its previous row. */
export function pushHistory(history: HistoryRow[], input: HistoryInput): HistoryRow[] {
  const row = normalizeRow({ ...input, at: Date.now() });
  if (!row) return normalizeHistory(history);
  const key = getHistoryItemKey(row);
  return normalizeHistory([row, ...normalizeHistory(history).filter(item => getHistoryItemKey(item) !== key)]);
}

/** Keep the established Bible chapter-at-verse destination pending the owner's decision. */
export function historyHref(row: HistoryRow): string {
  if (row.type === "strong") return `/lexicon/${encodeURIComponent(row.reference)}`;
  if (row.type === "dictionary") return `/dictionary/${encodeURIComponent(row.slug)}`;
  if (row.type === "topic") return `/topics/${encodeURIComponent(row.slug)}`;
  if (row.type === "nave") return `/nave/en/${encodeURIComponent(row.slug)}`;
  return `/read/${row.slug}/${row.chapter}${(row.verse ?? 1) > 1 ? `?at=${row.verse}` : ""}`;
}
