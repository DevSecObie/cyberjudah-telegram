import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import * as Schema from 'effect/Schema';
import * as Bible from '../upstream/contracts/bibleChapterContract.ts';
import * as Strong from '../upstream/contracts/strongBibleContract.ts';
import * as Lexicon from '../upstream/contracts/strongLexiconContract.ts';
import * as Dictionary from '../upstream/contracts/dictionaryContract.ts';
import * as Nave from '../upstream/contracts/naveContract.ts';
import * as Commentary from '../upstream/contracts/commentaryReadingContract.ts';
import * as Supplementary from '../upstream/contracts/supplementaryContract.ts';
import * as Timeline from '../upstream/contracts/timelineContract.ts';
import * as Analytics from '../upstream/contracts/searchAnalyticsContract.ts';
import * as Problems from '../upstream/problems.ts';
import { buildCommentaryReadingSections, createCommentaryReadingIndex } from '../upstream/contracts/commentarySections.ts';
import { getStrongBibleConcordanceCandidates } from '../upstream/strongBibleConcordance.ts';
import worker from '../../src/index.ts';
import { BOOKS, metadata, bibleResource } from '../../src/bs/core.ts';
import { makeSections } from '../../src/bs/commentary.ts';
import { strongCode } from '../../src/bs/strongs.ts';

