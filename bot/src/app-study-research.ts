import { decodeHTML } from 'entities';
import { z } from 'zod';
import { APP_STUDY_RELEASE } from './app-study-release';
import { Hono } from 'hono';
import type { Env, Exec } from './env';
import type { Passage } from './ai.mjs';
import { dataJson, books, chapter } from './data';
import { parseReference } from './refs.mjs';
import { MORE_RUN } from './ask-tools';
import { runSearch } from './search';
import { bs } from './bs';
import { searchTeachings, transcriptAround } from './teachings';
import { searchJewishEncyclopedia } from './bs/jewish-encyclopedia';
import { evidenceOf, type StudySource } from './app-study-ui';
import { BOOKS, COLLECTION } from './bs/core';
import { htmlToText } from './html-text';

export const RESEARCH_RESOURCES = ['transcripts', 'teachings', 'people', 'encyclopedia', 'jewish-encyclopedia', 'study-notes', 'topics', 'law', 'precepts', 'cases', 'glossary', 'doctrines', 'timeline', 'strong', 'dictionary', 'nave', 'scripture', 'verse-study', 'commentary', 'class-notes', 'places', 'library', 'cross-references'] as const;
export const researchPlanSchema = z.object({ searches: z.array(z.object({ resource: z.enum(RESEARCH_RESOURCES), query: z.string().trim().min(2).max(120) })).max(APP_STUDY_RELEASE.maxSupplementarySearches) });
export const RESEARCH_PLAN_PROMPT = `Choose up to six public CyberJudah resources that together give a thorough answer to the reader's question, covering it from every useful angle. The teachers' recordings and notes are always searched first. Return JSON only: {"searches":[{"resource":"people","query":"Abraham"}]}.
Allowed resources: transcripts (the teachers’ recorded words, with surrounding captions and video timestamps); teachings (recorded classes, captions, public notes); people (biography, family and teachings about a person); encyclopedia (CyberJudah encyclopedia); jewish-encyclopedia (the published 1901–1906 historical reference, not teacher authority); study-notes (chapter studies); topics; law (commandments handbook); precepts; cases (case studies); glossary; doctrines (the app's published teaching on rejected doctrines); timeline (events and dates); strong (Hebrew/Greek word or Strong number); dictionary (Bible Strong's original dictionary); nave (Bible Strong's original topical Bible); scripture (exact KJV reference, including Apocrypha); verse-study (classes, cross-references and precepts attached to a scripture); commentary (the Bishops' and teachers' class breakdowns on one verse, each with its class and moment; give one verse like "Deuteronomy 28:68"); class-notes (the written notes of the classes that match, read in full for the passages on the subject); places (a place or nation in Scripture: what and where it is, and its verses); library (the books the classes read from, page by page: reference material, never a teacher); cross-references (the KJV verses cross-referenced to one verse, read word for word; give one verse).
Use a short specific search term or scripture reference, not the whole question. Choose only relevant resources, but cover the question well: for a named verse, choose commentary, cross-references and scripture; for a subject, class-notes plus topics, precepts or study-notes; for a person, people and timeline, and places when a place matters. Always choose scripture or verse-study when explaining a named scripture. Do not interpret doctrine: this step only chooses research. Private notes, account data, transactions, web searches and mutations are not available.`;
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
  // A missing field is nothing to read. Without this, every absent key recursed into all 19 keys
  // again, 19^7 calls deep: one case or doctrine file blocked the Worker until it was killed.
  if (!value || typeof value !== 'object') return '';
  const r = object(value);
  return ['title', 'name', 'label', 'text', 'description', 'summary', 'definition', 'article', 'body', 'content', 'points', 'entries', 'thread', 'items', 'refs', 'answers', 'sense', 'account', 'claim'].map(k => textOf(r[k], depth + 1)).filter(Boolean).join('\n').slice(0, 3200);
}
const resourceApp = new Hono<{ Bindings: Env }>().route('/bs', bs);
async function resourceJson(env: Env, path: string) {
  const res = await resourceApp.request(`https://study.internal/bs/v1/${path}`, { method: 'GET' }, env);
  if (!res.ok) throw new Error('RESOURCE_UNAVAILABLE');
  return object(await res.json());
}

