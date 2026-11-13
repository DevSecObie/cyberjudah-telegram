import { Hono } from 'hono';
import type { Env } from './env';
import type { InitData } from './initdata.mjs';
import { embed, takeQuotaKey } from './ai';
import { dataJson, type Chapter } from './data';
import type { BookRow } from './refs.mjs';
import { keyedHash, pid } from './privacy.mjs';
import { clientAddress, NETWORK_PER_MINUTE } from './client-ip';
import { withinPhase } from './research-policy.mjs';

export const SEMANTIC_MIN_SCORE = 0.55;
const KINDS = ['verse', 'class', 'study', 'law', 'case', 'precept'] as const;
type Kind = typeof KINDS[number];
type Options = { q: string; kinds: Kind[]; limit: number };
export type SemanticHit = { score: number } & (
  | { kind: 'verse'; book: string; slug: string; chapter: number; verse: number; text: string }
  | { kind: 'class'; title: string; date: string | null; teacher: string; video: string | null; t: number; snippet: string; url: string; sort: string }
  | { kind: 'study'; title: string; snippet: string; url: string }
  | { kind: 'law'; law: string; section: string; text: string; citation: string | null; url: string }
  | { kind: 'case'; name: string; era: string; verdict: string; snippet: string; url: string }
  | { kind: 'precept'; title: string; refs: number; url: string }
);
type Note = { kind?: string; title: string; url: string; videoId?: string; teacher?: string; date?: string };
const string = (value: unknown) => typeof value === 'string' ? value : '';
const videoId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value) ? value : null;

export function semanticOptions(params: URLSearchParams): Options | null {
  const q = (params.get('q') ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if (q.length < 2 || q.length > 400 || new TextEncoder().encode(q).length > 1600) return null;
  const requested = params.has('kinds') ? params.get('kinds')!.split(',') : [...KINDS];
  if (!requested.length || requested.some(kind => !KINDS.includes(kind as Kind))) return null;
  const raw = params.get('limit') ?? '20';
  if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1) return null;
  return { q, kinds: [...new Set(requested as Kind[])].sort(), limit: Math.min(30, Number(raw)) };
}

