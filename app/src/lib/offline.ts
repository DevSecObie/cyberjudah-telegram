import { DATA_ORIGIN, type Book } from "@/api/data";

/**
 * Offline books. A saved book's chapters sit in the browser's
 * Cache API under the app's origin; `data.ts` reads the cache when the network fails, so a
 * saved book reads on a plane or in a basement. Telegram's webview keeps the cache between
 * launches like any site data.
 */
const CACHE = "cj-offline-v1";
const available = typeof caches !== "undefined";

export async function cachedResponse(url: string): Promise<Response | undefined> {
  if (!available) return undefined;
  try { return await (await caches.open(CACHE)).match(url); } catch { return undefined; }
}

export async function saveBook(book: Book, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  if (!available) return false;
  const cache = await caches.open(CACHE);
  // A saved chapter also needs the book catalog when the app starts without a network.
  const indexUrl = `${DATA_ORIGIN}/api/kjv/books.json`;
  try { const r = await fetch(indexUrl); if (!r.ok) return false; await cache.put(indexUrl, r); }
  catch { if (!(await cache.match(indexUrl))) return false; }
  const urls = book.chapterIds.map((c) => `${DATA_ORIGIN}/api/kjv/${book.slug}/${c}.json`);
  let complete = true, done = 0;
  for (let i = 0; i < urls.length; i += 6) {
    await Promise.all(urls.slice(i, i + 6).map(async (u) => {
      try { const r = await fetch(u); if (!r.ok) complete = false; else await cache.put(u, r); }
      catch { complete = false; }
      onProgress?.(++done, urls.length);
    }));
  }
  if (!complete) return false;
  const saved = await savedBooks();
  if (!saved.includes(book.slug)) await cache.put(new Request(`${location.origin}/__offline/books`), new Response(JSON.stringify([...saved, book.slug])));
  return true;
}

/** Audio is a separate opt-in; a failed audio download never un-saves complete text. */
export async function saveNarration(book: Book, onProgress?: (done: number, total: number) => void): Promise<boolean> {
  if (!available) return false;
  const cache = await caches.open(CACHE), media = new Set<string>();
  let complete = true;
  const urls = [...book.chapterIds.map((c) => `${location.origin}/api/recordings/${book.slug}/${c}`), `${location.origin}/api/recordings/catalog`];
  for (const url of urls) {
    try {
      const r = await fetch(url); if (!r.ok) { complete = false; continue; }
      if (!url.endsWith("/catalog")) {
        const body = await r.clone().json() as { narrators: { audio: string }[] };
        body.narrators.forEach((n) => media.add(new URL(n.audio, location.origin).href));
      }
      await cache.put(url, r);
    } catch { complete = false; }
  }
  let done = 0;
  const succeeded = new Set<string>();
  // Full files are cached as blobs; offline playback seeks locally without Range fetches.
  // A retry after a partial failure only fetches what's still missing: already-cached chapters are not re-downloaded.
  for (const url of media) {
    if (await cache.match(url)) { succeeded.add(url); onProgress?.(++done, media.size); continue; }
    try { const r = await fetch(url); if (!r.ok) complete = false; else { await cache.put(url, r); succeeded.add(url); } }
    catch { complete = false; }
    onProgress?.(++done, media.size);
  }
  const previous = await cache.match(`${location.origin}/__offline/audio/${book.slug}`);
  const retained = previous ? await previous.json() as string[] : [];
  // Only files actually cached go on the ledger: it drives deletion, and must never claim a file is saved when it isn't.
  await cache.put(`${location.origin}/__offline/audio/${book.slug}`, new Response(JSON.stringify([...new Set([...retained, ...succeeded])])));
  return complete;
}

export async function removeBook(book: Book) {
  if (!available) return;
  const cache = await caches.open(CACHE);
  for (const c of book.chapterIds) await cache.delete(`${DATA_ORIGIN}/api/kjv/${book.slug}/${c}.json`);
  const list = await cache.match(`${location.origin}/__offline/audio/${book.slug}`);
  if (list) for (const url of await list.json() as string[]) await cache.delete(url);
  await cache.delete(`${location.origin}/__offline/audio/${book.slug}`);
  for (const c of book.chapterIds) await cache.delete(`${location.origin}/api/recordings/${book.slug}/${c}`);
  const saved = (await savedBooks()).filter((s) => s !== book.slug);
  await cache.put(new Request(`${location.origin}/__offline/books`), new Response(JSON.stringify(saved)));
}

export async function savedBooks(): Promise<string[]> {
  if (!available) return [];
  try { const r = await (await caches.open(CACHE)).match(`${location.origin}/__offline/books`); return r ? ((await r.json()) as string[]) : []; } catch { return []; }
}

export const offlineSupported = available;

/** Add missing metadata to legacy downloads on the next online launch. Never remove
 * or relabel old chapter responses as checksummed bundle records. */
export async function preserveLegacyBooks() {
  if (!available || !(await savedBooks()).length) return;
  const url = `${DATA_ORIGIN}/api/kjv/books.json`;
  try { const response = await fetch(url); if (response.ok) await (await caches.open(CACHE)).put(url, response); } catch { /* existing cached text remains available */ }
}
