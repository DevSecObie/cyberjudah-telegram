import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';

// Placeholder words only: no Scripture and no teaching in these fixtures.
const out = new URL('./.build/ranking.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/ranking.mjs"; export { answerCandidates } from "./src/ai.mjs"; export { retrieve } from "./src/ai.ts";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { rankingV2, rrf, questionParts, rerankText, capPerSource, markRanked, RANKED, scoreBucket, answerCandidates, retrieve, TEACHER_LIFT, PER_SOURCE } = await import(out);

const words = (n, seed = 'alpha') => Array.from({ length: n }, (_, i) => `${seed}${i % 7} filler${i}`).join(' ');
const passage = (url, extra = {}) => ({ kind: 'study', title: `Fixture ${url}`, url, sub: '', text: `${words(30)} placeholder fixture text`, ...extra });

test('the switch is off unless ASK_RANKING is exactly v2', () => {
  for (const v of [undefined, '', 'v1', 'on', 'true', 'v3']) assert.equal(rankingV2({ ASK_RANKING: v }), false, String(v));
  for (const v of ['v2', 'V2', ' v2 ']) assert.equal(rankingV2({ ASK_RANKING: v }), true, v);
  assert.equal(rankingV2(undefined), false);
});

test('reciprocal rank fusion lifts what both lists find, keeps the original objects, and breaks ties by first sight', () => {
  const a = passage('/a'), b = passage('/b'), c = passage('/c'), d = passage('/d');
  const fused = rrf([[a, b, c], [d, c]]);
  assert.equal(fused[0].p, c, 'found by both lists, it rises above each list\'s first');
  assert.deepEqual(fused.map(({ p }) => p.url), ['/c', '/a', '/d', '/b']);
  assert.equal(fused[0].p, c, 'the object itself: no score field is added to what readers are sent');
  assert.equal('fused' in c, false);
  assert.ok(Math.abs(fused[0].fused - (1 / 63 + 1 / 62)) < 1e-12);
  // The same passage under another object (same kind, url and sub) is one passage.
  assert.equal(rrf([[passage('/x')], [passage('/x')]]).length, 1);
  assert.equal(rrf([[passage('/x', { sub: '1' })], [passage('/x', { sub: '2' })]]).length, 2);
});

test('a question is split only into parts that say something; "x and y" phrases are never split', () => {
  assert.deepEqual(questionParts('Who was the placeholder king? Why did the fixture city fall?'), ['Who was the placeholder king', 'Why did the fixture city fall']);
  assert.deepEqual(questionParts('Explain the placeholder covenant and also the fixture festival'), ['Explain the placeholder covenant', 'the fixture festival']);
  assert.deepEqual(questionParts('What is the placeholder law, and why was the fixture order kept?'), ['What is the placeholder law', 'why was the fixture order kept']);
  assert.deepEqual(questionParts('What do the classes say about bread and wine?'), []);
  assert.deepEqual(questionParts('Who was he?'), []);
  assert.deepEqual(questionParts('Why? How?'), [], 'parts with fewer than two words that say something are dropped');
  assert.equal(questionParts('One alpha beta? Two gamma delta? Three epsilon zeta? Four eta theta?').length, 3, 'at most three parts');
});

test('the reranker reads a passage whole when it fits, else its start and the sentences that match the question', () => {
  const short = passage('/s', { date: '2026-01-02' });
  assert.equal(rerankText('anything', short), `${short.title} · 2026-01-02\n${short.text}`);
  const start = 'Opening words. '.repeat(50);
  const long = { title: 'Long fixture', text: `${start}${'Unrelated filler sentence here. '.repeat(100)}The placeholder covenant sentence is here. ${'More unrelated filler. '.repeat(50)}` };
  const read = rerankText('What about the placeholder covenant?', long);
  assert.ok(read.length <= 2000);
  assert.ok(read.startsWith('Long fixture\nOpening words.'));
  assert.match(read, /The placeholder covenant sentence is here\./, 'a matching sentence past the start is read');
  assert.doesNotMatch(read, /Unrelated filler/);
});

test('at most PER_SOURCE passages from one recording or one page', () => {
  const v = (t) => passage(`/video/${t}`, { video: 'vid1', t });
  const list = [v(1), v(2), v(3), passage('/p'), passage('/p', { sub: '2' }), passage('/p', { sub: '3' }), passage('/q')];
  const kept = capPerSource(list);
  assert.equal(PER_SOURCE, 2);
  assert.deepEqual(kept.map((p) => `${p.url}${p.sub}`), ['/video/1', '/video/2', '/p', '/p2', '/q']);
});

test('v2 candidates follow the reranker score; the teacher lift breaks a near tie but a better match outweighs it (A6)', () => {
  const q = 'placeholder question words';
  const plain = markRanked(passage('/plain'), 0.90);
  const bishop = markRanked(passage('/bishop', { teacher: 'Bishop Fixture' }), 0.88);
  const deacon = markRanked(passage('/deacon', { teacher: 'Deacon Fixture' }), 0.70);
  const best = markRanked(passage('/best'), 0.99);
  const order = answerCandidates(q, [plain, deacon, bishop, best], 8).map((p) => p.url);
  assert.deepEqual(order, ['/best', '/bishop', '/plain', '/deacon'], 'a 0.02 gap is closed by the lift; a 0.11 gap is not');
  assert.ok(TEACHER_LIFT.bishop > TEACHER_LIFT.deacon && TEACHER_LIFT.bishop < 0.1, 'a small lift');
});

test('v2 candidates fall back to the fused order when the reranker failed, and keep v1 untouched for v1 passages', () => {
  const fusedOrder = ['/one', '/two', '/three'].map((u) => markRanked(passage(u), null));
  assert.deepEqual(answerCandidates('nothing shared', fusedOrder, 8).map((p) => p.url), ['/one', '/two', '/three']);
  // v1: no marks, ordered by score as today.
  const v1 = [passage('/low', { score: 0.5 }), passage('/high', { score: 0.8 })];
  assert.deepEqual(answerCandidates('nothing shared', v1, 8).map((p) => p.url), ['/high', '/low']);
  assert.equal(JSON.stringify(fusedOrder[0]).includes('rerank'), false, 'the mark never reaches JSON');
  assert.ok(fusedOrder[0][RANKED]);
});

test('score buckets are coarse', () => {
  assert.deepEqual([0.95, 0.6, 0.3, 0.1, NaN, null, undefined].map(scoreBucket), ['0.8+', '0.5-0.8', '0.2-0.5', '<0.2', 'none', 'none', 'none']);
});

// The whole v2 search, offline: embeddings, Vectorize, the keyword index (FTS5) and the reranker are fixtures.
function db(rows) {
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE VIRTUAL TABLE search_docs USING fts5(kind UNINDEXED, title, url UNINDEXED, sub UNINDEXED, text, book UNINDEXED, chapter UNINDEXED, tokenize='porter unicode61')");
  const insert = sql.prepare('INSERT INTO search_docs(kind, title, url, sub, text, book, chapter) VALUES (?, ?, ?, ?, ?, NULL, NULL)');
  for (const r of rows) insert.run(r.kind, r.title, r.url, r.sub ?? '', r.text);
  const prep = (q) => {
    let args = [];
    const st = { bind: (...a) => { args = a; return st; }, all: async () => ({ results: sql.prepare(q).all(...args) }), first: async () => sql.prepare(q).get(...args) ?? null, run: async () => sql.prepare(q).run(...args) };
    return st;
  };
  return { prepare: prep, batch: async (sts) => Promise.all(sts.map((s) => s.all())) };
}

function fixtureEnv({ rerank = 'ok', ranking = 'v2' } = {}) {
  const calls = { embed: [], vec: 0, rerank: [] };
  const dense = [
    { score: 0.81, metadata: { kind: 'study', title: 'Dense one', url: 'https://cyberjudah.io/study/dense-one', text: `${words(25, 'gamma')} placeholder covenant` } },
    { score: 0.79, metadata: { kind: 'study', title: 'Both', url: 'https://cyberjudah.io/study/both', text: `${words(25, 'delta')} placeholder covenant` } },
    { score: 0.70, metadata: { kind: 'study', title: 'Too short', url: 'https://cyberjudah.io/study/short', text: 'few words' } },
  ];
  const env = {
    ASK_RANKING: ranking,
    DB: db([
      { kind: 'study', title: 'Both', url: 'https://cyberjudah.io/study/both', text: `${words(25, 'delta')} placeholder covenant` },
      { kind: 'law', title: 'Keyword only', url: 'https://cyberjudah.io/law/keyword-only', text: `${words(25, 'eps')} placeholder covenant festival` },
    ]),
    VEC: { query: async () => { calls.vec++; return { matches: dense }; } },
    AI: { run: async (model, input) => {
      if (model.includes('bge-m3')) { calls.embed.push(...input.text); return { data: input.text.map(() => [0.1, 0.2]) }; }
      if (model.includes('reranker')) {
        calls.rerank.push(input.contexts.length);
        if (rerank === 'fail') throw new Error('reranker down');
        // The reranker prefers the keyword-only passage, then "Both".
        return { response: input.contexts.map((c, id) => ({ id, score: c.text.startsWith('Keyword only') ? 0.93 : c.text.startsWith('Both') ? 0.81 : 0.42 })) };
      }
      throw new Error(`unexpected model ${model}`);
    } },
  };
  return { env, calls };
}

test('v2 retrieval fuses meaning and words, keeps the reranker scores, logs numbers only, and drops short passages', async () => {
  const { env, calls } = fixtureEnv();
  const logs = [], original = console.log;
  console.log = (line) => logs.push(String(line));
  let found;
  try { found = await retrieve(env, 'What is the placeholder covenant?', 12); } finally { console.log = original; }
  assert.deepEqual(found.map((p) => p.title), ['Keyword only', 'Both', 'Dense one'], 'in the reranker\'s order');
  assert.deepEqual(found.map((p) => p[RANKED].rerank), [0.93, 0.81, 0.42]);
  assert.ok(!found.some((p) => p.title === 'Too short'));
  assert.deepEqual(calls.rerank, [3], 'the reranker read the fused pool once');
  const line = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.event === 'ask_retrieval');
  assert.deepEqual(line, { event: 'ask_retrieval', ranking: 'v2', parts: 0, dense: 2, keyword: 2, both: 1, pool: 3, rerank: 'ok', rerank_ms: line.rerank_ms, top: '0.8+', final: 3 });
  assert.equal(typeof line.rerank_ms, 'number');
  assert.doesNotMatch(JSON.stringify(line), /placeholder|covenant|cyberjudah|Keyword only/, 'no question, passage or address in the telemetry');
});

