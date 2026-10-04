import { APPROVED_RESOURCE_IDS, CatalogSchema, ManifestSchema, MAX_MANIFEST_BYTES, ReleaseId, sha256, type Catalog, type Manifest } from '@shared/resources';
import { installedResources, readResource } from './storage';

const CATALOG_KEY = 'cj:resource-catalog:v1';
let catalogRequest: Promise<Catalog> | undefined;
/** A session catalog is shared by the reader and Ask until an explicit refresh. */
export function resourceCatalog(refresh = false): Promise<Catalog> {
  if (refresh) catalogRequest = undefined;
  return catalogRequest ??= (async () => {
    try {
      const response = await fetch('/api/resources/catalog', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Resource catalog could not be loaded');
      const catalog = CatalogSchema.parse(await response.json());
      try { localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog)); } catch { /* private storage */ }
      return catalog;
    } catch (error) {
      if (refresh) { catalogRequest = undefined; throw error; }
      try { const saved = localStorage.getItem(CATALOG_KEY); if (saved) return CatalogSchema.parse(JSON.parse(saved)); } catch { /* unavailable/corrupt cache */ }
      catalogRequest = undefined; throw error;
    }
  })();
}
export type ResourcePins = Partial<Record<typeof APPROVED_RESOURCE_IDS[number], string | null>>;
export async function resourcePins(): Promise<ResourcePins> {
  const installed = await installedResources().catch(() => []);
  const catalog = await resourceCatalog().catch(() => null);
  return Object.fromEntries(APPROVED_RESOURCE_IDS.map((id) => [id, installed.find((r) => r.id === id)?.manifest.release ?? catalog?.resources.find((r) => r.id === id)?.release ?? null]));
}
export async function resourceRelease(id: string): Promise<string | null> {
  if (!(APPROVED_RESOURCE_IDS as readonly string[]).includes(id)) return null;
  const local = (await installedResources().catch(() => [])).find((r) => r.id === id);
  if (local) return local.manifest.release;
  return (await resourceCatalog().catch(() => null))?.resources.find((r) => r.id === id)?.release ?? null;
}
export async function resourceManifest(entry: Catalog['resources'][number]): Promise<Manifest> {
  const response = await fetch(`/api/resources/${entry.id}/${entry.release}/manifest.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Resource details could not be loaded');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_MANIFEST_BYTES || await sha256(bytes) !== entry.manifestSha256) throw new Error('Resource manifest checksum mismatch');
  const manifest = ManifestSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (manifest.id !== entry.id || manifest.release !== entry.release) throw new Error('Resource identity mismatch');
  return manifest;
}
export class ResourceReadError extends Error { constructor(public status: number) { super(`This resource could not be read (${status})`); } }
/** A missing/broken pinned release never falls through to a different release. */
export async function resourceRecord<T>(id: string, key: string, release: string): Promise<T> {
  ReleaseId.parse(release);
  const local = await readResource<T>(id, key, release).catch(() => null);
  if (local) return local.data;
  const response = await fetch(`/api/resources/${encodeURIComponent(id)}/${release}/record?key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new ResourceReadError(response.status);
  const result = await response.json() as { release: string; data: T };
  if (result.release !== release) throw new Error('Resource release mismatch');
  return result.data;
}
