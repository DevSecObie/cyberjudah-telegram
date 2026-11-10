import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankingMetrics, scoreRetrieval, retrievalRegressions, RETRIEVAL_STAGES } from '../evals/retrieval-metrics.mjs';

test('linear graded nDCG, recall cutoffs and reciprocal rank match hand calculations', () => {
  const m = rankingMetrics(['unjudged', 'related', 'direct'], { direct: 2, related: 1 });
  assert.equal(m['recall@5'], 1); assert.equal(m['recall@10'], 1); assert.equal(m['recall@20'], 1);
  assert.equal(m['MRR@10'], 0.5);
  assert.equal(m['nDCG@10'], (1 / Math.log2(3) + 2 / Math.log2(4)) / (2 + 1 / Math.log2(3)));
  const atEleven = rankingMetrics([...Array.from({ length: 10 }, (_, i) => `x${i}`), 'direct'], { direct: 2 });
  assert.equal(atEleven['recall@10'], 0); assert.equal(atEleven['recall@20'], 1); assert.equal(atEleven['MRR@10'], 0); assert.equal(atEleven['nDCG@10'], 0);
});

test('unretrieved relevant passages remain in the recall and ideal-DCG denominator', () => {
  const m = rankingMetrics(['direct'], { direct: 2, missing: 2 });
  assert.equal(m['recall@10'], 0.5);
  assert.equal(m['nDCG@10'], 2 / (2 + 2 / Math.log2(3)));
});

test('duplicate IDs, missing rankings and invalid grades fail instead of inflating metrics', () => {
  assert.throws(() => rankingMetrics(['a', 'a'], { a: 2 }), /unique/);
  assert.throws(() => rankingMetrics(undefined, { a: 2 }));
  for (const grade of [0, 3, NaN, '2']) assert.throws(() => rankingMetrics([], { a: grade }), /grades/);
});

const golden = [{ id: 'one', type: 'preview-a', judgments: { a: 2, b: 1 } }, { id: 'two', type: 'preview-b', judgments: { b: 2 } }, { id: 'gap', type: 'gap', judgments: {} }];
const result = (id, ranked) => ({ id, stages: Object.fromEntries(RETRIEVAL_STAGES.map((s) => [s, ranked])) });
const good = [result('one', ['a', 'b']), result('two', ['b']), result('gap', ['unjudged'])];

test('every stage and type is reported; gap cases never become perfect recall', () => {
  const report = scoreRetrieval(golden, good);
  assert.equal(report.queries, 3);
  for (const stage of RETRIEVAL_STAGES) {
    assert.equal(report.overall[stage].judgedQueries, 2); assert.equal(report.overall[stage].gapQueries, 1);
    assert.equal(report.overall[stage]['recall@10'], 1); assert.equal(report.byType.gap[stage]['nDCG@10'], null);
  }
});

test('missing queries/stages, capture errors and duplicate golden IDs fail closed', () => {
  assert.throws(() => scoreRetrieval(golden, good.slice(1)), /missing/);
  assert.throws(() => scoreRetrieval(golden, [...good.slice(0, 2), result('two', [])]), /Duplicate/);
  const missingStage = structuredClone(good); delete missingStage[0].stages.fts;
  assert.throws(() => scoreRetrieval(golden, missingStage));
  const error = structuredClone(good); error[0].error = 'fixture request failed';
  assert.throws(() => scoreRetrieval(golden, error), /Incomplete/);
  assert.throws(() => scoreRetrieval([golden[0], golden[0], golden[2]], good), /identity/);
});

test('gate catches per-type and per-stage drops even when the overall average improves', () => {
  const before = structuredClone(good); before[1].stages.dense = [];
  const after = structuredClone(good); after[0].stages.fts = ['b', 'a'];
  const failures = retrievalRegressions(scoreRetrieval(golden, before), scoreRetrieval(golden, after));
  assert.ok(failures.some((f) => f.type === 'preview-a' && f.stage === 'fts' && f.metric === 'nDCG@10'));
  assert.deepEqual(retrievalRegressions(scoreRetrieval(golden, good), scoreRetrieval(golden, good)), []);
});

test('gate refuses type/denominator changes and invalid thresholds', () => {
  const b = scoreRetrieval(golden, good), changed = structuredClone(b); changed.results[0].type = 'other';
  assert.throws(() => retrievalRegressions(b, changed), /identities/);
  const fewer = structuredClone(b); fewer.overall.dense.judgedQueries--;
  assert.throws(() => retrievalRegressions(b, fewer), /coverage/);
  for (const bad of [-1, NaN, '0']) assert.throws(() => retrievalRegressions(b, b, bad), /tolerance/);
});
