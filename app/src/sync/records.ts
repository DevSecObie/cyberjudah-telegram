import { migrationDocumentId, type MigrationRecord } from "./migration";
import type { LegacyDeviceSnapshot } from "./sources";

/** Keep the reader's values intact; only the Firestore envelope is new. */
export function readerCollection(key: string): MigrationRecord["collection"] | undefined {
  if (key === "studies" || key === "wordAnnotations") return key;
  if (/^bs_h_.+_\d+$/.test(key) || key === "hl") return "highlights";
  if (/^(bs_n|nt)_.+_\d+$/.test(key)) return "notes";
  if (/^bs_l_.+_\d+$/.test(key)) return "links";
  if (key === "bs_bm" || key === "bm") return "bookmarks";
  if (key === "bs_tags") return "tags";
  if (/^rel_.+_\d+$/.test(key)) return "relations";
}
const isList = (key: string) => key === "bs_bm" || key === "bm" || /^rel_.+_\d+$/.test(key);
export function readerEntries(key: string, raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  const value = JSON.parse(raw);
  if (isList(key)) {
    if (!Array.isArray(value) || value.some(v => !v || typeof v.id !== "string")) throw new Error("Invalid saved bookmarks; the original is unchanged.");
    if (new Set(value.map(v => v.id)).size !== value.length) throw new Error("Duplicate saved bookmark IDs; the original is unchanged.");
    return { _list: value }; // Preserve the original list order as well as its values.
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved reader data; the original is unchanged.");
  return value;
}
export const readerValue = (key: string, entries: Record<string, unknown>) => JSON.stringify(isList(key) ? entries._list ?? [] : entries);
export const recordIdentity = (key: string, entry: string) => JSON.stringify([key, entry]);
export async function readerRecords(values: Record<string, string>): Promise<MigrationRecord[]> {
  const records: MigrationRecord[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const collection = readerCollection(key); if (!collection) continue;
    for (const [entry, value] of Object.entries(readerEntries(key, raw))) {
      const sourceIdentity = recordIdentity(key, entry);
      records.push({ collection, id: await migrationDocumentId(sourceIdentity), sourceIdentity, data: { key, entry, value, revision: "imported" } });
    }
  }
  return records;
}
export async function deviceRecords(snapshot: LegacyDeviceSnapshot, uid: string) {
  const records = await readerRecords(snapshot.localValues);
  for (const [collection, values] of [["studies", snapshot.studies], ["wordAnnotations", snapshot.annotations]] as const) {
    for (const value of values) {
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") throw new Error("Invalid local study; the original is unchanged.");
      const sourceIdentity = recordIdentity(collection, value.id);
      records.push({ collection, id: await migrationDocumentId(sourceIdentity), sourceIdentity, data: { key: collection, entry: value.id, value, revision: "imported", ...(collection === "studies" ? { user: { id: uid } } : {}) } });
    }
  }
  return records;
}