type Found = Passage & { thumb?: string; entity?: string };
/** Leading clauses of a commentary paragraph that are the verse's own KJV words. */
function splitVerse(text: string, verse: string) {
  const kjv = new Set(verse.toLowerCase().match(/[a-z']+/g) ?? []);
  const clauses = text.split(/(?<=[.;:?!])\s+/);
  let n = 0;
  for (; n < clauses.length; n++) {
    const w = clauses[n].toLowerCase().match(/[a-z']+/g) ?? [];
    if (w.length < 2 || w.filter(x => kjv.has(x)).length / w.length < 0.8) break;
  }
  return { scripture: clauses.slice(0, n).join(' '), teaching: clauses.slice(n).join(' ') };
}
/** A class note's Markdown as reading text, without links, marks or embedded HTML. */
const noteText = (md: string) => htmlToText(md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^\s*(?:[-*>]|#+)\s*/gm, '').replace(/\*+|_{2,}/g, '')).replace(/\n{2,}/g, '\n');
const clock = (t: number) => `${t >= 3600 ? `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}` : Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const STOP = new Set(['the', 'and', 'what', 'who', 'why', 'how', 'was', 'were', 'is', 'are', 'did', 'does', 'do', 'about', 'with', 'that', 'this', 'from', 'for', 'still', 'keep', 'mean', 'means', 'tell', 'explain', 'teach', 'taught', 'say', 'said', 'they', 'them', 'their', 'our', 'we', 'you', 'your', 'can', 'into', 'of', 'in', 'on', 'to', 'a', 'an', 'it']);
const termsOf = (q: string) => [...new Set(q.toLowerCase().match(/[a-z0-9']+/g)?.filter(w => w.length > 2 && !STOP.has(w)) ?? [])];
const occurrences = (text: string, w: string) => text.split(w).length - 1;

export function createAppResearch(env: Env, initial: Passage[], emit: (e: { status: string }) => void, ctx?: Exec, question = '') {
  const sources: StudySource[] = [], unavailable: string[] = [];
  const asked = termsOf(question);
  const add = (p: Found) => {
    const old = sources.find(s => s.url === p.url && s.sub === p.sub && s.t === p.t);
    if (old) return { n: old.n, fresh: false };
    if (sources.length >= APP_STUDY_RELEASE.maxEvidenceSources || !p.text.trim()) return null;
    const n = sources.length + 1;
    sources.push({ ...p, text: p.text.slice(0, 2400), n, evidence: evidenceOf(p) });
    return { n, fresh: true };
  };
  initial.slice(0, 8).forEach(add);
  const read = async (path: string) => {
    const data = await dataJson<unknown>(env, path, ctx);
    if (!data) throw new Error('RESOURCE_UNAVAILABLE');
    return data;
  };
  // The Library's books and every page a class read from them (class, teacher and moment).
  type Read = { video: string; vol: number; page: number; t?: number; ts?: string; title?: string; date?: string; teacher?: string; url?: string };
  type Chapter = { k: number; title?: string; vol: number; page: number; end: number };
  let shelf: Promise<{ slug: string; title: string; by: string; reads: Read[]; chapters: Chapter[] }[]> | undefined;
  const library = () => shelf ??= (async () => {
    const index = list(await read('/api/library/index.json')).filter(b => Number(b.classes) > 0 && /^[a-z0-9-]+$/.test(str(b.slug)));
    return Promise.all(index.map(async b => {
      const book = object(await read(`/api/library/${str(b.slug)}/book.json`).catch(() => ({})));
      return { slug: str(b.slug), title: str(b.title), by: [str(b.author), b.year ? String(b.year) : ''].filter(Boolean).join(', '), reads: list(book.reads) as unknown as Read[], chapters: list(book.chapters) as unknown as Chapter[] };
    }));
  })();
  const readIn = (r: Read) => `Read in class: ${[r.title, r.teacher, r.date].filter(Boolean).join(' · ')}${r.ts ? ` at ${r.ts}` : ''}.`;
  // A page's text, read from its chapter of the Library, with what the class said there.
  const pageText = async (slug: string, chapters: Chapter[], vol: number, page: number, video = '') => {
    const c = chapters.find(x => x.vol === vol && x.page <= page && page <= x.end);
    if (!c || !Number.isInteger(c.k)) return null;
    const p = list(object(await read(`/api/library/${slug}/chapter/${c.k}.json`).catch(() => ({}))).pages).find(x => x.vol === vol && x.page === page);
    return p && str(p.text) ? { text: str(p.text), sub: `p. ${page}${c.title ? ` · ${c.title}` : ''}`, said: textOf(list(p.reads).find(r => r.video === video)?.said).replace(/\s+/g, ' ') } : null;
  };
  // Each search fills its own list; the lists are numbered in the plan's order once all have
  // answered, so searches run side by side and numbering stays deterministic.
  const run = async ({ resource, query }: Request, found: Found[]) => {
    const addCurrent = (p: Found) => { found.push(p); return { n: 0, fresh: true }; };
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
    if (resource === 'library') {
      const found = await runSearch(env.DB, query, 'book', 8, true);
      if (!found.ok) throw new Error('RESOURCE_UNAVAILABLE');
      const books = await library().catch(() => []);
      // Pages the classes actually read come first, each with the class that read it.
      const hits = found.hits.map(h => {
        const m = /^\/books\/([a-z0-9-]+)\/p\/(\d+)-(\d+)$/.exec(h.url);
        const reads = m ? books.find(b => b.slug === m[1])?.reads.filter(r => r.vol === Number(m[2]) && r.page === Number(m[3])) ?? [] : [];
        return { h, reads };
      }).sort((a, b) => Number(b.reads.length > 0) - Number(a.reads.length > 0)).slice(0, 3);
      for (const { h, reads } of hits) addCurrent({ ...h, kind: 'book', sub: [h.sub, reads.length ? 'read in class' : 'library book', 'reference material'].filter(Boolean).join(' · '), text: [h.text || h.snippet, ...reads.slice(0, 2).map(readIn)].join('\n') });
      return;
    }
    if (resource === 'commentary') {
      const catalog = await books(env, ctx), ref = catalog && parseReference(query, catalog);
      if (!ref || ref.verse == null) return;
      const book = (BOOKS as { id: number; slug: string }[]).find(b => b.slug === ref.slug);
      if (!book) return;
      const data = await resourceJson(env, `commentaries/${COLLECTION}/en/verses/${book.id}-${ref.chapter}-${ref.verse}`);
      // One entry per class breakdown, each kept with its own class note and moment.
      for (const entry of str(data.content).split('<hr>').filter(Boolean).slice(0, 4)) {
        const heading = htmlToText(/<h3>([\s\S]*?)<\/h3>/.exec(entry)?.[1] ?? '').trim();
        const passage = catalog && parseReference(heading.replace(/^Precept for\s+/i, ''), catalog);
        const kjv = passage ? (await chapter(env, passage.slug, passage.chapter, ctx).catch(() => null))?.verses ?? [] : [];
        const lines: string[] = heading ? [heading] : [];
        for (const para of entry.match(/<p>[\s\S]*?<\/p>/g) ?? []) {
          // The class citation is shown as the source's own title and teacher.
          if (/href="https:\/\/cyberjudah\.io\/(?!bible\/)/.test(para)) continue;
          const numbered = /^<p><b>(\d+)<\/b>/.exec(para), n = numbered ? Number(numbered[1]) : null;
          if (n != null && passage && passage.slug === ref.slug && passage.chapter === ref.chapter && Math.abs(n - ref.verse) > 3) continue;
          const text = htmlToText(numbered ? para.slice(numbered[0].length) : para).trim();
          if (!text) continue;
          const verse = n != null ? kjv.find(v => v.verse === n)?.text : undefined;
          const split = verse ? splitVerse(text, verse) : null;
          lines.push(split?.scripture ? `${passage!.book} ${passage!.chapter}:${n} KJV: “${split.scripture}”${split.teaching ? `\nTeaching: ${split.teaching}` : ''}` : n != null && passage ? `${passage.book} ${passage.chapter}:${n}: ${text}` : text);
        }
        // The class it came from is the entry's last own-site link; earlier ones are scripture links.
        const note = [...entry.matchAll(/href="https:\/\/cyberjudah\.io(\/[a-z0-9][a-z0-9/_-]*)"/gi)].map(m => m[1]).filter(u => !u.startsWith('/bible/')).pop();
        const moment = /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})&amp;t=(\d+)s/.exec(entry);
        // The citation reads "class · date · teacher"; the teacher is named, never CyberJudah.
        const cite = [...entry.matchAll(/href="https:\/\/cyberjudah\.io\/(?!bible\/)[^"]*">[^<]*<\/a>((?: · [^<]*)+)/gi)].pop()?.[1] ?? '';
        const teacher = htmlToText(cite.split(' · ').map(s => s.trim()).filter(s => s && !/^\d{4}-\d{2}-\d{2}$/.test(s)).pop() ?? '').trim();
        addCurrent({ kind: 'commentary', title: `${ref.label} · commentary`, url: note || `/bible/${ref.slug}/${ref.chapter}#v${ref.verse}`, sub: [teacher && !/cyberjudah/i.test(teacher) ? teacher : '', 'class breakdown'].filter(Boolean).join(' · '), text: lines.join('\n'), ...(moment ? { video: moment[1], t: Number(moment[2]) } : {}) });
      }
      return;
    }
    if (resource === 'class-notes') {
      const index = list(await read('/api/notes/index.json')).filter(r => ['class', 'captains', 'history'].includes(str(r.kind)));
      const words = termsOf(query);
      const score = (r: Row) => words.reduce((n, w) => n + (title(r).toLowerCase().includes(w) ? 4 : 0) + ((Array.isArray(r.topics) ? r.topics.join(' ') : '').toLowerCase().includes(w) ? 2 : 0) + (str(r.summary).toLowerCase().includes(w) ? 1 : 0), 0);
      const candidates = index.map(r => ({ r, n: score(r) })).filter(x => x.n > 0 && /^\/[a-z0-9][a-z0-9/_-]*$/i.test(str(x.r.url))).sort((a, b) => b.n - a.n).slice(0, 4);
      // Read the likely notes whole, then keep the two that teach most on the subject, not just name it.
      const read4 = await Promise.all(candidates.map(async ({ r, n }) => {
        const note = object(await read(`/api/notes${str(r.url)}.json`).catch(() => ({})));
        const body = str(note.body).toLowerCase();
        return { r, note, n: n + words.reduce((k, w) => k + Math.min(occurrences(body, w), 12), 0) };
      }));
      for (const { r: row, note } of read4.filter(x => str(x.note.body)).sort((a, b) => b.n - a.n).slice(0, 2)) {
        const url = str(row.url);
        emit({ status: `Reading the notes of ${title(row).slice(0, 160)}` });
        // Sections of the note, each with the class moment it starts at.
        const sections: { text: string; t?: number; i: number }[] = [];
        let at: number | undefined;
        for (const block of str(note.body).split(/\n(?=## |\*\*\[|\*\[\[)/)) {
          const m = /[?&]t=(\d+)s/.exec(block);
          if (m) at = Number(m[1]);
          for (const para of block.split(/\n\s*\n/)) {
            // A Scripture reading quoted in the note is not the teacher's words: the KJV is read separately.
            if (para.trim().split('\n').every(l => !l.trim() || /^\s*>/.test(l) || /^\s*\*\*\[[^\]]+\]\([^)]*\)\*\*/.test(l))) continue;
            const text = noteText(para).replace(/^\[\d{1,2}(?::\d{2}){1,2}\]\s*/, '');
            if (text.length > 40 && !/^Opens\b/.test(text)) sections.push({ text, t: at, i: sections.length });
          }
        }
        const rank = (x: { text: string }) => { const low = x.text.toLowerCase(); return words.reduce((k, w) => k + 3 * occurrences(low, w), 0) + asked.reduce((k, w) => k + Math.min(occurrences(low, w), 2), 0); };
        const best = sections.map(x => ({ ...x, k: rank(x) })).filter(x => x.k > 0).sort((a, b) => b.k - a.k).slice(0, 4);
        const chosen = (best.length ? best : sections.slice(0, 2).map(x => ({ ...x, k: 0 }))).sort((a, b) => a.i - b.i);
        const text = chosen.map(x => `${x.t != null ? `[at ${clock(x.t)}] ` : ''}${x.text.slice(0, 900)}`).join('\n\n');
        const video = str(note.videoId), top = best[0]?.t ?? chosen[0]?.t;
        addCurrent({ kind: str(note.kind) || 'class', title: str(note.title) || title(row), url, sub: [str(note.teacher), 'class notes'].filter(Boolean).join(' · '), date: str(note.date), text, ...(/^[A-Za-z0-9_-]{11}$/.test(video) ? { video, ...(top != null ? { t: top } : {}) } : {}) });
      }
      return;
    }
    if (resource === 'cross-references') {
      const catalog = await books(env, ctx), ref = catalog && parseReference(query, catalog);
      if (!catalog || !ref || ref.verse == null) return;
      const data = object(await read(`/api/xref/${ref.slug}/${ref.chapter}.json`));
      // Each cross-reference is [book-slug, chapter, verse]; the verse itself is read from the KJV.
      const refs = (Array.isArray(data[String(ref.verse)]) ? data[String(ref.verse)] as unknown[] : []).filter((r): r is [string, number, number] => Array.isArray(r) && typeof r[0] === 'string' && /^[a-z0-9-]+$/.test(r[0]) && Number.isInteger(r[1]) && Number.isInteger(r[2])).slice(0, 5);
      for (const [slug, ch, v] of refs) {
        const book = catalog.find(b => b.slug === slug), text = book && (await chapter(env, slug, ch, ctx))?.verses.find(x => x.verse === v)?.text;
        if (book && text) addCurrent({ kind: 'verse', title: `${book.book} ${ch}:${v}`, url: `/bible/${slug}/${ch}#v${v}`, sub: `Cross-reference of ${ref.label}`, text: `${book.book} ${ch}:${v} ${text}` });
      }
      return;
    }
    if (resource === 'places') {
      const rows = list(await read('/api/places/index.json'));
      for (const row of pick(rows, query)) {
        const id = str(row.id);
        if (!/^[a-z0-9-]+$/.test(id)) continue;
        const place = object(await read(`/api/places/${id}.json`));
        const names = Array.isArray(place.names) ? place.names.filter(n => typeof n === 'string').slice(0, 6).join(', ') : '';
        // The site has no place page yet; the place's first verse opens in the reader today.
        const first = /^([a-z0-9-]+)\/(\d+)\/(\d+)$/.exec(Array.isArray(place.verses) ? String(place.verses[0] ?? '') : '');
        if (!first) continue;
        addCurrent({ kind: 'place', entity: id, title: str(place.name) || title(row), url: `/bible/${first[1]}/${first[2]}#v${first[3]}`, sub: 'Place', text: [str(place.description), names && `Also called: ${names}.`, Array.isArray(place.verses) ? `Named in ${place.verses.slice(0, 6).map(v => String(v).replace(/^([a-z0-9-]+)\/(\d+)\/(\d+)$/, (_, b: string, c: string, n: string) => `${b.replace(/-/g, ' ')} ${c}:${n}`)).join('; ')}.` : ''].filter(Boolean).join('\n') });
      }
      return;
    }
    if (resource === 'jewish-encyclopedia') {
      for (const row of await searchJewishEncyclopedia(env, query)) addCurrent({ kind: 'dictionary', title: row.word, sub: 'The Jewish Encyclopedia (1901–1906) · reference material', url: `/dictionary/en/jewish-encyclopedia/${row.id}/entry`, text: row.plain_text });
      return;
    }
    if (resource === 'scripture') {
      const catalog = await books(env, ctx), ref = catalog && parseReference(query, catalog);
      if (!ref) return;
      const data = await chapter(env, ref.slug, ref.chapter, ctx);
      if (!data) throw new Error('RESOURCE_UNAVAILABLE');
      const from = ref.verse ?? 1, to = Math.min(from + 15, ref.verseEnd ?? ref.verse ?? 16);
      addCurrent({ kind: 'verse', title: ref.label, url: `/bible/${ref.slug}/${ref.chapter}#v${from}`, text: data.verses.filter(v => v.verse >= from && v.verse <= to).map(v => `${ref.book} ${ref.chapter}:${v.verse} ${v.text}`).join('\n') });
      return;
    }
    if (['people', 'timeline', 'law', 'precepts', 'verse-study'].includes(resource)) {
      const tool = resource === 'people' ? 'person' : resource === 'verse-study' ? 'verse_study' : resource;
      const arg = tool === 'person' ? 'name' : tool === 'verse_study' ? 'reference' : tool === 'precepts' ? 'topic' : 'query';
      const before = found.length, lines: Found[] = [];
      const call = (input: Record<string, string>) => MORE_RUN[tool](env, input, ctx, emit, (name, text, url) => { lines.push({ kind: resource, title: name, text, url }); return `${name}: ${text}`; }, addCurrent);
      const result = await call({ [arg]: query });
      if (result.error) throw new Error('RESOURCE_UNAVAILABLE');
      const same = resource === 'people' && lines.length > 1 && /^More than one person/.test(result.content ?? '');
      if (same) {
        // Several people share the name: one source lists each with who they were, and the
        // most-named one is read whole so the answer can say which it describes.
        addCurrent({ kind: resource, title: `Everyone named ${query.slice(0, 60)}`, url: lines[0].url, sub: 'People with this name', text: lines.map(l => `${l.title}: ${l.text}`).join('\n') });
        const id = /^\/person\/([a-z0-9-]+)$/.exec(lines[0].url)?.[1];
        lines.length = 0;
        if (id) await call({ [arg]: id });
      }
      lines.forEach(addCurrent);
      // The person's native screen includes actual teaching points; keep these independently
      // attributed, instead of labelling the genealogy or biography itself as teaching.
      if (resource === 'people') for (const s of found.slice(before).filter(x => x.sub !== 'People with this name')) {
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
  return { sources, unavailable,
  /** The Library pages read in the classes already found, so the answer can use the books the classes read. */
  async classBooks() {
    const moments = sources.filter(s => s.evidence === 'teaching' && s.video).map(s => ({ video: s.video!, t: s.t ?? 0 }));
    if (!moments.length) return;
    emit({ status: 'Reading the Library books these classes read from' });
    try {
      const books = await library();
      const reads = books.flatMap(b => b.reads.filter(r => moments.some(m => m.video === r.video)).map(r => ({ b, r, near: Math.min(...moments.filter(m => m.video === r.video).map(m => Math.abs((r.t ?? 0) - m.t))) })))
        .sort((x, y) => x.near - y.near).filter((x, i, all) => all.findIndex(y => y.b.slug === x.b.slug && y.r.vol === x.r.vol && y.r.page === x.r.page) === i).slice(0, 8);
      let added = 0;
      for (const { b, r, near } of reads) {
        if (added >= 3) break;
        const url = `/books/${b.slug}/p/${r.vol}-${r.page}`, page = await pageText(b.slug, b.chapters, r.vol, r.page, r.video);
        // Only a page read near the moment found, or one that speaks to the question itself.
        const low = page ? `${page.text} ${page.said}`.toLowerCase() : '';
        if (!page || (near > 900 && !asked.some(w => low.includes(w)))) continue;
        added++;
        add({ kind: 'book', title: b.title, url, sub: [b.by, page.sub, 'read in class', 'reference material'].filter(Boolean).join(' · '), text: `${page.text.slice(0, 1800)}\n${readIn(r)}${page.said ? `\nWhat the class said there: ${page.said.slice(0, 500)}` : ''}` });
      }
    } catch { unavailable.push('library'); }
  },
  async search(requests: Request[]) {
    // Fixed maximum fanout; source numbering remains stable and deterministic.
    const lists = await Promise.all(requests.slice(0, APP_STUDY_RELEASE.maxSupplementarySearches).map(async request => {
      const found: Found[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([run(request, found), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), 9000); })]);
      } catch { console.log(JSON.stringify({ event: 'app_study_resource_unavailable', release: APP_STUDY_RELEASE.version, resource: request.resource })); unavailable.push(request.resource); emit({ status: `${request.resource.replaceAll('-', ' ')} could not be read just now` }); }
      finally { clearTimeout(timer); }
      // What a timed-out search found before the limit stays; anything later is not read.
      return found.splice(0);
    }));
    for (const found of lists) found.forEach(add);
  } };
}
