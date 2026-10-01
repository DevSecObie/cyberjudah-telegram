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
  const recordingRequests = book.chapterIds.map((c) => `${location.origin}/api/recordings/${book.slug}/${c}`);
  const urls = book.chapterIds.map((c) => `${DATA_ORIGIN}/api/kjv/${book.slug}/${c}.json`);
  urls.push(...recordingRequests, `${location.origin}/api/recordings/catalog`);
  let complete = true;
  const media = new Set<string>();
  let done = 0;
  // Six at a time: fast enough, and kind to the phone.
  for (let i = 0; i < urls.length; i += 6) {
    await Promise.all(urls.slice(i, i + 6).map(async (u) => {
      try {
        const r = await fetch(u);
        if (!r.ok) { complete = false; return; }
        if (recordingRequests.includes(u)) {
          const body = await r.clone().json() as { narrators: { audio: string }[] };
          body.narrators.forEach((n) => media.add(new URL(n.audio, location.origin).href));
        }
        await cache.put(u, r);
      } catch { complete = false; }
      onProgress?.(++done, urls.length);
    }));
  }
  // Full files are cached as blobs; offline playback seeks locally without Range fetches.
  for (const url of media) {
    try { const r = await fetch(url); if (!r.ok) complete = false; else await cache.put(url, r); }
    catch { complete = false; }
  }
  await cache.put(`${location.origin}/__offline/audio/${book.slug}`, new Response(JSON.stringify([...media])));
  if (!complete) return false;
  const saved = await savedBooks();
  if (!saved.includes(book.slug)) await cache.put(new Request(`${location.origin}/__offline/books`), new Response(JSON.stringify([...saved, book.slug])));
  return true;
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