const fixture = async (path: string) => JSON.parse(await readFile(new URL(`../fixtures/bs/${path}`, import.meta.url), 'utf8'));
const paths = [
  'api/kjv/books.json', 'api/kjv/genesis/1.json', 'api/kjv/john/1.json', 'api/kjv/wisdom-of-solomon/1.json', 'api/kjv/2-maccabees/1.json',
  'api/lxx/wisdom-of-solomon/1.json', 'api/lxx/2-maccabees/1.json', 'api/strongs/H1.json', 'api/strongs/G3056.json', 'api/strongs/index.json',
  'api/xref/john/1.json', 'api/concordance/john/1.json', 'api/topics/faith.json',
];
const originals = new Map(await Promise.all(paths.map(async path => [`/${path}`, await fixture(path)] as const)));
originals.set('/api/concordance/index.json', [{ slug: 'john', cited: [1] }, { slug: '2-maccabees', cited: [1] }]);
originals.set('/api/topics/index.json', [{ slug: 'faith', label: 'Faith' }]);
originals.set('/api/notes/index.json', []);
const data = new Map<string, unknown>(), fetched: string[] = [], cache = new Map<string, Response>();
const originalFetch = globalThis.fetch;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} };
let failure: number | undefined;
globalThis.fetch = async input => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://data.cyberjudah.io', 'Only CyberJudah data may be fetched');
  fetched.push(url.pathname);
  if (failure) return new Response('', { status: failure });
  const value = data.get(url.pathname);
  return value === undefined ? new Response('', { status: 404 }) : Response.json(value);
};
Object.defineProperty(globalThis, 'caches', { configurable: true, value: { default: { match: async (url: string) => cache.get(String(url))?.clone(), put: async (url: string, res: Response) => { cache.set(String(url), res.clone()); } } } });
const sqlite = new DatabaseSync(':memory:');
sqlite.exec("CREATE VIRTUAL TABLE search_docs USING fts5(kind UNINDEXED,title,url UNINDEXED,sub UNINDEXED,text,book UNINDEXED,chapter UNINDEXED,tokenize='porter unicode61')");
const insert = sqlite.prepare('INSERT INTO search_docs VALUES(?,?,?,?,?,?,?)');
for (const path of ['api/kjv/genesis/1.json', 'api/kjv/john/1.json', 'api/kjv/wisdom-of-solomon/1.json', 'api/kjv/2-maccabees/1.json']) {
  const ch = originals.get(`/${path}`), slug = path.split('/')[2];
  for (const v of ch.verses) insert.run('verse', `${ch.book} ${ch.chapter}:${v.verse}`, `/bible/${slug}/${ch.chapter}#v${v.verse}`, '', v.text, ch.book, ch.chapter);
}
insert.run('class', 'God', '/classes/test', '', 'God', '', '');
const db = { prepare(sql: string) {
  return { bind(...params: unknown[]) { const stmt = sqlite.prepare(sql); return { first: async () => stmt.get(...params), all: async () => ({ results: stmt.all(...params) }) }; } };
} };
const env = { DATA_ORIGIN: 'https://data.cyberjudah.io', DB: db, ASSETS: { fetch: () => { throw new Error('A /bs request fell through to the SPA'); } } };
beforeEach(async () => { await Promise.all(pending.splice(0)); data.clear(); for (const [key, value] of originals) data.set(key, structuredClone(value)); cache.clear(); fetched.length = 0; failure = undefined; });
after(() => { globalThis.fetch = originalFetch; delete (globalThis as any).caches; sqlite.close(); });
const covered = new Set<string>();
const allRoutes = [...(await readFile(new URL('../upstream/api.ts.txt', import.meta.url), 'utf8')).matchAll(/HttpApiEndpoint\.(get|post)\(\s*'[^']+',\s*'([^']+)'/g)].map(m => ({ method: m[1].toUpperCase(), path: m[2] }));
async function request(path: string, schema: Schema.Schema.Any, options: { body?: unknown; status?: number; method?: string } = {}) {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET');
  const url = new URL(`https://cyberjudah.io/bs${path}`);
  const route = allRoutes.find(r => r.method === method && new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`).test(url.pathname.slice(3)));
  if (route) covered.add(`${route.method} ${route.path}`);
  const res = await worker.fetch(new Request(url, { method, ...(options.body !== undefined ? { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } } : {}) }), env as any, ctx as any);
  const json = await res.json();
  assert.equal(res.status, options.status ?? 200, `${method} ${path}: ${JSON.stringify(json)}`);
  Schema.decodeUnknownSync(schema)(json);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control') === 'no-store', res.status !== 200 || method !== 'GET');
  return { json: json as any, res };
}

test('public Worker mount and CORS; every Bible route uses the upstream response schema', async () => {
  await request('/health', Schema.Struct({ status: Schema.Literal('ok') }));
  const { json: chapter, res } = await request('/v1/bibles/KJV/books/43/chapters/1', Bible.BibleChapterDto);
  assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal(chapter.verses[0].text, originals.get('/api/kjv/john/1.json').verses[0].text);
  assert.equal(chapter.resource.textSha256, metadata.textSha256);
  await request('/v1/bibles/chapters?versions=KJV,KJV&book=43&chapter=1', Bible.BibleChaptersDto);
  const { json: verses } = await request('/v1/bibles/KJV/verses?references=43-1-2,1-1-1,43-1-2', Bible.BibleVerseTextsDto);
  assert.deepEqual(verses.verses.map((v: any) => [v.book, v.number]), [[43, 2], [1, 1], [43, 2]]);
  await request('/v1/bibles/KJV/coverage', Bible.BibleVersionCoverageDto);
  const { json: empty } = await request('/v1/bibles/KJV/pericopes', Bible.BiblePericopeIndexDto);
  assert.deepEqual(empty.verses, []);
  const options = await worker.fetch(new Request('https://cyberjudah.io/bs/v1/bibles/chapters', { method: 'OPTIONS' }), env as any, ctx as any);
  assert.equal(options.status, 204); assert.equal(await options.text(), '');
  assert.match(options.headers.get('access-control-allow-methods')!, /POST/);
});

test('81 books retain exact 1611 names, number Epistle before Song, and preserve sparse chapters', async () => {
  assert.equal(BOOKS.length, 81);
  assert.deepEqual(BOOKS.slice(66).map(b => b.name), ['1 Esdras','2 Esdras','Tobit','Judith','Rest of Esther','Wisdom of Solomon','Ecclesiasticus','Baruch','Epistle of Jeremiah','Song of the Three Holy Children','History of Susanna','Bel and the Dragon','Prayer of Manasses','1 Maccabees','2 Maccabees']);
  const { json: coverage } = await request('/v1/bibles/KJV/coverage', Bible.BibleVersionCoverageDto);
  assert.deepEqual(coverage.books, Array.from({ length: 81 }, (_, i) => i + 1));
  assert.deepEqual(coverage.chaptersByBook['71'], [10, 11, 12, 13, 14, 15, 16]);
  for (const [key, count] of Object.entries(metadata.verseCountByBookChapter)) assert.ok(count > 0, key);
  const { json: apocrypha } = await request('/v1/bibles/KJV/books/81/chapters/1', Bible.BibleChapterDto);
  assert.match(apocrypha.verses[0].presentation.notes[0].markup, /Swete/);
  assert.match(apocrypha.verses[0].presentation.notes[0].markup, /ΤΟΙΣ/);
  assert.equal(apocrypha.verses[0].text, originals.get('/api/kjv/2-maccabees/1.json').verses[0].text);
  // The original upstream schema rejects 78–81; this is the sole response extension.
  const ExtendedVerseTexts = Schema.Struct({ ...Bible.BibleVerseTextsDto.fields, verses: Schema.Array(Schema.Struct({ ...Bible.BibleVerseTextDto.fields, book: Schema.Int.pipe(Schema.between(1, 81)) })) });
  const { json } = await request('/v1/bibles/KJV/verses?references=81-1-1', ExtendedVerseTexts);
  assert.throws(() => Schema.decodeUnknownSync(Bible.BibleVerseTextsDto)(json));
  assert.throws(() => Schema.decodeUnknownSync(Bible.BibleChapterRequest)({ version: 'KJV', book: '81', chapter: '1' }));
});

test('search uses real FTS5, applies filters before paging, counts all matches and excludes classes', async () => {
  const { json: first } = await request('/v1/bibles/KJV/search?q=God&limit=2&sortOrder=book', Bible.BibleSearchResponseDto);
  const { json: second } = await request('/v1/bibles/KJV/search?q=God&limit=2&offset=2&sortOrder=book', Bible.BibleSearchResponseDto);
  assert.ok(first.count > 4); assert.equal(first.count, second.count);
  assert.equal(first.results[0].book, 1); assert.notDeepEqual(first.results, second.results);
  const { json: john } = await request('/v1/bibles/search?versions=KJV&q=God&book=43&limit=100', Bible.BibleMultiSearchResponseDto);
  assert.ok(john.results.length > 0); assert.equal(john.count, john.results.length); assert.ok(john.results.every((r: any) => r.book === 43));
  const { json: apoc } = await request('/v1/bibles/KJV/search?q=God&book=81', Bible.BibleSearchResponseDto);
  assert.ok(apoc.results.length > 0); assert.ok(apoc.results.every((r: any) => r.book === 81));
  const { json: phrase } = await request('/v1/bibles/KJV/search?q=%22in%20the%20beginning%22&section=nt', Bible.BibleSearchResponseDto);
  assert.ok(phrase.results.every((r: any) => r.text.toLowerCase().includes('in the beginning') && r.book === 43));
  for (const path of ['/v1/bibles/KJV/semantic-search?q=faith', '/v1/bibles/semantic-search?versions=KJV&q=faith']) {
    const { json } = await request(path, path.includes('?versions') ? Bible.BibleMultiSearchResponseDto : Bible.BibleSearchResponseDto);
    assert.deepEqual(json.results, []); assert.equal(json.count, 0);
  }
});

test('lexicon routes, modules, cursors, batch cards and unavailable enhancements match schemas', async () => {
  await request('/v1/strong-lexicon/modules/core', Lexicon.StrongLexiconModuleStateDto);
  const { json: module } = await request('/v1/strong-lexicon/modules/entities', Lexicon.StrongLexiconModuleStateDto); assert.equal(module.status, 'unavailable');
  const { json: entry } = await request('/v1/strong-lexicon/entries/G03056?language=en', Lexicon.StrongLexiconEntryDto);
  assert.equal(entry.classicStrong, 'G3056'); assert.equal(entry.original, 'λόγος'); assert.equal(entry.stepCode, 'G3056');
  await request('/v1/strong-lexicon/entries/batch?language=en&identities=strong:H0001,strong:G3056,estrong:G3056A', Lexicon.StrongLexiconEntryCardsDto);
  const { json: page } = await request('/v1/strong-lexicon/entries?language=en&limit=1', Lexicon.StrongLexiconSearchResponseDto);
  assert.ok(page.nextCursor); assert.ok(Lexicon.decodeStrongLexiconPageCursor(page.nextCursor));
  await request(`/v1/strong-lexicon/entries/${page.entries[0].stepCode}?language=en`, Lexicon.StrongLexiconEntryDto);
  const { json: next } = await request(`/v1/strong-lexicon/entries?language=en&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, Lexicon.StrongLexiconSearchResponseDto);
  assert.notEqual(next.entries[0].id, page.entries[0].id);
  await request('/v1/strong-lexicon/random?language=en&lexicalLanguage=greek', Lexicon.StrongLexiconSearchResponseDto);
  await request('/v1/strong-lexicon/morphologies?language=en&codes=N-NSM', Lexicon.StrongLexiconMorphologyResponseDto);
  await request('/v1/strong-lexicon/entities/chapters/John/1?language=en', Lexicon.StrongLexiconChapterEntitiesResponseDto);
  await request('/v1/strong-lexicon/entities/unknown?language=en', Problems.ResourceNotFoundProblem, { status: 404 });
});

test('Strong chapters use exact KJV offsets; concordance includes occurrences beyond the source entry cap', async () => {
  const { json: coverage } = await request('/v1/strong-bibles/KJV/coverage', Strong.StrongBibleCoverageDto);
  assert.equal(coverage.books.length, 66); assert.ok(!coverage.books.includes(72));
  const { json: chapter } = await request('/v1/strong-bibles/KJV/books/43/chapters/1', Strong.StrongBibleChapterDto);
  const text = originals.get('/api/kjv/john/1.json').verses[0].text;
  const spans = chapter.verses[0].spans.filter((s: any) => s.identities.some((i: any) => i.code === 'G3056'));
  assert.ok(spans.length > 0);
  for (const span of spans) assert.match(text.slice(span.startOffset, span.startOffset + span.length), /Word/);
  const { json: apoc } = await request('/v1/strong-bibles/KJV/books/72/chapters/1', Strong.StrongBibleChapterDto);
  assert.ok(apoc.verses.every((v: any) => v.spans.length === 0));
  const { json: counts } = await request('/v1/strong-bibles/KJV/books/1/identities/1/counts', Strong.StrongBibleCountsDto);
  const total = counts.counts.reduce((n: number, b: any) => n + b.verseCount, 0);
  assert.ok(total > 600);
  let fetchedCount = 0, cursor = '', last = '';
  do {
    const { json: page } = await request(`/v1/strong-bibles/KJV/books/1/identities/H0001/occurrences?allBooks=true&limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, Strong.StrongBibleOccurrencesDto);
    for (const v of page.verses) { const key = [v.book,v.chapter,v.verse].map(n => String(n).padStart(3, '0')).join('-'); assert.ok(key > last); last = key; }
    fetchedCount += page.verses.length; cursor = page.nextCursor ?? '';
  } while (cursor);
  assert.equal(fetchedCount, total);
  const { json: john } = await request('/v1/strong-bibles/KJV/books/43/identities/3056/occurrences?limit=500', Strong.StrongBibleOccurrencesDto);
  assert.ok(john.verses.every((v: any) => v.book === 43));
  await request('/v1/strong-bibles/KJV/books/43/identities/G3056/lemmas', Strong.StrongBibleLemmaStatsDto);
  assert.ok(getStrongBibleConcordanceCandidates(72, 3056).some(c => c.code === strongCode('3056', 72)));
});

test('Easton catalog, directory, lookup, batches and passage discovery are all one English work', async () => {
  const { json: catalog } = await request('/v1/dictionaries', Dictionary.DictionaryCatalogResponseDto);
  assert.equal(catalog.dictionaries.length, 1); assert.equal(catalog.dictionaries[0].resource.work, 'easton');
  const { json: directory } = await request('/v1/dictionaries/directory?language=en&limit=1', Dictionary.DictionaryDirectoryResponseDto);
  assert.ok(Dictionary.decodeDictionaryDirectoryPageCursor(directory.nextCursor));
  await request(`/v1/dictionaries/directory?language=en&limit=1&cursor=${encodeURIComponent(directory.nextCursor)}`, Dictionary.DictionaryDirectoryResponseDto);
  const { json: entries } = await request('/v1/dictionaries/easton/en/entries?limit=1', Dictionary.DictionaryEntriesResponseDto);
  assert.ok(Dictionary.decodeDictionaryPageCursor(entries.nextCursor));
  await request(`/v1/dictionaries/easton/en/entries?limit=1&cursor=${encodeURIComponent(entries.nextCursor)}`, Dictionary.DictionaryEntriesResponseDto);
  const { json: entry } = await request('/v1/dictionaries/easton/en/entries/God', Dictionary.DictionaryEntryResponseDto);
  await request(`/v1/dictionaries/easton/en/entries/by-id/${entry.entry.id}`, Dictionary.DictionaryEntryResponseDto);
  await request('/v1/dictionaries/easton/en/entries/batch?words=God,Light', Dictionary.DictionaryEntriesBatchResponseDto);
  const { json: words } = await request('/v1/dictionaries/easton/en/verses/43-1-1/words', Dictionary.DictionaryVerseWordsResponseDto);
  assert.ok(words.words.includes('God'));
  await request('/v1/dictionaries/easton/en/verses/43-1-1/entries', Dictionary.DictionaryPassageAnchorsResponseDto);
  const { json: discovery } = await request('/v1/dictionaries/verses/43-1-1/entries?language=en', Dictionary.DictionaryPassageDiscoveryResponseDto);
  assert.ok(discovery.entries.length > 0); assert.ok(discovery.entries.every((e: any) => e.evidenceKind === 'verse-phrase'));
});

test('Nave routes map our topic threads, including exact verse associations', async () => {
  await request('/v1/naves/en/topics', Nave.NaveTopicListResponseDto);
  const { json: topic } = await request('/v1/naves/en/topics/faith', Nave.NaveTopicResponseDto);
  assert.match(topic.topic.description, /Genesis 2:7/); assert.match(topic.topic.description, /youtube.com/);
  await request('/v1/naves/en/random', Nave.NaveTopicResponseDto);
  const { json: matching } = await request('/v1/naves/en/verses/1-2-7/topics', Nave.NaveVerseTopicsResponseDto);
  assert.equal(matching.verseTopics[0].normalizedName, 'faith');
  const { json: absent } = await request('/v1/naves/en/verses/1-2-6/topics', Nave.NaveVerseTopicsResponseDto);
  assert.equal(absent.verseTopics.length, 0);
});

test('commentary sections agree with the upstream section builder, maintain ranking, provenance and revision locking', async () => {
  const variant = structuredClone(originals.get('/api/concordance/john/1.json'));
  const original = variant.commentary[0];
  variant.commentary = ['Captain Example', 'Deacon Example', 'Bishop Example'].map(teacher => ({ ...original, verses: '1,3', note: { ...original.note, teacher }, points: [original.points[0]] }));
  variant.precepts = []; // Ranking and discontiguous ranges are exercised without unrelated source rows.
  data.set('/api/concordance/john/1.json', variant);
  // Source text remains from CyberJudah; role labels vary to verify sorting.
  const actual = (await request('/v1/commentaries/cyberjudah/en/chapters/43/1', Supplementary.CommentaryChapterResponseDto)).json;
  const comments = JSON.parse(actual.serializedComments);
  assert.match(comments['1'][0], /Bishop Example/);
  assert.match(comments['1'][1], /Deacon Example/);
  assert.match(comments['1'][2], /Captain Example/);
  assert.equal(comments['2'], undefined);
  const upstream = buildCommentaryReadingSections({ entry: { id: 'cyberjudah', publicationId: 'cyberjudah' }, language: 'en', book: 43, chapter: 1, comments });
  const own = makeSections(comments, 43, 1);
  assert.deepEqual(own.map(({ excerpt, ...s }) => s), upstream.map(({ preview, ...s }) => s));
  assert.deepEqual(own.map(({ content, ...s }) => s), createCommentaryReadingIndex(upstream));
  await request('/v1/commentaries/cyberjudah/en/coverage', Supplementary.CommentaryCoverageResponseDto);
  await request('/v1/commentaries/cyberjudah/en/verses/43-1-7', Supplementary.CommentaryVerseResponseDto);
  const selection = { book: 43, chapter: 1, resources: [{ resourceId: 'cyberjudah', language: 'en' }, { resourceId: 'absent', language: 'en' }] };
  const { json: index } = await request('/v1/commentaries/reading-index', Commentary.CommentaryReadingIndexResponse, { body: selection });
  assert.equal(index.unavailable[0].cause, 'not-found'); assert.ok(index.indexes[0].sections.length > 0);
  const i = index.indexes[0], section = i.sections[0];
  const detailRequest = { book: 43, chapter: 1, resourceId: 'cyberjudah', language: 'en', revision: i.resource.revision, sectionId: section.id };
  const { json: detail } = await request('/v1/commentaries/reading-section', Commentary.CommentaryReadingSectionResponse, { body: detailRequest });
  assert.match(detail.section.content, /2026/); assert.match(detail.section.content, /Bishop/); assert.match(detail.section.content, /youtube.com\/watch/);
  await request('/v1/commentaries/reading-section', Problems.ResourceNotFoundProblem, { body: { ...detailRequest, revision: 'stale' }, status: 404 });
  // Gaps must remain gaps, even when the same paragraph occurs at several verses.
  const fragment = '<p>CyberJudah</p>';
  const runs = makeSections({ 1: [fragment], 3: [fragment] }, 43, 1);
  assert.deepEqual(runs.map(s => [s.rangeStartVerse, s.rangeEndVerse]), [[1, 1], [3, 3]]);
});

test('cross references, empty timelines and unsupported resources use the documented schemas', async () => {
  const { json: refs } = await request('/v1/cross-references/fr/verses/43-1-1', Supplementary.CrossReferenceResponseDto);
  assert.ok(refs.references.includes('1-1-1'));
  await request('/v1/cross-references/en/verses/43-1-1', Supplementary.CrossReferenceResponseDto);
  const { json: timeline } = await request('/v1/timelines/en/events', Timeline.TimelineEventsResponseDto); assert.deepEqual(timeline.events, []);
  await request('/v1/timelines/en/events/unknown', Problems.ResourceNotFoundProblem, { status: 404 });
  await request('/v1/interlinear-bibles/BHG/languages/en/coverage', Problems.ResourceNotFoundProblem, { status: 404 });
  await request('/v1/interlinear-bibles/BHG/languages/en/books/1/chapters/1', Problems.ResourceNotFoundProblem, { status: 404 });
  const { json: analytics } = await request('/v1/search-events', Analytics.SearchAnalyticsAcceptedDto, { body: {}, status: 202 }); assert.equal(analytics.accepted, false);
});

test('invalid input, missing resources, upstream failures and stale text return typed, uncached problems', async () => {
  for (const path of ['/v1/bibles/NIV/books/1/chapters/1', '/v1/bibles/chapters?versions=KJV,NIV&book=1&chapter=1', '/v1/bibles/KJV/books/71/chapters/1', '/v1/dictionaries/easton/fr/entries/God', '/v1/naves/en/topics/unknown', '/v1/strong-bibles/NIV/coverage']) {
    await request(path, Problems.ResourceNotFoundProblem, { status: 404 });
  }
  for (const path of ['/v1/bibles/KJV/books/82/chapters/1', '/v1/bibles/KJV/search?q=x&limit=101', '/v1/bibles/KJV/search?q=x&offset=-1', '/v1/bibles/KJV/verses?references=1-1-1,../x', '/v1/naves/en/topics?cursor=garbage', '/v1/naves/en/verses/43-1-0/topics', '/v1/commentaries/cyberjudah/en/verses/043-1-1', '/v1/strong-lexicon/entries?language=en&cursor=null', '/v1/dictionaries/easton/en/entries?cursor=%5B%5D', '/v1/strong-bibles/KJV/books/1/identities/H1/occurrences?cursor=oops']) {
    await request(path, Problems.InvalidResourceRequestProblem, { status: 400 });
  }
  assert.deepEqual([...new Set(fetched)], ['/api/topics/unknown.json', '/api/topics/index.json', '/api/strongs/index.json']);
  failure = 500;
  await request('/v1/bibles/KJV/books/1/chapters/1', Problems.ResourceUnavailableProblem, { status: 503 });
  failure = undefined;
  const changed = structuredClone(originals.get('/api/kjv/john/1.json')); changed.verses[0].text += ' changed'; data.set('/api/kjv/john/1.json', changed);
  await request('/v1/bibles/KJV/books/43/chapters/1', Problems.ResourceUnavailableProblem, { status: 503 });
  assert.ok([...cache.values()].every(r => r.ok));
});

test('origin cache is reused, failures are retried, and Nave cursors preserve ordering', async () => {
  await request('/v1/bibles/KJV/books/43/chapters/1', Bible.BibleChapterDto);
  await Promise.all(pending.splice(0));
  await request('/v1/bibles/KJV/books/43/chapters/1', Bible.BibleChapterDto);
  assert.equal(fetched.filter(p => p === '/api/kjv/john/1.json').length, 1);
  failure = 500;
  await request('/v1/bibles/KJV/books/1/chapters/1', Problems.ResourceUnavailableProblem, { status: 503 });
  failure = undefined;
  await request('/v1/bibles/KJV/books/1/chapters/1', Bible.BibleChapterDto);
  assert.equal(fetched.filter(p => p === '/api/kjv/genesis/1.json').length, 2);
  data.set('/api/topics/index.json', [{ slug: 'repentance', label: 'Repentance' }, { slug: 'faith', label: 'Faith' }]);
  const { json: first } = await request('/v1/naves/en/topics?limit=1', Nave.NaveTopicListResponseDto);
  assert.equal(first.topics[0].normalizedName, 'faith');
  assert.ok(Nave.decodeNavePageCursor(first.nextCursor));
  const { json: second } = await request(`/v1/naves/en/topics?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, Nave.NaveTopicListResponseDto);
  assert.equal(second.topics[0].normalizedName, 'repentance'); assert.equal(second.nextCursor, undefined);
});

test('all upstream HTTP routes were exercised against Effect schemas', () => {
  const missing = allRoutes.filter(r => !covered.has(`${r.method} ${r.path}`));
  assert.deepEqual(missing, []);
  assert.equal(allRoutes.length, 47);
});
