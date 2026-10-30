import { decodeHTML } from 'entities';
import { z } from 'zod';
import { APP_STUDY_RELEASE } from './app-study-release';
import { Hono } from 'hono';
import type { Env } from './env';
import type { Passage } from './ai.mjs';
import { dataJson, books, chapter } from './data';
import { parseReference } from './refs.mjs';
import { MORE_RUN } from './ask-tools';
import { runSearch } from './search';
import { bs } from './bs';
import { searchTeachings, transcriptAround } from './teachings';
import { searchJewishEncyclopedia } from './bs/jewish-encyclopedia';
import { evidenceOf, type StudySource } from './app-study-ui';

export const RESEARCH_RESOURCES = ['transcripts', 'teachings', 'people', 'encyclopedia', 'jewish-encyclopedia', 'study-notes', 'topics', 'law', 'precepts', 'cases', 'glossary', 'doctrines', 'timeline', 'strong', 'dictionary', 'nave', 'scripture', 'verse-study'] as const;
export const researchPlanSchema = z.object({ searches: z.array(z.object({ resource: z.enum(RESEARCH_RESOURCES), query: z.string().trim().min(2).max(120) })).max(APP_STUDY_RELEASE.maxSupplementarySearches) });
export const RESEARCH_PLAN_PROMPT = `Choose up to four public CyberJudah resources that will help answer the reader's question. The teachers' recordings and notes are always searched first. Return JSON only: {"searches":[{"resource":"people","query":"Abraham"}]}.
Allowed resources: transcripts (the teachers’ recorded words, with surrounding captions and video timestamps); teachings (recorded classes, captions, public notes); people (biography, family and teachings about a person); encyclopedia (CyberJudah encyclopedia); jewish-encyclopedia (the published 1901–1906 historical reference, not teacher authority); study-notes (chapter studies); topics; law (commandments handbook); precepts; cases (case studies); glossary; doctrines (the app's published teaching on rejected doctrines); timeline (events and dates); strong (Hebrew/Greek word or Strong number); dictionary (Bible Strong's original dictionary); nave (Bible Strong's original topical Bible); scripture (exact KJV reference, including Apocrypha); verse-study (classes, cross-references and precepts attached to a scripture).
Use a short specific search term or scripture reference, not the whole question. Choose only relevant resources. Always choose scripture or verse-study when explaining a named scripture. Do not interpret doctrine: this step only chooses research. Private notes, account data, transactions, web searches and mutations are not available.`;
export function parseResearchPlan(raw: string) {
  try { return researchPlanSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*\n|\n```\s*$/g, ''))).searches; } catch { return []; }
}
type Request = z.infer<typeof researchPlanSchema>['searches'][number];
type Row = Record<string, unknown>;
const str = (x: unknown) => typeof x === 'string' ? x : '';
const clean = (x: string) => decodeHTML(x.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const object = (x: unknown): Row => x && typeof x === 'object' && !Array.isArray(x) ? x as Row : {};
const list = (x: unknown): Row[] => Array.isArray(x) ? x.map(object) : [];
const title = (r: Row) => str(r.title || r.name || r.label || r.term || r.word);
const pick = (rows: Row[], query: string) => {
  const words = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return rows.map(r => ({ r, score: words.reduce((n, w) => n + (title(r).toLowerCase().includes(w) ? 4 : `${r.summary || ''} ${r.description || ''} ${r.claim || ''}`.toLowerCase().includes(w) ? 1 : 0), 0) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map(x => x.r);
};
// Only public editorial content fields, never arbitrary URLs or application-owned data.
function textOf(value: unknown, depth = 0): string {
  if (depth > 7) return '';
  if (typeof value === 'string') return clean(value).slice(0, 2400);
  if (Array.isArray(value)) return value.slice(0, 16).map(v => textOf(v, depth + 1)).filter(Boolean).join('\n').slice(0, 3200);
  const r = object(value);
  return ['title', 'name', 'label', 'text', 'description', 'summary', 'definition', 'article', 'body', 'content', 'points', 'entries', 'thread', 'items', 'refs', 'answers', 'sense', 'account', 'claim'].map(k => textOf(r[k], depth + 1)).filter(Boolean).join('\n').slice(0, 3200);
}
const resourceApp = new Hono<{ Bindings: Env }>().route('/bs', bs);
async function resourceJson(env: Env, path: string) {
  const res = await resourceApp.request(`https://study.internal/bs/v1/${path}`, { method: 'GET' }, env);
  if (!res.ok) throw new Error('RESOURCE_UNAVAILABLE');
  return object(await res.json());
}

export function createAppResearch(env: Env, initial: Passage[], emit: (e: { status: string }) => void) {
  const sources: StudySource[] = [], unavailable: string[] = [];
  let activeSearch = 0;
  const add = (p: Passage & { thumb?: string }) => {
    const old = sources.find(s => s.url === p.url && s.sub === p.sub && s.t === p.t);
    if (old) return { n: old.n, fresh: false };
    if (sources.length >= APP_STUDY_RELEASE.maxEvidenceSources || !p.text.trim()) return null;
    const n = sources.length + 1;
    sources.push({ ...p, text: p.text.slice(0, 2400), n, evidence: evidenceOf(p) });
    return { n, fresh: true };
  };
  initial.slice(0, 8).forEach(add);
  const read = async (path: string) => {
    const data = await dataJson<unknown>(env, path);
    if (!data) throw new Error('RESOURCE_UNAVAILABLE');
    return data;
  };
  const run = async ({ resource, query }: Request) => {
    const search = ++activeSearch;
    const addCurrent = (p: Passage & { thumb?: string }) => search === activeSearch ? add(p) : null;
    emit({ status: `Searching ${resource.replaceAll('-', ' ')} for “${query}”` });
    if (resource === 'transcripts') {
      const hits = await searchTeachings(env, query, '', 0);
      if (!hits.ok) throw new Error('RESOURCE_UNAVAILABLE');
      const moments = hits.hits.filter((h, i, all) => all.findIndex(x => x.video === h.video && Math.abs(x.start - h.start) < 90) === i).slice(0, 3);
      for (const hit of moments) {
        // Caption excerpts remain valid evidence if the complete transcript is temporarily
        // unavailable. Never turn a class summary into a purported verbatim quotation.
        addCurrent({ kind: 'spoken', title: hit.title, url: hit.note || `https://www.youtube.com/watch?v=${hit.video}`, sub: `${hit.feed} · transcript excerpt`, video: hit.video, t: hit.start, date: hit.date, text: hit.excerpt.replace(/[\uE000\uE001]/g, '') });
      }
      for (const hit of moments.slice(0, 2)) {
        emit({ status: `Reading the transcript of ${hit.title.slice(0, 160)} at ${Math.floor(hit.start / 60)}:${String(Math.floor(hit.start % 60)).padStart(2, '0')}` });
        try {
          const window = await transcriptAround(env, hit.video, hit.start, undefined, 65);
          if (!window.ok) continue;
          const chunks = [...window.chunks].sort((a, b) => Math.abs(a.t-hit.start)-Math.abs(b.t-hit.start)).slice(0, 3).sort((a, b) => a.t-b.t);
          if (chunks.length) addCurrent({ kind: 'spoken', title: window.title, url: window.url || hit.note || `https://www.youtube.com/watch?v=${hit.video}`, sub: `${hit.feed} · surrounding transcript`, video: hit.video, t: chunks[0].t, date: window.date, text: chunks.map(c => c.text).join(' ') });
        } catch { /* The independently retrieved caption excerpt remains available. */ }
      }
      return;
    }
    if (resource === 'teachings' || resource === 'study-notes' || resource === 'encyclopedia') {
      const found = await runSearch(env.DB, query, resource === 'encyclopedia' ? 'encyclopedia' : resource === 'study-notes' ? 'study' : ['class', 'captains', 'history', 'study'], 2, true);
      if (!found.ok) throw new Error('RESOURCE_UNAVAILABLE');
      found.hits.slice(0, 5).forEach(h => addCurrent({ ...h, text: h.text || h.snippet }));
      return;
    }
    if (resource === 'jewish-encyclopedia') {
      for (const row of await searchJewishEncyclopedia(env, query)) addCurrent({ kind: 'dictionary', title: row.word, sub: 'The Jewish Encyclopedia (1901–1906) · reference material', url: `/dictionary/en/jewish-encyclopedia/${row.id}/entry`, text: row.plain_text });
      return;
    }
    if (resource === 'scripture') {
      const catalog = await books(env), ref = catalog && parseReference(query, catalog);
      if (!ref) return;
      const data = await chapter(env, ref.slug, ref.chapter);
      if (!data) throw new Error('RESOURCE_UNAVAILABLE');
      const from = ref.verse ?? 1, to = Math.min(from + 15, ref.verseEnd ?? ref.verse ?? 16);
      addCurrent({ kind: 'verse', title: ref.label, url: `/bible/${ref.slug}/${ref.chapter}#v${from}`, text: data.verses.filter(v => v.verse >= from && v.verse <= to).map(v => `${ref.book} ${ref.chapter}:${v.verse} ${v.text}`).join('\n') });
      return;
    }
    if (['people', 'timeline', 'law', 'precepts', 'verse-study'].includes(resource)) {
      const tool = resource === 'people' ? 'person' : resource === 'verse-study' ? 'verse_study' : resource;
      const arg = tool === 'person' ? 'name' : tool === 'verse_study' ? 'reference' : tool === 'precepts' ? 'topic' : 'query';
      const before = sources.length;
      const result = await MORE_RUN[tool](env, { [arg]: query }, undefined, emit, (name, text, url) => {
        const n = addCurrent({ kind: resource, title: name, text, url });
        return n ? `[${n.n}] ${name}: ${text}` : '';
      }, addCurrent);
      if (result.error) throw new Error('RESOURCE_UNAVAILABLE');
      // The person's native screen includes actual teaching points; keep these independently
      // attributed, instead of labelling the genealogy or biography itself as teaching.
      if (resource === 'people') for (const s of sources.slice(before)) {
        const id = /^\/person\/([a-z0-9-]+)$/.exec(s.url)?.[1];
        if (!id) continue;
        const person = object(await read(`/api/people/${id}.json`));
        for (const t of list(person.taught).slice(0, 3)) {
          const note = object(t.note);
          if (str(note.url).startsWith('/') && Array.isArray(t.points)) addCurrent({ kind: 'teaching', title: str(note.label) || s.title, url: str(note.url), sub: [str(note.teacher), str(t.verse)].filter(Boolean).join(' · '), date: str(note.date), text: textOf(t.points), ...(typeof t.video === 'string' ? { video: t.video, t: Number(t.t || 0) } : {}) });
        }
      }
      return;
    }
    if (resource === 'strong') {
      const rows = list((await resourceJson(env, `strong-lexicon/entries?language=en&search=${encodeURIComponent(query)}&limit=3`)).entries);
      for (const row of rows) {
        const code = str(row.stepCode);
        if (!/^[HG]\d{1,5}$/.test(code)) continue;
        const data = await read(`/api/strongs/${code}.json`), entry = object(data);
        addCurrent({ kind: 'strong', title: `${code} ${str(entry.lemma)}`, url: `/strongs/${code}`, text: [str(entry.def), str(entry.derivation), str(entry.kjv)].filter(Boolean).join(' ') });
      }
      return;
    }
    if (resource === 'dictionary') {
      const rows = list((await resourceJson(env, `dictionaries/directory?language=en&limit=3&search=${encodeURIComponent(query)}`)).items);
      for (const row of rows.slice(0, 1)) for (const s of list(row.sources).filter((s, i, all) => all.findIndex(x => object(x.resource).work === object(s.resource).work) === i).slice(0, 3)) {
        const identity = object(s.resource), work = str(identity.work || identity.resourceId || s.resourceId);
        const id = Number(s.id);
        if (!/^[a-z0-9-]+$/.test(work) || !Number.isInteger(id) || id < 1) continue;
        const data = await resourceJson(env, `dictionaries/${work}/en/entries/by-id/${id}`), entry = object(data.entry);
        addCurrent({ kind: 'dictionary', title: str(entry.word) || str(row.label), url: `/dictionary/en/${work}/${id}/entry`, sub: str(s.title), text: textOf(entry.definition) });
      }
      return;
    }
    if (resource === 'nave') {
      const rows = list((await resourceJson(env, `naves/en/topics?search=${encodeURIComponent(query)}&limit=2`)).topics);
      for (const row of rows) {
        const key = str(row.normalizedName);
        if (!key || key.length > 120) continue;
        const data = await resourceJson(env, `naves/en/topics/${encodeURIComponent(key)}`);
        addCurrent({ kind: 'nave', title: str(row.name), url: `/nave/en/${encodeURIComponent(key)}`, text: textOf(data.topic) });
      }
      return;
    }
    const family = resource === 'doctrines' ? 'doctrine' : resource;
    const data = await read(`/api/${family}/index.json`), container = object(data);
    const rows = Array.isArray(data) ? list(data) : list(container.cases || container.entries);
    for (const row of pick(rows, query)) {
      const slug = str(row.slug);
      if (!/^[a-z0-9-]+$/i.test(slug)) continue;
      const detail = resource === 'glossary' ? row : object(await read(`/api/${family}/${slug}.json`));
      addCurrent({ kind: resource, title: title(row), url: `/${family}/${slug}`, text: textOf(detail) });
    }
  };
  return { sources, unavailable, async search(requests: Request[]) {
    // Fixed maximum fanout; source numbering remains stable and deterministic.
    for (const request of requests.slice(0, APP_STUDY_RELEASE.maxSupplementarySearches)) {
      try {
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([run(request), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 8000); })]).finally(() => clearTimeout(timer));
      } catch { console.log(JSON.stringify({ event: 'app_study_resource_unavailable', release: APP_STUDY_RELEASE.version, resource: request.resource })); activeSearch++; unavailable.push(request.resource); emit({ status: `${request.resource.replaceAll('-', ' ')} could not be read just now` }); }
    }
  } };
}
