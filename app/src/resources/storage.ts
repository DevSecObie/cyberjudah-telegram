import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { CatalogSchema, ManifestSchema, MAX_MANIFEST_BYTES, parseShard, releasePrefix, sha256, type Catalog, type Manifest, type ResourceRecord } from "@shared/resources";

type Release = { key: string; id: string; release: string; manifest: Manifest; manifestSha256: string; ready: boolean };
type Active = { id: string; release: string | null; previous: string | null; generation: number };
interface ResourcesDB extends DBSchema {
  releases: { key: string; value: Release };
  records: { key: [string, string]; value: ResourceRecord & { releaseKey: string }; indexes: { release: string } };
  active: { key: string; value: Active };
}
const key = (id: string, release: string) => `${id}/${release}`;
let db: Promise<IDBPDatabase<ResourcesDB>> | undefined;
const database = () => db ??= openDB<ResourcesDB>("cj-resources-v1", 1, { upgrade(d) {
  d.createObjectStore("releases", { keyPath: "key" });
  d.createObjectStore("records", { keyPath: ["releaseKey", "key"] }).createIndex("release", "releaseKey");
  d.createObjectStore("active", { keyPath: "id" });
} });
const notify = (id: string) => { window.dispatchEvent(new CustomEvent("resourcechange", { detail: id })); if (typeof BroadcastChannel !== "undefined") { const c = new BroadcastChannel("cj-resources"); c.postMessage(id); c.close(); } };
async function bytes(url: string, limit: number, signal?: AbortSignal) {
  const r = await fetch(url, { signal, cache: "no-store" });
  if (!r.ok || !r.body) throw new Error(`Resource download failed (${r.status})`);
  const reader = r.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error("Resource exceeds size limit"); chunks.push(value); } }
  finally { await reader.cancel(); }
  const out = new Uint8Array(size); let i = 0; for (const c of chunks) { out.set(c, i); i += c.length; } return out;
}
/** No network awaits inside IndexedDB transactions; incomplete releases never become active. */
export async function installResource(catalogInput: Catalog, id: string, signal?: AbortSignal): Promise<void> {
  const catalog = CatalogSchema.parse(catalogInput), entry = catalog.resources.find((r) => r.id === id);
  if (!entry) throw new Error("Resource is not in the catalog");
  const d = await database(), reservation = d.transaction(["active", "releases"], "readwrite");
  const previous = await reservation.objectStore("active").get(id) ?? { id, release: null, previous: null, generation: 0 };
  const installed = previous.release ? await reservation.objectStore("releases").get(previous.release) : null;
  if (installed?.ready && installed.release === entry.release) {
    if (installed.manifestSha256 !== entry.manifestSha256) { await reservation.done; throw new Error("An installed release cannot change"); }
    // Selecting the current release also supersedes an in-flight newer install.
    await reservation.objectStore("active").put({ ...previous, generation: previous.generation + 1 });
    await reservation.done;
    return;
  }
  const generation = previous.generation + 1;
  await reservation.objectStore("active").put({ ...previous, generation }); await reservation.done;
  const base = `/api/${releasePrefix(id, entry.release)}`;
  const raw = await bytes(`${base}manifest.json`, MAX_MANIFEST_BYTES, signal);
  if (await sha256(raw) !== entry.manifestSha256) throw new Error("Manifest checksum mismatch");
  const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  if (manifest.id !== id || manifest.release !== entry.release) throw new Error("Manifest identity mismatch");
  // A private staging namespace also isolates simultaneous installations of the same release.
  const releaseKey = `${key(id, entry.release)}/${crypto.randomUUID()}`;
  await d.put("releases", { key: releaseKey, id, release: entry.release, manifest, manifestSha256: entry.manifestSha256, ready: false });
  const seen = new Set<string>();
  for (const part of manifest.parts) {
    const rows = await parseShard(await bytes(`${base}${part.path}`, part.bytes, signal), part, manifest.kind);
    for (const row of rows) { if (seen.has(row.key)) throw new Error("Duplicate resource record across shards"); seen.add(row.key); }
    const tx = d.transaction("records", "readwrite");
    // Observe every request rejection as well as the transaction (including quota failures).
    await Promise.all([...rows.map((row) => tx.store.put({ ...row, releaseKey })), tx.done]);
  }
  signal?.throwIfAborted();
  const tx = d.transaction(["active", "releases"], "readwrite"), current = await tx.objectStore("active").get(id);
  if (current?.generation !== generation) { tx.abort(); await tx.done.catch(() => undefined); throw new Error("Installation was superseded"); }
  await tx.objectStore("releases").put({ key: releaseKey, id, release: entry.release, manifest, manifestSha256: entry.manifestSha256, ready: true });
  await tx.objectStore("active").put({ id, release: releaseKey, previous: current.release, generation });
  await tx.done; notify(id);
}
/** Reads pin a single ready release for the duration of the transaction. */
export async function readResource<T>(id: string, recordKey: string): Promise<{ release: string; data: T } | null> {
  const d = await database(), tx = d.transaction(["active", "releases", "records"]);
  const active = await tx.objectStore("active").get(id);
  if (!active?.release) return null;
  const release = await tx.objectStore("releases").get(active.release);
  if (!release?.ready) return null;
  const row = await tx.objectStore("records").get([active.release, recordKey]);
  return row ? { release: release.release, data: row.data as T } : null;
}
export async function rollbackResource(id: string): Promise<void> {
  const d = await database(), tx = d.transaction(["active", "releases"], "readwrite");
  const current = await tx.objectStore("active").get(id);
  if (!current?.previous || !(await tx.objectStore("releases").get(current.previous))?.ready) { tx.abort(); await tx.done.catch(() => undefined); throw new Error("No complete prior release"); }
  await tx.objectStore("active").put({ id, release: current.previous, previous: current.release, generation: current.generation + 1 });
  await tx.done; notify(id);
}
/** Deactivation is atomic; retained bytes permit rollback and cannot affect other resources. */
export async function deactivateResource(id: string): Promise<void> {
  const d = await database(), tx = d.transaction("active", "readwrite");
  const current = await tx.store.get(id);
  if (current) await tx.store.put({ id, release: null, previous: current.release ?? current.previous, generation: current.generation + 1 });
  await tx.done; notify(id);
}
