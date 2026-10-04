import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { APPROVED_RESOURCE_IDS, CatalogSchema, ManifestSchema, MAX_MANIFEST_BYTES, MAX_SHARD_BYTES, RecordSchema, parseShard, parseIndex, recordBucket, releasePrefix, sha256 } from "../shared/resources.ts";

const encode = (value) => new TextEncoder().encode(JSON.stringify(value) + "\n");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const releaseOf = async (content) => `r-${(await sha256(encode(canonical(content)))).slice(0, 24)}`;
/** All paths are deterministic. This builder neither downloads nor publishes anything. */
export async function buildBundle(metadata, records) {
  const rows = [...records].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const files = new Map(), parts = [], buckets = new Map(), keys = new Set();
  let chunk = [], size = 0;
  async function flush() {
    if (!chunk.length) return;
    const file = `records-${String(parts.length).padStart(4, "0")}.ndjson`;
    const bytes = new TextEncoder().encode(chunk.map((r) => JSON.stringify(r) + "\n").join(""));
    parts.push({ path: file, sha256: await sha256(bytes), bytes: bytes.length, records: chunk.length });
    files.set(file, bytes);
    for (const row of chunk) {
      const bucket = await recordBucket(row.key);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      buckets.get(bucket).push({ key: row.key, data: file });
    }
    chunk = []; size = 0;
  }
  for (const row of rows) {
    RecordSchema.parse(row);
    if (keys.has(row.key)) throw new Error(`Duplicate record ${row.key}`); keys.add(row.key);
    const bytes = encode(row);
    if (bytes.length > MAX_SHARD_BYTES) throw new Error(`Record exceeds shard limit: ${row.key}`);
    if (chunk.length && (size + bytes.length > 1024 * 1024 || chunk.length === 20_000)) await flush();
    chunk.push(row); size += bytes.length;
  }
  await flush();
  const index = { algorithm: "sha256-nibble-v1", buckets: [] };
  for (const [bucket, entries] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = new TextEncoder().encode(entries.map((r) => JSON.stringify(r) + "\n").join(""));
    const descriptor = { bucket, path: `index-${bucket}.ndjson`, sha256: await sha256(bytes), bytes: bytes.length, records: entries.length };
    index.buckets.push(descriptor); files.set(descriptor.path, bytes);
  }
  const content = { schemaVersion: 1, ...metadata, parts, index };
  const release = await releaseOf(content);
  const manifest = ManifestSchema.parse({ ...content, release });
  for (const part of parts) await parseShard(files.get(part.path), part, manifest.kind);
  for (const bucket of index.buckets) await parseIndex(files.get(bucket.path), bucket, manifest);
  const raw = encode(manifest);
  if (raw.length > MAX_MANIFEST_BYTES) throw new Error("Manifest exceeds size limit");
  files.set("manifest.json", raw);
  return { manifest, files, entry: { id: manifest.id, release, manifestSha256: await sha256(raw) } };
}

export async function writeBundle(output, bundle) {
  const base = releasePrefix(bundle.manifest.id, bundle.manifest.release), objects = [];
  await mkdir(path.join(output, "objects", base), { recursive: true });
  for (const [name, bytes] of bundle.files) {
    const file = `objects/${base}${name}`;
    await writeFile(path.join(output, file), bytes, { flag: "wx" });
    objects.push({ key: base + name, file, bytes: bytes.length, sha256: await sha256(bytes) });
  }
  return objects;
}

/** Verify an artifact before any upload; callers must still enforce approved catalog publication. */
export async function verifyArtifact(output, inventory) {
  const seen = new Set(), files = new Map();
  for (const object of inventory.objects) {
    if (!/^resources\/[a-z0-9-]+\/r-[a-f0-9]{24}\/(manifest\.json|(?:records-\d{4}|index-[a-f0-9])\.ndjson)$/.test(object.key) || object.file !== `objects/${object.key}`) throw new Error("Invalid artifact path");
    const bytes = new Uint8Array(await readFile(path.join(output, object.file)));
    if (bytes.length !== object.bytes || await sha256(bytes) !== object.sha256) throw new Error(`Artifact checksum mismatch: ${object.file}`);
    if (seen.has(object.key)) throw new Error("Duplicate artifact object"); seen.add(object.key); files.set(object.key, bytes);
  }
  const catalog = CatalogSchema.parse(JSON.parse(await readFile(path.join(output, "catalog.json"), "utf8"))), listed = new Set();
  for (const entry of catalog.resources) {
    if (!APPROVED_RESOURCE_IDS.includes(entry.id)) throw new Error("Unapproved artifact resource");
    const prefix = releasePrefix(entry.id, entry.release), raw = files.get(prefix + "manifest.json");
    if (!raw || await sha256(raw) !== entry.manifestSha256) throw new Error("Artifact manifest mismatch");
    const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(raw))), { release, ...content } = manifest;
    if (manifest.id !== entry.id || release !== entry.release || release !== await releaseOf(content) || await sha256(encode(manifest)) !== entry.manifestSha256) throw new Error("Non-canonical or mutable artifact release");
    const index = new Map(), keys = new Set();
    if (!manifest.index) throw new Error("Approved bundles require an index");
    for (const bucket of manifest.index.buckets) for (const [key, file] of await parseIndex(files.get(prefix + bucket.path), bucket, manifest)) index.set(key, file);
    for (const part of manifest.parts) for (const row of await parseShard(files.get(prefix + part.path), part, manifest.kind)) {
      if (keys.has(row.key) || index.get(row.key) !== part.path) throw new Error("Artifact index does not match records"); keys.add(row.key);
    }
    if (keys.size !== index.size) throw new Error("Artifact index contains missing records");
    for (const name of ["manifest.json", ...manifest.parts.map((p) => p.path), ...manifest.index.buckets.map((p) => p.path)]) listed.add(prefix + name);
  }
  if (listed.size !== files.size) throw new Error("Unlisted artifact objects");
  return catalog;
}