/** Only known public library paths can select records; never fetch a metadata-supplied URL. */
function libraryPath(env: Env, value: unknown): string | null {
  if (typeof value !== 'string' || !value || /[%\\]|\.\.|[\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, env.SITE_URL);
    if (url.origin !== new URL(env.SITE_URL).origin || url.username || url.password || url.search) return null;
    const path = url.pathname.replace(/^\/app(?=\/)/, '') + url.hash;
    return /^\/(?:bible|classes|captains|history|study|law|cases|precepts)\/[A-Za-z0-9_./#-]+$/.test(path) ? path : null;
  } catch { return null; }
}

/** One embedding and one read-only vector query. No generation, reranking or keyword mixing. */
export async function semanticHits(env: Env, options: Options, signal: AbortSignal, onPartial: () => void = () => {}): Promise<SemanticHit[]> {
  signal.throwIfAborted();
  if (!env.AI || !env.VEC) throw new Error('semantic bindings unavailable');
  const [vector] = await embed(env, [options.q], signal);
  if (!Array.isArray(vector) || vector.length !== 1024 || vector.some(value => !Number.isFinite(value))) throw new Error('invalid embedding');
  signal.throwIfAborted();
  // Full metadata queries support at most 50 candidates. No kind metadata index is assumed or
  // created: filter these candidates locally, and never claim that they cover the whole library.
  const result = await env.VEC.query(vector, { topK: 50, returnMetadata: 'all', returnValues: false });
  if (!Array.isArray(result.matches)) throw new Error('invalid vector response');
  signal.throwIfAborted();
  const memo = new Map<string, Promise<unknown>>();
  const json = <T>(path: string): Promise<T | null> => {
    if (!memo.has(path)) {
      if (memo.size >= 32) return Promise.resolve(null);
      memo.set(path, Promise.resolve().then(() => dataJson<T>(env, path)).catch(() => null).then(value => {
        // dataJson returns null for both missing and failed reads. Conservatively avoid caching
        // either; a transient origin failure must not hide records for the cache lifetime.
        if (value === null) onPartial();
        return value;
      }));
    }
    return memo.get(path)! as Promise<T | null>;
  };
  const hydrate = async (match: typeof result.matches[number]): Promise<SemanticHit | null> => {
    signal.throwIfAborted();
    if (!Number.isFinite(match.score) || match.score < SEMANTIC_MIN_SCORE || match.score > 1 + 1e-6) return null;
    const score = Math.min(1, match.score);
    const md = match.metadata ?? {}, rawKind = string(md.kind);
    const kind = ['spoken', 'class', 'classes', 'captains', 'history'].includes(rawKind) ? 'class' : rawKind as Kind;
    if (!options.kinds.includes(kind)) return null;
    const path = libraryPath(env, md.url), text = string(md.text), title = string(md.title);
    // Spoken caption scraps are noise; exact hydrated verses and other records stay eligible.
    if (kind === 'class' && text.trim().split(/\s+/u).filter(Boolean).length < 20) return null;
    let hit: SemanticHit | null = null;
    if (kind === 'verse' && path) {
      const coords = /^\/bible\/([a-z0-9-]+)\/([1-9]\d{0,2})#v([1-9]\d{0,2})$/.exec(path);
      if (!coords) return null;
      const [, slug, c, v] = coords, ch = Number(c), verse = Number(v);
      const [list, page] = await Promise.all([json<BookRow[]>('/api/kjv/books.json'), json<Chapter>(`/api/kjv/${slug}/${ch}.json`)]);
      const book = list?.find(row => row.slug === slug && ch <= row.chapters);
      if (!book) return null;
      const row = page?.verses?.find(row => row.verse === verse);
      // Coordinates and the complete KJV wording come from the public library, never a model
      // or the vector's truncated text. Short verses remain eligible.
      if (page?.book === book.book && page.chapter === ch && page.translation === 'KJV' && row?.text) hit = { kind, book: book.book, slug, chapter: ch, verse, text: row.text, score };
    } else if (kind === 'class' && text) {
      const notes = await json<Note[]>('/api/notes/index.json');
      const video = videoId(md.video);
      const stamped = typeof md.t === 'number' && Number.isFinite(md.t) && md.t >= 0;
      if (rawKind === 'spoken' && (!video || !stamped)) return null;
      const recorded = (notes ?? []).filter(row => video ? row.videoId === video : !!path && libraryPath(env, row.url) === path);
      // Removed class pages must not remain discoverable from stale vectors. A URL-less
      // chunk may use YouTube only when the public index still records its video.
      if (!recorded.length || (path && !recorded.some(row => libraryPath(env, row.url) === path))) return null;
      const distinct = (field: 'date' | 'teacher' | 'videoId') => [...new Set(recorded.map(row => string(row[field])).filter(Boolean))];
      const names = distinct('teacher'), dates = distinct('date'), videos = distinct('videoId');
      const id = video ?? (videos.length === 1 ? videoId(videos[0]) : null);
      const t = stamped ? md.t as number : 0;
      const url = libraryPath(env, recorded[0]?.url) ?? path ?? (id ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(t)}s` : null);
      const date = dates.length === 1 ? dates[0] : null;
      if (url && title) hit = { kind, title, date, teacher: names.length === 1 ? names[0] : '', video: id, t, snippet: text.slice(0, 500), url, sort: date ?? '', score };
    } else if (kind === 'study' && path && title && text) {
      const notes = await json<Note[]>('/api/notes/index.json');
      if (notes?.some(row => libraryPath(env, row.url) === path)) hit = { kind, title, snippet: text.slice(0, 500), url: path, score };
    } else if (kind === 'case' && path && text) {
      const index = await json<{ cases: { name: string; era: string; verdict: string; url: string }[] }>('/api/cases/index.json');
      const record = index?.cases?.find(row => libraryPath(env, row.url) === path);
      if (record) hit = { kind, name: record.name, era: record.era, verdict: record.verdict, snippet: text.slice(0, 500), url: path, score };
    } else if (kind === 'precept' && path) {
      const index = await json<{ title: string; refs: number; url: string }[]>('/api/precepts/index.json');
      const record = index?.find(row => libraryPath(env, row.url) === path);
      if (record && Number.isSafeInteger(record.refs) && record.refs >= 0) hit = { kind, title: record.title, refs: record.refs, url: path, score };
    } else if (kind === 'law' && path) {
      const law = /#(\d+[A-Z]\.\d+)$/.exec(path)?.[1];
      if (!law) return null;
      const section = await json<{ title: string; url: string; entries: { id: string; text: string; citation?: string }[] }>(`/api/laws/${law.split('.')[0]}.json`);
      const record = section?.entries?.find(row => row.id === law);
      if (section && record && libraryPath(env, section.url) === path.split('#')[0]) hit = { kind, law, section: section.title, text: record.text, citation: record.citation ?? null, url: path, score };
    }
    return hit;
  };
  const hits: SemanticHit[] = [], seen = new Set<string>();
  const candidates = [...result.matches].sort((a, b) => b.score - a.score);
  // Hydrate in bounded parallel batches, preserving score order and the shared 32-read cap.
  for (let offset = 0; offset < candidates.length && hits.length < options.limit; offset += 8) {
    const batch = await Promise.all(candidates.slice(offset, offset + 8).map(hydrate));
    for (const hit of batch) {
      if (!hit) continue;
      const key = hit.kind === 'verse' ? `${hit.kind}:${hit.slug}:${hit.chapter}:${hit.verse}` : hit.kind === 'class' ? `${hit.kind}:${hit.video ?? hit.url}` : `${hit.kind}:${hit.url}`;
      if (seen.has(key)) continue;
      seen.add(key); hits.push(hit);
      if (hits.length >= options.limit) break;
    }
  }
  signal.throwIfAborted();
  return hits;
}

/** Mounted after existing TMA, browser-session and linked Firebase authentication. */
export const semanticSearch = new Hono<{ Bindings: Env; Variables: { tma: InitData } }>();
/**
 * The limits on a search that embeds the query (a model call): per address (the reader's own signed
 * address through the Mini App's Worker, client-ip.ts) per minute, and per person 10 a minute and
 * 200 a day. Each scope ("semantic", "similar") counts on its own. Only keyed hashes are kept.
 */
export async function takeSearchQuota(env: Env, req: Request, uid: number, scope: 'semantic' | 'similar'): Promise<boolean> {
  const owner = await pid(env, uid), day = new Date().toISOString().slice(0, 10), minute = Math.floor(Date.now() / 60000);
  const { ip, signed } = await clientAddress(req, env);
  if (ip && !await takeQuotaKey(env, `${scope}_ip:${await keyedHash(env, `${scope}-ip`, ip)}:${minute}:${day}`, NETWORK_PER_MINUTE[signed ? 'signed' : 'unsigned'])) return false;
  return await takeQuotaKey(env, `${scope}_person:${owner}:${minute}:${day}`, 10) && await takeQuotaKey(env, `${scope}_day:${owner}:${day}`, 200);
}

semanticSearch.get('/', async c => {
  c.header('cache-control', 'private, no-store');
  const uid = c.get('tma')?.user?.id;
  if (!uid) return c.json({ error: 'unauthorized' }, 401);
  const options = semanticOptions(new URL(c.req.url).searchParams);
  if (!options) return c.json({ error: 'bad-query' }, 400);
  try {
    if (!await takeSearchQuota(c.env, c.req.raw, uid, 'semantic')) return c.json({ error: 'limit' }, 429);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(options)));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${new URL(c.req.url).origin}/__semantic_cache/v1/${hash}`;
    const cache = caches.default;
    const cached = await cache.match(key).catch(() => undefined);
    if (cached?.body) return c.body(cached.body, 200, { 'content-type': 'application/json' });
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(12000)]);
    let partial = false;
    const hits = await withinPhase(() => semanticHits(c.env, options, signal, () => { partial = true; }), signal);
    const response = new Response(JSON.stringify(hits), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    if (!partial) c.executionCtx.waitUntil(cache.put(key, response).catch(() => undefined));
    return c.json(hits);
  } catch {
    // No queries, passage text, raw IPs or provider errors enter logs.
    console.error(JSON.stringify({ event: 'semantic_unavailable' }));
    return c.json({ error: 'semantic-unavailable' }, 503);
  }
});
