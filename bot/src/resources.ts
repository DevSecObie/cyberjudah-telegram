import { Hono } from "hono";
import type { Env } from "./env";
import { isAdmin } from "./edit";
import { CatalogSchema, ManifestSchema, MAX_CATALOG_BYTES, MAX_MANIFEST_BYTES, ResourceId, ReleaseId, parseShard, releasePrefix, sha256, type Catalog, type Manifest } from "../../shared/resources";

const CURRENT = "resources/catalog/current.json";
const jsonBytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
const empty: Catalog = { schemaVersion: 1, revision: 0, resources: [] };
export async function readCatalog(env: Pick<Env, "AUDIO">) {
  const object = await env.AUDIO.get(CURRENT);
  if (!object) return { catalog: empty, etag: "*" };
  if (object.size > MAX_CATALOG_BYTES) throw new Error("Catalog exceeds size limit");
  return { catalog: CatalogSchema.parse(await object.json()), etag: object.httpEtag };
}
/** All consumers, including future Ask resource adapters, resolve the same approved bytes.
 * An explicit release pins an installed client's request across subsequent publications. */
async function verifiedManifest(env: Pick<Env, "AUDIO">, id: string, release?: string): Promise<{ manifest: Manifest; bytes: Uint8Array } | null> {
  ResourceId.parse(id);
  const catalog = await readCatalog(env);
  const chosen = catalog.catalog.resources.find((r) => r.id === id && (!release || r.release === release));
  const version = release ? ReleaseId.parse(release) : chosen?.release;
  if (!version) return null;
  let expected = chosen?.manifestSha256;
  if (!expected) { const prior = await env.AUDIO.get(`resources/approved/${id}/${version}.json`); if (!prior) return null; expected = (await prior.json<{ manifestSha256: string }>()).manifestSha256; }
  const file = await env.AUDIO.get(`${releasePrefix(id, version)}manifest.json`);
  if (!file || file.size > MAX_MANIFEST_BYTES) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (await sha256(bytes) !== expected) throw new Error("Manifest checksum mismatch");
  const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (manifest.id !== id || manifest.release !== version) throw new Error("Manifest identity mismatch");
  return { manifest, bytes };
}
export async function readResourceManifest(env: Pick<Env, "AUDIO">, id: string, release?: string): Promise<Manifest | null> {
  return (await verifiedManifest(env, id, release))?.manifest ?? null;
}
export async function readResourceRecord(env: Pick<Env, "AUDIO">, id: string, recordKey: string, release?: string): Promise<{ release: string; data: unknown } | null> {
  const manifest = await readResourceManifest(env, id, release);
  if (!manifest) return null;
  for (const part of manifest.parts) {
    const object = await env.AUDIO.get(`${releasePrefix(id, manifest.release)}${part.path}`);
    if (!object || object.size !== part.bytes) throw new Error("Incomplete resource release");
    const records = await parseShard(new Uint8Array(await object.arrayBuffer()), part, manifest.kind);
    const row = records.find((r) => r.key === recordKey);
    if (row) return { release: manifest.release, data: row.data };
  }
  return null;
}

type ResourceApp = { Bindings: Env; Variables: { tma: { user?: { id: number } } } };
export const resources = new Hono<ResourceApp>();
resources.onError((_e, c) => c.json({ error: "Resource is invalid or unavailable" }, 503));
resources.get("/catalog", async (c) => {
  const { catalog, etag } = await readCatalog(c.env);
  c.header("cache-control", "no-cache");
  if (etag !== "*") { c.header("etag", etag); if (c.req.header("if-none-match") === etag) return c.body(null, 304); }
  return c.json(catalog);
});
resources.get("/:id/:release/:file", async (c) => {
  const id = c.req.param("id"), release = c.req.param("release"), file = c.req.param("file");
  if (!ResourceId.safeParse(id).success || !ReleaseId.safeParse(release).success) return c.json({ error: "Not found" }, 404);
  const verified = await verifiedManifest(c.env, id, release);
  if (!verified) return c.json({ error: "Not found" }, 404);
  const { manifest } = verified, part = manifest.parts.find((p) => p.path === file);
  if (file !== "manifest.json" && !part) return c.json({ error: "Not found" }, 404);
  let data = verified.bytes;
  if (part) {
    const object = await c.env.AUDIO.get(`${releasePrefix(id, release)}${file}`);
    if (!object || object.size !== part.bytes) return c.json({ error: "Incomplete resource release" }, 503);
    data = new Uint8Array(await object.arrayBuffer());
    await parseShard(data, part, manifest.kind);
  }
  return new Response(data, { headers: { "content-type": file.endsWith(".ndjson") ? "application/x-ndjson; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", etag: `"${await sha256(data)}"`, "x-content-type-options": "nosniff" } });
});
/** Publication is a compare-and-swap of one R2 authority. Existing admin identity is
 * sufficient; GitHub credentials are neither read nor required. Data upload is separate. */
