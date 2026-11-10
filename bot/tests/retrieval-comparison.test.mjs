import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeAfter, teacherLiftSweep, validateComparisonInputs } from '../evals/retrieval-comparison.mjs';
import { scoreRetrieval } from '../evals/retrieval-metrics.mjs';
import { boundedCloudflare, captureRetrieval } from '../evals/retrieval-capture.mjs';
import { recordedRetrieval, retrievalRuntime } from '../evals/retrieval-replay.mjs';

test('before/after table preserves all stages, type denominators and metric deltas', () => {
  const queries = [{ id: 'preview', type: 'preview', judgments: { '/a': 2, '/b': 1 } }];
  const report = (ranking) => ({ goldenSha256: 'preview', ...scoreRetrieval(queries, [{ id: 'preview', stages: Object.fromEntries(['dense', 'fts', 'merge', 'rerank', 'answerCandidates'].map((stage) => [stage, ranking])) }]) });
  const rows = beforeAfter(report(['/b', '/a']), report(['/a', '/b']));
  assert.equal(rows.length, 10);
  assert.equal(rows[0].metrics['recall@10'].delta, 0);
  assert.ok(rows[0].metrics['nDCG@10'].delta > 0);
  assert.throws(() => beforeAfter(report(['/a']), { ...report(['/a']), goldenSha256: 'changed' }), /same golden/);
});

const runtime = await retrievalRuntime();
test('actual v2 pools replay query parts and RANKED scores; D6 sweep restores the runtime', { skip: !runtime.RANKED }, async () => {
  const golden = JSON.parse(await readFile(new URL('../evals/retrieval-golden.json', import.meta.url), 'utf8'));
  const preview = 'Preview test (not an answer). Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.';
  const documents = [0, 1].map((n) => ({ id: `preview-${n}`, score: n ? 0.8 : 0.2, metadata: { kind: 'study', title: `Preview ${n} test (not an answer)`, url: `/study/preview/${n + 1}`, text: preview } }));
  const notes = documents.map((d, n) => ({ url: d.metadata.url, teacher: `${n ? 'Deacon' : 'Bishop'} Preview test (not an answer)` }));
  const api = () => boundedCloudflare({ account: 'a'.repeat(32), token: 'preview-test-credential', fetch: async (url, options) => {
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    let result;
    if (path.endsWith('/d1/database')) result = [{ name: 'preview-staging', uuid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }];
    else if (path.includes('/d1/')) result = body.batch.map(({ sql, params }) => ({ success: true, results: sql === 'SELECT count(*) AS n FROM search_docs' ? [{ n: 1000 }] : sql.startsWith('SELECT DISTINCT url') ? params.map((url) => ({ url })) : [] }));
    else if (path.endsWith('/bge-m3')) result = { data: body.text.map((_, n) => Array(1024).fill(n)) };
    else if (path.endsWith('/bge-reranker-base')) result = { response: body.contexts.map((_, id) => ({ id, score: id ? 0.3 : 0.9 })) };
    else if (path.includes('/vectorize/')) result = { matches: documents };
    else throw new Error('Unexpected fixture endpoint');
    return Response.json({ success: true, result });
  } });
  const initialLift = { ...runtime.TEACHER_LIFT }, log = console.log;
  console.log = () => {}; // v2 emits only numeric telemetry; keep the fixture output compact.
  try {
    const target = { databaseName: 'preview-staging', index: 'preview-staging' };
    const v1 = await captureRetrieval(golden, target, api(), notes, { runtime, ranking: 'v1' });
    const v2 = await captureRetrieval(golden, target, api(), notes, { runtime, ranking: 'v2' });
    validateComparisonInputs(v1, v2);
    const drift = structuredClone(v2); drift.provenance.corpus.searchRows++;
    assert.throws(() => validateComparisonInputs(v1, drift), /provenance differs/);
    assert.ok(v2.records.some((r) => r.embeddingQueries.length > 1));
    assert.ok(v2.records.every((r) => r.vectorQueries.every((entry) => r.embeddingQueries.includes(entry.query))));
    const before = await recordedRetrieval(golden, v1, { runtime }), after = await recordedRetrieval(golden, v2, { runtime });
    assert.equal(beforeAfter(before, after).length, 55);
    const sweep = await teacherLiftSweep(golden, v2, runtime, [{ bishop: 0, deacon: 0 }, { bishop: 0.02, deacon: 0.01 }, { bishop: 0.06, deacon: 0.04 }]);
    assert.equal(sweep.rows[0].a6Eligible, false);
    assert.ok(sweep.rows.slice(1).every((r) => r.a6Eligible));
    assert.ok(sweep.teacherCoverage.bishop > 0 && sweep.teacherCoverage.deacon > 0);
    assert.equal(sweep.recommendation, null, 'no quality gain means no proposed production change');
    assert.equal(sweep.retainCurrent, true);
    assert.deepEqual(runtime.TEACHER_LIFT, initialLift);
    const incomplete = structuredClone(v2); incomplete.records[0].embeddingQueries = [];
    await assert.rejects(recordedRetrieval(golden, incomplete, { runtime }), /insufficient/);
    await assert.rejects(recordedRetrieval(golden, v2, { runtime, teacherLift: { bishop: 0.01, other: 0.02 } }), /Unknown teacher-lift/);
  } finally { console.log = log; Object.assign(runtime.TEACHER_LIFT, initialLift); }
});
