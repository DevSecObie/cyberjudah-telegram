import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest, contextKey, statementKey, retrievalRuntime, withPublicMetadata, evaluateCase, recordedRetrieval, replayBindings } from '../evals/retrieval-replay.mjs';
import { scoreRetrieval, retrievalRegressions } from '../evals/retrieval-metrics.mjs';

const text = 'Preview test (not an answer). Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.';
const docs = [
  { kind: 'study', title: 'Preview alpha', url: '/study/preview-direct/1', sub: '', text },
  { kind: 'study', title: 'Preview beta', url: '/study/preview-related/1', sub: '', text },
  { kind: 'study', title: 'Preview gamma', url: '/study/preview-fts/1', sub: '', text },
];
const golden = { version: 1, approval: 'synthetic unit fixture, not an answer or a staging measurement', queries: [{ id: 'preview', type: 'preview', q: 'Preview alpha beta', judgments: { [docs[0].url]: 2, [docs[1].url]: 1 } }] };
const notesIndex = [{ url: docs[0].url, teacher: 'Bishop Preview test (not an answer)', date: '2000-01-01' }];

async function fixture() {
  const runtime = await retrievalRuntime(), query = golden.queries[0];
  const recording = { goldenSha256: digest(golden), metadata: { notesIndex }, records: [{ id: query.id, query: runtime.retrievalText(query.q, []), embeddingModel: runtime.EMBED_MODEL, rerankModel: runtime.RERANK_MODEL, vectorQueries: [], ftsBatches: [], rerankScores: [] }] };
  const record = recording.records[0];
  const statement = (sql, params = []) => ({ sql, params, bind: (...bound) => statement(sql, bound) });
  const env = {
    SITE_URL: 'https://cyberjudah.io', SUBS: { get: async () => null },
    DB: { prepare: statement, async batch(statements) {
      const result = statements.map(({ sql, params }) => ({ results: /count\(\*\)/.test(sql) ? [{ kind: 'study', n: 20 }] : params[1] === 'study' ? [{ ...docs[2], snippet: 'Preview test (not an answer)' }] : [] }));
      record.ftsBatches.push({ key: statementKey(statements), result }); return result;
    } },
    AI: { async run(model, input) {
      if (model === runtime.EMBED_MODEL) return { data: [[0]] };
      assert.equal(model, runtime.RERANK_MODEL);
      const response = input.contexts.map(({ text }, id) => {
        const score = text.startsWith(docs[0].title) ? 0.99 : text.startsWith(docs[1].title) ? 0.4 : 0.1;
        record.rerankScores.push({ key: contextKey(input.query, text), score }); return { id, score };
      }).sort((a, b) => b.score - a.score);
      return { response };
    } },
    VEC: { async query(_vector, options) {
      const result = { matches: docs.slice(0, 2).map((metadata, i) => ({ id: `d:preview-${i}`, score: i ? 0.9 : 0.1, metadata })) };
      record.vectorQueries.push({ options, result }); return result;
    } },
  };
  const original = await withPublicMetadata(notesIndex, async (origin) => { env.DATA_ORIGIN = origin; return evaluateCase(query, env, runtime); });
  return { runtime, recording, original, env };
}

test('replays actual production stages with no network and keeps recorded teacher metadata', async () => {
  const { recording, original } = await fixture();
  const report = await recordedRetrieval(golden, recording);
  assert.deepEqual(report.results[0].stages, scoreRetrieval(golden.queries, [original]).results[0].stages);
  assert.deepEqual(Object.keys(original.stages), ['dense', 'fts', 'merge', 'rerank', 'answerCandidates']);
  assert.deepEqual(original.stages.merge, [docs[1].url, docs[0].url, docs[2].url]);
  assert.equal(original.stages.rerank[0], docs[0].url);
  assert.equal(original.context.find((p) => p.url === docs[0].url).teacher, notesIndex[0].teacher);
  assert.equal(report.contexts[0].teacherCounts.bishop, 1);
  assert.equal(JSON.stringify(report).includes(text), false, 'numeric reports never contain source text');
  assert.equal(report.mode, 'recorded');
});

test('recorded candidate removal is seen by the regression gate', async () => {
  const { runtime, env, original } = await fixture();
  const changed = { ...runtime, answerCandidates: (q, sources, limit) => runtime.answerCandidates(q, sources.filter((p) => ![docs[0].url, docs[1].url].includes(p.url)), limit) };
  const degraded = await withPublicMetadata(notesIndex, async (origin) => { env.DATA_ORIGIN = origin; return evaluateCase(golden.queries[0], env, changed); });
  const failures = retrievalRegressions(scoreRetrieval(golden.queries, [original]), scoreRetrieval(golden.queries, [degraded]));
  assert.ok(failures.some((f) => f.stage === 'answerCandidates' && f.metric === 'recall@10'));
});

test('an unrecorded FTS/rerank/vector input cannot silently become a fallback score', async () => {
  const { recording } = await fixture();
  for (const field of ['ftsBatches', 'rerankScores', 'vectorQueries']) {
    const missing = structuredClone(recording); missing.records[0][field] = [];
    await assert.rejects(recordedRetrieval(golden, missing), /Recording is insufficient/);
  }
});

test('golden changes, missing queries, errors and model drift invalidate a capture', async () => {
  const { recording } = await fixture();
  const changed = structuredClone(golden); changed.queries[0].judgments[docs[0].url] = 1;
  await assert.rejects(recordedRetrieval(changed, recording), /fingerprint/);
  const missing = structuredClone(recording); missing.records = [];
  await assert.rejects(recordedRetrieval(golden, missing), /Incomplete/);
  const error = structuredClone(recording); error.records[0].error = 'preview request failed';
  await assert.rejects(recordedRetrieval(golden, error), /Invalid recording/);
  const wrongModel = structuredClone(recording); wrongModel.records[0].embeddingModel = 'not-the-captured-model';
  await assert.rejects(recordedRetrieval(golden, wrongModel), /Recording is insufficient/);
  const badTeacherMetadata = structuredClone(recording); badTeacherMetadata.metadata.notesIndex = {};
  await assert.rejects(recordedRetrieval(golden, badTeacherMetadata), /teacher metadata/);
});

test('uncontrolled network is blocked and all global state is restored', async () => {
  const previousFetch = globalThis.fetch, previousCaches = globalThis.caches;
  await assert.rejects(withPublicMetadata([], async () => {
    await fetch('https://example.invalid/').catch(() => {});
  }), /uncontrolled network/);
  assert.equal(globalThis.fetch, previousFetch); assert.equal(globalThis.caches, previousCaches);
});

test('request fingerprints ignore object property order, not parameters', () => {
  assert.equal(digest({ topK: 20, returnMetadata: 'all' }), digest({ returnMetadata: 'all', topK: 20 }));
  assert.notEqual(statementKey([{ sql: 'SELECT ?', params: ['preview'] }]), statementKey([{ sql: 'SELECT ?', params: ['different'] }]));
});

test('swallowed unsupported database calls and skipped recorded requests fail closed', async () => {
  const { runtime, recording } = await fixture();
  const bindings = replayBindings(recording.records[0], recording.metadata, runtime);
  assert.throws(() => bindings.env.DB.prepare('SELECT preview').first(), /Uncaptured D1/);
  assert.equal(bindings.errors.length, 1);
  const extra = structuredClone(recording);
  extra.records[0].ftsBatches.push({ key: 'unused-request', result: [] });
  await assert.rejects(recordedRetrieval(golden, extra), /recorded production request was skipped/);
});