test('v2 retrieval keeps the fused order when the reranker fails, and searches each part of a several-part question', async () => {
  const { env, calls } = fixtureEnv({ rerank: 'fail' });
  const logs = [], original = console.log;
  console.log = (line) => logs.push(String(line));
  let found;
  try { found = await retrieve(env, 'What is the placeholder covenant? Why was the fixture festival kept?', 12); } finally { console.log = original; }
  assert.equal(calls.embed.length, 3, 'the whole question and its two parts');
  assert.equal(calls.vec, 3);
  assert.ok(found.length > 0 && found.every((p) => p[RANKED] && p[RANKED].rerank === null));
  assert.equal(found[0].title, 'Both', 'found by meaning and by words for the whole question and a part: first by fusion');
  const line = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.event === 'ask_retrieval');
  assert.equal(line.rerank, 'fallback');
  assert.equal(line.parts, 2);
});

test('with the switch off, retrieval is v1 and logs it', async () => {
  const { env } = fixtureEnv({ ranking: '' });
  env.DB = { prepare: () => { throw new Error('v1 runSearch fixture not needed'); }, batch: async () => { throw new Error('no keyword search in this fixture'); } };
  const logs = [], original = console.log;
  console.log = (line) => logs.push(String(line));
  let found;
  try { found = await retrieve(env, 'What is the placeholder covenant?', 12); } finally { console.log = original; }
  assert.ok(found.length && found.every((p) => !p[RANKED]), 'v1 passages carry no v2 mark');
  const line = logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((l) => l?.event === 'ask_retrieval');
  assert.equal(line.ranking, 'v1');
});
