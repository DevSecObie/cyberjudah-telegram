import { z } from "zod";

/** Release paths are opaque identifiers, never URLs or caller-selected R2 keys. */
export const ResourceId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
export const ReleaseId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/);
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const HttpsUrl = z.url().refine((v) => new URL(v).protocol === "https:", "HTTPS required");
const SourceUrl = z.url().refine((v) => ["https:", "http:"].includes(new URL(v).protocol), "Web source required");
export const MAX_SHARD_BYTES = 2 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const MAX_CATALOG_BYTES = 512 * 1024;
export const ResourceKind = z.enum(["bible", "lexicon", "dictionary", "reference", "timeline"]);
export const ShardSchema = z.strictObject({
  path: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}\.ndjson$/),
  sha256: Sha256, bytes: z.int().positive().max(MAX_SHARD_BYTES),
  records: z.int().positive().max(20_000),
});
export const ManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id: ResourceId, release: ReleaseId, kind: ResourceKind,
  title: z.string().min(1).max(200), language: z.string().min(2).max(35),
  text: z.literal("KJV").optional(), canon: z.literal("kjv-1611-apocrypha").optional(),
  source: z.array(z.strictObject({ url: HttpsUrl, revision: z.string().min(1).max(200), sha256: Sha256 })).min(1).max(100),
  license: z.array(z.strictObject({ id: z.enum(["public-domain", "CC-BY-4.0", "owner-content"]), url: HttpsUrl, attribution: z.string().min(1).max(4000), modifications: z.string().max(4000) })).min(1).max(100),
  approval: z.strictObject({ reference: HttpsUrl, approvedBy: z.string().min(1).max(100) }),
  parts: z.array(ShardSchema).min(1).max(4096),
}).superRefine((m, ctx) => {
  if (m.kind === "bible" && (m.text !== "KJV" || m.canon !== "kjv-1611-apocrypha")) ctx.addIssue({ code: "custom", message: "Only KJV with Apocrypha is approved", path: ["text"] });
  if (new Set(m.parts.map((p) => p.path)).size !== m.parts.length) ctx.addIssue({ code: "custom", message: "Duplicate shard path", path: ["parts"] });
  if (m.license.some((l) => l.id === "owner-content") && m.kind !== "timeline") ctx.addIssue({ code: "custom", message: "Owner content is reserved for the CyberJudah timeline", path: ["license"] });
});
export const CatalogSchema = z.strictObject({
  schemaVersion: z.literal(1), revision: z.int().nonnegative(),
  resources: z.array(z.strictObject({ id: ResourceId, release: ReleaseId, manifestSha256: Sha256 })).max(100),
}).superRefine((c, ctx) => {
  if (new Set(c.resources.map((r) => r.id)).size !== c.resources.length) ctx.addIssue({ code: "custom", message: "Duplicate resource", path: ["resources"] });
});
export type Manifest = z.infer<typeof ManifestSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type ResourceRecord = { key: string; data: unknown };
export const RecordSchema = z.strictObject({ key: z.string().min(1).max(200).regex(/^[A-Za-z0-9/_-]+$/), data: z.unknown() });

// Payloads retain their existing fields. Contract parsing must not strip chronology,
// quotations, source-calendar dates or proposed events without absolute dates.
const Scripture = z.looseObject({ ref: z.string().min(1), why: z.string().optional() });
const Source = z.looseObject({ title: z.string().min(1), url: SourceUrl });
const TimelineEventPayload = z.looseObject({
  slug: ResourceId, title: z.string().min(1),
  start: z.int().nullable().optional(), end: z.int().nullable().optional(), period: z.string().optional(),
  date: z.looseObject({ text: z.string().min(1), precision: z.enum(["day", "month", "year", "circa", "range", "decade", "unknown"]) }).optional(),
  tribes: z.array(z.enum(["Judah", "Benjamin", "Levi", "Simeon", "Zebulon", "Ephraim", "Manasseh", "Gad", "Reuben", "Naphtali", "Asher", "Issachar"])).optional(),
  answer: z.array(Scripture).optional(), scriptures: z.array(Scripture).optional(),
  scriptureRefs: z.array(z.string().regex(/^[a-z0-9-]+\/\d+\/\d+$/)).optional(),
  teaching: z.array(z.looseObject({ source: Source, points: z.array(z.string()).optional(), quote: z.string().optional() })).optional(),
  sources: z.array(Source).optional(),
  image: z.looseObject({ kind: z.enum(["archival", "generated"]), src: z.string().min(1), caption: z.string().min(1), license: z.string().optional(), sourceUrl: SourceUrl.optional(), credit: z.string().optional() }).optional(),
});
const checkTimelineEvent = (e: { start?: number | null; end?: number | null; image?: { kind: string; caption: string; license?: string; sourceUrl?: string; credit?: string } }, ctx: z.RefinementCtx) => {
  if ((e.start == null) !== (e.end == null) || (e.start != null && e.end != null && e.end < e.start)) ctx.addIssue({ code: "custom", message: "Invalid event year range" });
  if (e.image?.kind === "archival" && (!e.image.license || !e.image.sourceUrl || !e.image.credit)) ctx.addIssue({ code: "custom", message: "Archival images require source, credit and license" });
  if (e.image?.kind === "generated" && !/generated/i.test(e.image.caption)) ctx.addIssue({ code: "custom", message: "Generated image captions must identify their origin" });
};
export const TimelineEventSchema = TimelineEventPayload.superRefine(checkTimelineEvent);
const PeriodSchema = z.looseObject({ id: z.string().min(1), title: z.string().min(1), startYear: z.int(), endYear: z.int(), interval: z.number().positive() });
export const TimelineSchema = z.union([
  z.looseObject({ proposedTitle: z.string().min(1), placement: z.string().min(1), events: z.array(TimelineEventSchema) }),
  z.looseObject({ periods: z.array(PeriodSchema), events: z.array(TimelineEventSchema) }),
  // Imported Bible Strong chronology contains legacy reversed/zero end years.
  // Preserve its bytes; do not silently repair historical dates during transport.
  z.looseObject({ sections: z.array(PeriodSchema.extend({ events: z.array(TimelineEventPayload) })) }),
  z.looseObject({ age: z.string().min(1), periods: z.array(PeriodSchema) }),
  // The generated Final Captivity file uses the event slug as its map key.
  z.record(ResourceId, TimelineEventPayload.partial({ slug: true }).superRefine(checkTimelineEvent)),
]);
export function releasePrefix(id: string, release: string): string { return `resources/${ResourceId.parse(id)}/${ReleaseId.parse(release)}/`; }
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** NDJSON is UTF-8 with LF terminators. Hash the decoded HTTP representation. */
export async function parseShard(bytes: Uint8Array, part: z.infer<typeof ShardSchema>, kind: Manifest["kind"]): Promise<ResourceRecord[]> {
  if (bytes.byteLength !== part.bytes || bytes.byteLength > MAX_SHARD_BYTES || await sha256(bytes) !== part.sha256) throw new Error("Resource checksum or size mismatch");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  if (!text.endsWith("\n")) throw new Error("NDJSON requires a final newline");
  const rows = text.slice(0, -1).split("\n").map((line) => RecordSchema.parse(JSON.parse(line)));
  if (rows.length !== part.records || new Set(rows.map((r) => r.key)).size !== rows.length) throw new Error("Resource record count or keys mismatch");
  if (kind === "timeline") for (const r of rows) TimelineSchema.parse(r.data);
  return rows;
}
