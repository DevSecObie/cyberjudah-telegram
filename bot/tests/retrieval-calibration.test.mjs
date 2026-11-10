import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageCalibration, semanticCalibration } from '../evals/retrieval-calibration.mjs';

const golden = { approval: 'proposed, awaiting owner approval', queries: [
  { id: 'support', type: 'preview', judgments: { '/a': 2 }, coverageLabel: 'supported', supportGroups: [['/a']] },
  { id: 'miss', type: 'preview', judgments: { '/b': 2 }, coverageLabel: 'supported', supportGroups: [['/b']] },
  { id: 'gap', type: 'gap', judgments: {}, coverageLabel: 'gap' },
  { id: 'hello', type: 'small-talk', judgments: {}, coverageLabel: 'not-applicable' },
] };
const report = { contexts: [
  { id: 'support', references: ['/a'], coverage: { enough: false, reason: 'thin-retrieval', usable: 1, overlap: 0.2, cosine: 0.6 } },
  { id: 'miss', references: ['/unjudged'], coverage: { enough: true, reason: 'retrieved-evidence', usable: 1, overlap: 0.3, cosine: null } },
  { id: 'gap', references: ['/unjudged'], coverage: { enough: true, reason: 'retrieved-evidence', usable: 1, overlap: 0.4, cosine: null } },
  { id: 'hello', references: [], coverage: { enough: true, reason: 'small-talk', usable: 0 } },
] };

test('coverage rates use the context actually selected, preserve denominators and skip small talk', () => {
  const score = coverageCalibration(golden, report, [0.15, 0.25, 0.5], [0.6, 0.68]);
  assert.equal(score.cases, 3);
  assert.deepEqual(score.current.falseGap, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(score.current.falseCoverage, { numerator: 1, denominator: 1, rate: 1 });
  assert.deepEqual(score.current.unsupportedContextAccepted, { numerator: 2, denominator: 2, rate: 1 });
  assert.deepEqual([score.recommendation.overlap, score.recommendation.cosine], [0.25, 0.6]);
  assert.equal(score.grid.find((r) => r.overlap === 0.5 && r.cosine === 0.6).falseCoverage.rate, 0);
});

test('coverage calibration preserves named-reference bypasses and multi-part support groups', () => {
  const next = structuredClone(report); next.contexts[0].coverage = { enough: true, reason: 'named-scripture', usable: 1 };
  assert.equal(coverageCalibration(golden, next, [1], [1]).grid[0].falseGap.rate, 0);
  const multi = structuredClone(golden); multi.queries[0].judgments['/c'] = 2; multi.queries[0].supportGroups.push(['/c']);
  assert.equal(coverageCalibration(multi, report).current.falseGap.denominator, 0);
  assert.equal(coverageCalibration(multi, report).current.falseGap.rate, null);
  assert.throws(() => coverageCalibration(golden, { contexts: report.contexts.slice(1) }), /Incomplete/);
  const bad = structuredClone(report); bad.contexts[0].coverage.cosine = '0.6';
  assert.throws(() => coverageCalibration(golden, bad), /Invalid coverage/);
});

test('semantic curve reports missing positives and unjudged pools without inventing negatives', () => {
  const recording = { records: golden.queries.map((q) => ({ id: q.id, semanticProbe: q.id === 'support' ? [{ reference: '/a', score: 0.55 }, { reference: '/unknown', score: 0.6 }] : [] })) };
  const { curve } = semanticCalibration(golden, recording, [0.55, 0.6]);
  assert.equal(curve[0].recall10, 0.5); assert.equal(curve[1].recall10, 0);
  assert.equal(curve[0].direct, 1); assert.equal(curve[1].unjudged, 1);
  assert.equal(curve[0].judgedQueries, 2);
  delete recording.records[0].semanticProbe;
  assert.throws(() => semanticCalibration(golden, recording), /Missing top-50/);
});

test('a provisional coverage improvement cannot accept more unjudged contexts', () => {
  const next = structuredClone(report);
  next.contexts[1].coverage = { enough: false, reason: 'thin-retrieval', usable: 1, overlap: 0.1, cosine: 0.6 };
  const score = coverageCalibration(golden, next, [0.25], [0.6]);
  assert.equal(score.grid[0].falseGap.rate, 0);
  assert.ok(score.grid[0].unsupportedContextAccepted.rate > score.current.unsupportedContextAccepted.rate);
  assert.deepEqual([score.recommendation.overlap, score.recommendation.cosine], [0.25, 0.68]);
});
