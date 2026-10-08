import type { Book } from "@/api/data";
import { recordingUrl } from "./recordings";
import { narrationStatusFrom } from "./narration-logic.mjs";

/**
 * Offline narration completeness, kept separate from the saved-text status (offline.ts):
 * a book's text can be complete while its optional licensed/generated audio is absent,
 * partially downloaded, or fully saved. Checked straight from the Cache API rather than
 * the download ledger, so a status report can never claim a file is saved when it isn't.
 * The decision logic itself lives in narration-logic.mjs, free of the Cache API, so it is
 * unit-testable the same way audio-intent.mjs is.
 */
export type NarrationStatus = "none" | "partial" | "complete";
export { narrationStatusFrom };
export { narrationHint } from "./narration-logic.mjs";

const CACHE = "cj-offline-v1";
const available = typeof caches !== "undefined";

async function chapterMedia(cache: Cache, slug: string, chapter: number): Promise<string[] | null> {
  const url = `${location.origin}${recordingUrl(slug, chapter)}`;
  const hit = await cache.match(url);
  if (!hit) return null;
  try {
    const body = await hit.clone().json() as { narrators: { audio: string }[] };
    return body.narrators.map((n) => new URL(n.audio, location.origin).href);
  } catch { return null; }
}

/** Every media URL the book's narrators responses call for, from whichever chapters are cached. Chapters never fetched do not count against completeness here; saveNarration always fetches all of them together. */
export async function narrationStatus(book: Book): Promise<NarrationStatus> {
  if (!available) return "none";
  const cache = await caches.open(CACHE);
  const perChapter = await Promise.all(book.chapterIds.map((c) => chapterMedia(cache, book.slug, c)));
  if (perChapter.some((m) => m === null)) return perChapter.every((m) => m === null) ? "none" : "partial";
  const required = perChapter.flat() as string[];
  if (required.length === 0) return "complete";
  const cached = new Set<string>();
  await Promise.all(required.map(async (u) => { if (await cache.match(u)) cached.add(u); }));
  return narrationStatusFrom(required, cached);
}

export async function removeNarration(book: Book) {
  if (!available) return;
  const cache = await caches.open(CACHE);
  const list = await cache.match(`${location.origin}/__offline/audio/${book.slug}`);
  if (list) for (const url of await list.json() as string[]) await cache.delete(url);
  await cache.delete(`${location.origin}/__offline/audio/${book.slug}`);
  for (const c of book.chapterIds) await cache.delete(`${location.origin}${recordingUrl(book.slug, c)}`);
}
