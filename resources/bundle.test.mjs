import test from "node:test";
import assert from "node:assert/strict";
import { ManifestSchema, parseIndex, recordBucket } from "../shared/resources.ts";
import { buildBundle } from "./bundle.mjs";
import { references } from "./references.mjs";
import { errorRate } from "./ocr-report.mjs";
import { nextCatalog } from "./publish.mjs";

const meta = { id: "test-resource", kind: "reference", title: "Synthetic fixture", language: "en", source: [{ url: "https://example.invalid/fixture", revision: "synthetic", sha256: "a".repeat(64) }], license: [{ id: "public-domain", url: "https://example.invalid/fixture", attribution: "Synthetic test only", modifications: "" }], approval: { reference: "https://example.invalid/fixture", approvedBy: "TEST ONLY" } };
test("indexed bundles reproduce exact bytes and every key resolves to its real shard", async () => {
  const records = Array.from({ length: 45 }, (_, i) => ({ key: `page/${i}`, data: { text: "sample ".repeat(8000) } }));
  const a = await buildBundle(meta, records), b = await buildBundle(meta, [...records].reverse());
  assert.deepEqual(a, b); assert.ok(a.manifest.parts.length > 1);
  for (const row of records) {
    const id = await recordBucket(row.key), bucket = a.manifest.index.buckets.find((p) => p.bucket === id);
    const index = await parseIndex(a.files.get(bucket.path), bucket, a.manifest);
    assert.ok(new TextDecoder().decode(a.files.get(index.get(row.key))).includes(`"key":"${row.key}"`));
  }
  await assert.rejects(buildBundle(meta, [records[0], records[0]]), /Duplicate/);
});
test("unversioned share-alike approval cannot leak into other resources", () => {
  const base = { schemaVersion: 1, ...meta, release: "fixture", parts: [{ path: "entries.ndjson", bytes: 1, records: 1, sha256: "a".repeat(64) }], license: [{ ...meta.license[0], id: "CC-BY-SA-unversioned" }] };
  assert.equal(ManifestSchema.safeParse(base).success, false);
  assert.equal(ManifestSchema.safeParse({ ...base, id: "strongs", kind: "lexicon" }).success, true);
  assert.equal(ManifestSchema.safeParse({ ...base, id: "strongs", kind: "reference" }).success, false);
  assert.equal(ManifestSchema.safeParse({ ...base, id: "strongs", kind: "lexicon", license: [{ ...base.license[0], id: "CC-BY-SA-3.0" }] }).success, false);
});
test("reference annotations retain source text and reject nonexistent or reversed verses", () => {
  const books = [{ book: "Genesis", slug: "genesis", chapters: 1 }], bible = { genesis: { 1: ["verse one", "verse two"] } };
  const text = "Gen. i. 2; Genesis 1:99; Genesis 1:2-1; Unknown 1:1";
  const found = references(text, books, bible);
  assert.equal(found.links.length, 1); assert.equal(found.unclear.length, 3);
  assert.equal(text.slice(found.links[0].start, found.links[0].end), "Gen. i. 2");
  assert.equal(found.links[0].verse, 2);
});
test("ambiguous book abbreviations and cross-chapter ranges remain plain text", () => {
  const books = [{ book: "Jude", slug: "jude", chapters: 1 }, { book: "Judith", slug: "judith", chapters: 16 }];
  const bible = { jude: { 1: Array(25).fill("synthetic") }, judith: { 1: Array(16).fill("synthetic") } };
  const result = references("Jud. 1:1 and Jude 1:1-2:3", books, bible);
  assert.equal(result.links.length, 0); assert.equal(result.unclear.length, 2);
});
test("OCR measurement counts actual substitutions, insertions and deletions", () => {
  assert.deepEqual(errorRate("The date is 1630.", "The date is 1680."), { characters: 17, characterErrors: 1, words: 4, wordErrors: 1 });
  assert.equal(errorRate("one two three", "one four").wordErrors, 2);
});
test("admin catalog publication retains unrelated resources and advances the current revision", () => {
  const a = { id: "unrelated", release: "v1", manifestSha256: "a".repeat(64) }, b = { id: "strongs", release: "v2", manifestSha256: "b".repeat(64) };
  assert.deepEqual(nextCatalog({ schemaVersion: 1, revision: 8, resources: [a] }, { schemaVersion: 1, revision: 1, resources: [b] }), { schemaVersion: 1, revision: 9, resources: [b, a] });
});

test("Isaiah full names are not mistaken for Roman ordinals", () => {
  const books = [{ book: "Isaiah", slug: "isaiah", chapters: 66 }];
  const result = references("Isaiah 30:21", books, { isaiah: { 30: Array(33).fill("synthetic") } });
  assert.equal(result.links[0]?.slug, "isaiah"); assert.equal(result.unclear.length, 0);
});
