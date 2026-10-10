import type { Context } from 'hono';
import type { Env } from '../env';
import bookRows from '../../data/bs-books.json';
import snapshot from '../../data/bs-metadata.json';

export type App = { Bindings: Env };
export type Ctx = Context<App>;
export const BOOKS = bookRows;
export const metadata = snapshot as {
  sourceCommit: string; built: string; textSha256: string; strongSha256: string;
  chaptersByBook: Record<string, number[]>; verseCountByBookChapter: Record<string, number>;
  chapterHashes: Record<string, string>; strongChapterHashes: Record<string, string>;
  strongChaptersByBook: Record<string, number[]>; strongVerseCountByBookChapter: Record<string, number>;
};
export type Verse = { verse: number; text: string; words?: [string, string[]][] };
export type Chapter = { book: string; chapter: number; translation: string; verses: Verse[] };
export type Note = { label: string; url: string; date: string; teacher: string };
export type Moment = { verses: string; label: string; url: string; date: string; teacher?: string; video: string; t: number; ts: string };
export type Precept = { verses: string; kind: string; ref: { label: string; url: string }; text: string; point: string; why?: string; note: Note; ts: string };
export type Comment = { verses: string; passage: string; points: string[]; note: Note; ts: string; video: string | null; t: number };
export type Concordance = { cited_by: { label: string; url: string; verses: string }[]; precepts?: Precept[]; commentary?: Comment[]; moments?: Moment[] };
export type TopicRow = { slug: string; label: string };
export type Topic = TopicRow & { items: { title: string; url: string; date?: string; teacher?: string }[]; thread?: { url: string; label: string; verses: string; text: string; classes: { title: string; url: string; date: string; teacher: string; video: string | null; t: number; ts: string }[]; precepts: { label: string; url: string; why?: string }[] }[] };
export const VERSION = 'KJV';
export const COLLECTION = 'cyberjudah';
export const bibleResource = { kind: 'bible-text' as const, versionId: VERSION, revision: `cj-kjv-${metadata.textSha256}`, textRevision: metadata.textSha256, textSha256: metadata.textSha256 };
export const strongResource = { kind: 'strong-bible-index' as const, versionId: VERSION, datasetId: 'CYBERJUDAH', revision: `cj-strong-${metadata.strongSha256}`, textRevision: metadata.textSha256, textSha256: metadata.textSha256, strongRevision: metadata.strongSha256 };
export const emptyPresentation = () => ({ startTags: [], layout: [], notes: [] as { offset: number; order: number; kind: 'note'; markup: string }[], headings: [] });
export const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const paragraphs = (s: string) => s.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${html(p).replace(/\n/g, '<br>')}</p>`).join('');
export const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
export const teacherRank = (s: string) => /\bbishop\b/i.test(s) ? 0 : /\bdeacon\b/i.test(s) ? 1 : 2;
export function siteLink(url: string, label: string) {
  // Only our own site-relative links can be promoted into HTML, never a supplied scheme.
  return /^\/(?!\/)[a-zA-Z0-9/?#=_%&.,:-]*$/.test(url) ? `<a href="https://cyberjudah.io${html(url)}">${html(label)}</a>` : html(label);
}
export function youtube(video: string | null | undefined, t: number | undefined, label: string) {
  return video && /^[A-Za-z0-9_-]{11}$/.test(video) && Number.isFinite(t) && t! >= 0 ? `<a href="https://www.youtube.com/watch?v=${video}&amp;t=${Math.floor(t!)}s">${html(label)}</a>` : '';
}
export class FeedError extends Error {
  constructor(readonly status: 400 | 404 | 503, readonly code: string, message: string) { super(message); }
}
export const invalid = (detail = 'Invalid resource request'): never => { throw new FeedError(400, 'INVALID_RESOURCE_REQUEST', detail); };
export const missing = (code: string, detail = 'This resource is not available in the CyberJudah dataset'): never => { throw new FeedError(404, code, detail); };
export const unavailable = (detail = 'The CyberJudah data source is temporarily unavailable'): never => { throw new FeedError(503, 'BIBLE_PUBLICATION_INACTIVE', detail); };
export function integer(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+$/.test(String(value))) return invalid();
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : invalid();
}
export function bookById(value: unknown) { return BOOKS[integer(value, 1, 81) - 1]; }
export function verseKey(value: string, introductions = false) {
  if (!/^[1-9]\d*-(?:0|[1-9]\d*)-(?:0|[1-9]\d*)$/.test(value)) return invalid('Expected a book-chapter-verse key');
  const [b, ch, v] = value.split('-');
  const book = bookById(b), chapter = integer(ch, introductions ? 0 : 1, 200), verse = integer(v, 0, 200);
  if (!chapter && verse) return invalid();
  return { book, chapter, verse };
}
export function version(c: Ctx, strong = false) {
  if (c.req.param('version') !== VERSION) missing(strong ? 'STRONG_BIBLE_UNSUPPORTED' : 'BIBLE_UNSUPPORTED');
}
export function versions(c: Ctx) {
  const rows = c.req.query('versions')?.split(',');
  if (!rows?.length || rows.length > 50) return invalid();
  if (rows.some(v => v !== VERSION)) missing('BIBLE_UNSUPPORTED');
}
export function language(c: Ctx, code: string, query = false) {
  const lang = query ? c.req.query('language') : c.req.param('language');
  if (lang !== 'en') missing(code, 'CyberJudah provides this resource in English only');
}
export function collection(c: Ctx) {
  language(c, 'SUPPLEMENTARY_CONTENT_NOT_FOUND');
  if (c.req.param('collection') !== COLLECTION) missing('SUPPLEMENTARY_CONTENT_NOT_FOUND');
}
export function limit(c: Ctx, max = 500, fallback = 60) { return integer(c.req.query('limit'), 1, max, fallback); }
export const encodeCursor = (value: unknown) => encodeURIComponent(JSON.stringify(value));
export function cursor(c: Ctx): unknown {
  const raw = c.req.query('cursor');
  if (!raw) return undefined;
  if (raw.length > 2000) return invalid();
  try { return JSON.parse(decodeURIComponent(raw)); } catch { return invalid('Invalid page cursor'); }
}
export async function sha(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function load<T>(c: Ctx, path: string, optional = false): Promise<T> {
  const url = `${c.env.DATA_ORIGIN.replace(/\/$/, '')}${path}`;
  const cache = typeof caches === 'undefined' ? undefined : caches.default;
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.json() as T;
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (response.status === 404 && optional) return null as T;
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    const data = await response.json() as T;
    if (cache) {
      const put = cache.put(url, new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } }));
      try { c.executionCtx.waitUntil(put); } catch { await put; }
    }
    return data;
  } catch (e) {
    console.error({ event: 'bs_load_failed', url, error: String(e) });
    if (e instanceof FeedError) throw e;
    return unavailable();
  }
}
export async function readChapter(c: Ctx, book: number, chapter: number, strong = false): Promise<Chapter> {
  const row = bookById(book), key = `${book}-${chapter}`;
  if (!metadata.chaptersByBook[book]?.includes(chapter)) return missing(strong ? 'STRONG_BIBLE_CHAPTER_NOT_FOUND' : 'BIBLE_CHAPTER_NOT_FOUND');
  const data = await load<Chapter>(c, `/api/kjv/${row.slug}/${chapter}.json`);
  if (!Array.isArray(data.verses) || data.translation !== VERSION || data.chapter !== chapter) return unavailable();
  const projected = data.verses.map(v => strong ? [v.verse, v.text, v.words ?? []] : [v.verse, v.text]);
  if (await sha(projected) !== (strong ? metadata.strongChapterHashes[key] : metadata.chapterHashes[key])) {
    return unavailable('The KJV publication changed; refresh the CyberJudah feed index');
  }
  return data;
}
export function numbers(value: string): number[] {
  const out = new Set<number>();
  for (const part of value.split(/[,;]/)) {
    const m = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (a < 1 || b > 200 || b < a) continue;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
export function location(url: string) {
  const m = /^\/bible\/([a-z0-9-]+)\/(\d+)(?:\?[^#]*)?(?:#v(\d+))?/.exec(url);
  if (!m) return null;
  const book = BOOKS.find(b => b.slug === m[1]);
  return book ? { book: book.id, chapter: Number(m[2]), verse: Number(m[3] ?? 0) } : null;
}
export async function mapLimit<T, R>(rows: T[], fn: (row: T) => Promise<R>, concurrency = 6): Promise<R[]> {
  const out: R[] = new Array(rows.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(rows.length, concurrency) }, async () => {
    while (next < rows.length) { const i = next++; out[i] = await fn(rows[i]); }
  }));
  return out;
}