resources.put("/catalog", async (c) => {
  if (!isAdmin(c.env, c.get("tma")?.user?.id ?? 0)) return c.json({ error: "Admin required" }, 403);
  const match = c.req.header("if-match");
  if (!match) return c.json({ error: "If-Match required; use * only for an empty catalog" }, 428);
  const reader = c.req.raw.body?.getReader(); if (!reader) return c.json({ error: "Catalog required" }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_CATALOG_BYTES) { await reader.cancel(); return c.json({ error: "Catalog too large" }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let input: unknown; try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  const parsed = CatalogSchema.safeParse(input); if (!parsed.success) return c.json({ error: "Invalid catalog" }, 400);
  const { catalog, etag } = await readCatalog(c.env);
  if (match !== etag || parsed.data.revision !== catalog.revision + 1) return c.json({ error: "Catalog changed; reload before publishing" }, 409);
  // Approved releases are immutable and already fully checked. Only new releases
  // need shard validation; no client can activate half an upload.
  for (const entry of parsed.data.resources) {
    const marker = `resources/approved/${entry.id}/${entry.release}.json`;
    const approved = await c.env.AUDIO.get(marker);
    if (approved) {
      if ((await approved.json<{ manifestSha256: string }>()).manifestSha256 !== entry.manifestSha256) return c.json({ error: "A release cannot be overwritten" }, 409);
      continue;
    }
    const base = releasePrefix(entry.id, entry.release), file = await c.env.AUDIO.get(`${base}manifest.json`);
    if (!file || file.size > MAX_MANIFEST_BYTES) return c.json({ error: "Missing manifest" }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    if (await sha256(data) !== entry.manifestSha256) return c.json({ error: "Manifest checksum mismatch" }, 400);
    const m = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(data)));
    if (m.id !== entry.id || m.release !== entry.release) return c.json({ error: "Manifest identity mismatch" }, 400);
    const keys = new Set<string>();
    for (const part of m.parts) {
      const object = await c.env.AUDIO.get(`${base}${part.path}`);
      if (!object || object.size !== part.bytes) return c.json({ error: "Incomplete resource" }, 400);
      for (const row of await parseShard(new Uint8Array(await object.arrayBuffer()), part, m.kind)) { if (keys.has(row.key)) return c.json({ error: "Duplicate resource record" }, 400); keys.add(row.key); }
    }
    const saved = await c.env.AUDIO.put(marker, JSON.stringify({ manifestSha256: entry.manifestSha256 }), { onlyIf: { etagDoesNotMatch: "*" } });
    if (!saved && (await (await c.env.AUDIO.get(marker))?.json<{ manifestSha256: string }>())?.manifestSha256 !== entry.manifestSha256) return c.json({ error: "Release approval changed" }, 409);
  }
  const body = jsonBytes(parsed.data), hash = await sha256(body);
  await c.env.AUDIO.put(`resources/catalog/${hash}.json`, body, { onlyIf: { etagDoesNotMatch: "*" } });
  const saved = await c.env.AUDIO.put(CURRENT, body, { onlyIf: etag === "*" ? { etagDoesNotMatch: "*" } : { etagMatches: etag.replaceAll('"', "") }, httpMetadata: { contentType: "application/json", cacheControl: "no-cache" } });
  if (!saved) return c.json({ error: "Catalog changed; reload before publishing" }, 409);
  c.header("etag", saved.httpEtag); return c.json(parsed.data);
});
