import { Hono } from 'hono';
import type { Env } from './env';
import type { InitData } from './initdata.mjs';
import { embed, takeQuotaKey } from './ai';
import { dataJson, type Chapter } from './data';
import type { BookRow } from './refs.mjs';
import { keyedHash, pid } from './privacy.mjs';
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
export async function semanticHits(env: Env, options: Options, signal: AbortSignal): Promise<SemanticHit[]> {
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
      memo.set(path, dataJson<T>(env, path));
    }
    return memo.get(path)! as Promise<T | null>;
  };
  const hits: SemanticHit[] = [], seen = new Set<string>();
  for (const match of [...result.matches].sort((a, b) => b.score - a.score)) {
    signal.throwIfAborted();
    if (!Number.isFinite(match.score) || match.score < SEMANTIC_MIN_SCORE || match.score > 1) continue;
    const md = match.metadata ?? {}, rawKind = string(md.kind);
    const kind = ['spoken', 'class', 'classes', 'captains', 'history'].includes(rawKind) ? 'class' : rawKind as Kind;
    if (!options.kinds.includes(kind)) continue;
    const path = libraryPath(env, md.url), text = string(md.text), title = string(md.title);
    let hit: SemanticHit | null = null;
    if (kind === 'verse' && path) {
      const coords = /^\/bible\/([a-z0-9-]+)\/([1-9]\d{0,2})#v([1-9]\d{0,2})$/.exec(path);
      if (!coords) continue;
      const [, slug, c, v] = coords, ch = Number(c), verse = Number(v);
      const list = await json<BookRow[]>('/api/kjv/books.json'), book = list?.find(row => row.slug === slug && ch <= row.chapters);
      if (!book) continue;
      const page = await json<Chapter>(`/api/kjv/${slug}/${ch}.json`);
      const row = page?.verses?.find(row => row.verse === verse);
      // Coordinates and the complete KJV wording come from the public library, never a model
      // or the vector's truncated text. Short verses remain eligible.
      if (page?.book === book.book && page.chapter === ch && page.translation === 'KJV' && row?.text) hit = { kind, book: book.book, slug, chapter: ch, verse, text: row.text, score: match.score };
    } else if (kind === 'class' && text) {
      const notes = await json<Note[]>('/api/notes/index.json');
      const video = videoId(md.video);
      const stamped = typeof md.t === 'number' && Number.isFinite(md.t) && md.t >= 0;
      if (rawKind === 'spoken' && (!video || !stamped)) continue;
      const recorded = (notes ?? []).filter(row => video ? row.videoId === video : !!path && libraryPath(env, row.url) === path);
      const distinct = (field: 'date' | 'teacher' | 'videoId') => [...new Set(recorded.map(row => string(row[field])).filter(Boolean))];
      const names = distinct('teacher'), dates = distinct('date'), videos = distinct('videoId');
      const id = video ?? (videos.length === 1 ? videoId(videos[0]) : null);
      const t = stamped ? md.t as number : 0;
      const url = libraryPath(env, recorded[0]?.url) ?? path ?? (id ? `https://www.youtube.com/watch?v=${id}&t=${Math.floor(t)}s` : null);
      const date = dates.length === 1 ? dates[0] : recorded.length ? null : string(md.date) || null;
      if (url && title) hit = { kind, title, date, teacher: names.length === 1 ? names[0] : '', video: id, t, snippet: text.slice(0, 500), url, sort: date ?? '', score: match.score };
    } else if (kind === 'study' && path && title && text) {
      hit = { kind, title, snippet: text.slice(0, 500), url: path, score: match.score };
    } else if (kind === 'case' && path && text) {
      const index = await json<{ cases: { name: string; era: string; verdict: string; url: string }[] }>('/api/cases/index.json');
      const record = index?.cases?.find(row => libraryPath(env, row.url) === path);
      if (record) hit = { kind, name: record.name, era: record.era, verdict: record.verdict, snippet: text.slice(0, 500), url: path, score: match.score };
    } else if (kind === 'precept' && path) {
      const index = await json<{ title: string; refs: number; url: string }[]>('/api/precepts/index.json');
      const record = index?.find(row => libraryPath(env, row.url) === path);
      if (record && Number.isSafeInteger(record.refs) && record.refs >= 0) hit = { kind, title: record.title, refs: record.refs, url: path, score: match.score };
    } else if (kind === 'law' && path) {
      const law = /#(\d+[A-Z]\.\d+)$/.exec(path)?.[1];
      if (!law) continue;
      const section = await json<{ title: string; url: string; entries: { id: string; text: string; citation?: string }[] }>(`/api/laws/${law.split('.')[0]}.json`);
      const record = section?.entries?.find(row => row.id === law);
      if (section && record && libraryPath(env, section.url) === path.split('#')[0]) hit = { kind, law, section: section.title, text: record.text, citation: record.citation ?? null, url: path, score: match.score };
    }
    if (!hit) continue;
    const key = hit.kind === 'verse' ? `${hit.kind}:${hit.slug}:${hit.chapter}:${hit.verse}` : hit.kind === 'class' ? `${hit.kind}:${hit.video ?? hit.url}` : `${hit.kind}:${hit.url}`;
    if (seen.has(key)) continue;
    seen.add(key); hits.push(hit);
    if (hits.length >= options.limit) break;
  }
  signal.throwIfAborted();
  return hits;
}

/** Mounted after existing TMA, browser-session and linked Firebase authentication. */
export const semanticSearch = new Hono<{ Bindings: Env; Variables: { tma: InitData } }>();
semanticSearch.get('/', async c => {
  c.header('cache-control', 'private, no-store');
  const uid = c.get('tma')?.user?.id;
  if (!uid) return c.json({ error: 'unauthorized' }, 401);
  const options = semanticOptions(new URL(c.req.url).searchParams);
  if (!options) return c.json({ error: 'bad-query' }, 400);
  try {
    const owner = await pid(c.env, uid), day = new Date().toISOString().slice(0, 10), minute = Math.floor(Date.now() / 60000);
    const ip = c.req.header('cf-connecting-ip');
    if (ip && !await takeQuotaKey(c.env, `semantic_ip:${await keyedHash(c.env, 'semantic-ip', ip.slice(0, 45))}:${minute}:${day}`, 6000)) return c.json({ error: 'limit' }, 429);
    if (!await takeQuotaKey(c.env, `semantic_person:${owner}:${minute}:${day}`, 10) || !await takeQuotaKey(c.env, `semantic_day:${owner}:${day}`, 200)) return c.json({ error: 'limit' }, 429);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(options)));
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const key = `${new URL(c.req.url).origin}/__semantic_cache/v1/${hash}`;
    const cache = caches.default;
    const cached = await cache.match(key).catch(() => undefined);
    if (cached) return new Response(cached.body, { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(12000)]);
    const hits = await withinPhase(() => semanticHits(c.env, options, signal), signal);
    const response = new Response(JSON.stringify(hits), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
    c.executionCtx.waitUntil(cache.put(key, response).catch(() => undefined));
    return c.json(hits);
  } catch {
    // No queries, passage text, raw IPs or provider errors enter logs.
    console.error(JSON.stringify({ event: 'semantic_unavailable' }));
    return c.json({ error: 'semantic-unavailable' }, 503);
  }
});
