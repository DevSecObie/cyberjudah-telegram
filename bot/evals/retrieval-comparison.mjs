import { digest, recordedRetrieval } from './retrieval-replay.mjs';
import { RETRIEVAL_STAGES, RETRIEVAL_METRICS } from './retrieval-metrics.mjs';

export function validateComparisonInputs(v1, v2) {
  if (v1.ranking !== 'v1' || v2.ranking !== 'v2' || v1.goldenSha256 !== v2.goldenSha256) throw new Error('Comparison needs v1/v2 on the same golden set');
  for (const recording of [v1, v2]) {
    const p = recording.provenance;
    if (!p || !p.databaseName || !p.vectorIndex || !/^[a-f0-9]{64}$/.test(p.runtimeSha256 ?? '') || !Array.isArray(recording.metadata?.notesIndex) || p.notesIndexRows !== recording.metadata.notesIndex.length || p.notesIndexSha256 !== digest(recording.metadata.notesIndex) || !/^[a-f0-9]{64}$/.test(p.corpus?.verifiedReferenceSetSha256 ?? '') || !Number.isSafeInteger(p.corpus.searchRows) || p.corpus.searchRows < 1) throw new Error('Incomplete comparison provenance');
  }
  for (const key of ['databaseName', 'vectorIndex', 'notesIndexSha256', 'notesIndexRows', 'runtimeSha256', 'corpus']) if (digest(v1.provenance[key]) !== digest(v2.provenance[key])) throw new Error(`Comparison provenance differs: ${key}`);
  if (digest(v1.metadata) !== digest(v2.metadata)) throw new Error('Comparison metadata/source policy differs');
}

export function beforeAfter(before, after) {
  if (before.goldenSha256 !== after.goldenSha256 || before.queries !== after.queries) throw new Error('Comparison requires the same golden set');
  return ['overall', ...Object.keys(before.byType).sort()].flatMap((type) => RETRIEVAL_STAGES.map((stage) => {
    const a = (type === 'overall' ? before.overall : before.byType[type])[stage];
    const b = (type === 'overall' ? after.overall : after.byType[type])?.[stage];
    if (!b || a.queries !== b.queries || a.judgedQueries !== b.judgedQueries) throw new Error('Comparison denominators changed');
    return { type, stage, queries: a.queries, judgedQueries: a.judgedQueries, metrics: Object.fromEntries(RETRIEVAL_METRICS.map((metric) => [metric, { before: a[metric], after: b[metric], delta: a[metric] === null || b[metric] === null ? null : b[metric] - a[metric] }])) };
  }));
}

/** Sweep actual v2 answerCandidates in the bundled runtime; do not duplicate its ranking. */
export async function teacherLiftSweep(golden, recording, runtime, pairs = [
  { bishop: 0, deacon: 0 },
  ...[0.01, 0.02, 0.04, 0.06, 0.075].flatMap((bishop) => [0.005, 0.01, 0.02, 0.04].filter((deacon) => deacon <= bishop).map((deacon) => ({ bishop, deacon }))),
]) {
  if (recording.ranking !== 'v2' || !runtime.TEACHER_LIFT || !runtime.RANKED || !(runtime.OVERLAP_LIFT > 0)) throw new Error('D6 sweep requires the actual v2 runtime and recording');
  const current = { ...runtime.TEACHER_LIFT };
  const base = await recordedRetrieval(golden, recording, { runtime });
  const rows = [];
  let observedOrderChange = false;
  let zeroOrder;
  for (const pair of pairs) {
    if (![pair.bishop, pair.deacon].every((n) => Number.isFinite(n) && n >= 0)) throw new Error('Invalid teacher lift');
    const report = await recordedRetrieval(golden, recording, { runtime, teacherLift: pair });
    const order = JSON.stringify(report.contexts.map((c) => [c.id, c.references]));
    if (pair.bishop === 0 && pair.deacon === 0) zeroOrder = order;
    else if (zeroOrder !== undefined && order !== zeroOrder) observedOrderChange = true;
    rows.push({ ...pair, a6Eligible: pair.deacon > 0 && pair.bishop >= pair.deacon && pair.bishop < runtime.OVERLAP_LIFT, metrics: report.overall.answerCandidates, byType: Object.fromEntries(Object.entries(report.byType).map(([type, stages]) => [type, stages.answerCandidates])) });
  }
  const eligible = rows.filter((r) => r.a6Eligible && r.metrics['nDCG@10'] !== null);
  eligible.sort((a, b) => b.metrics['nDCG@10'] - a.metrics['nDCG@10'] || Math.abs(a.bishop - current.bishop) + Math.abs(a.deacon - current.deacon) - Math.abs(b.bishop - current.bishop) - Math.abs(b.deacon - current.deacon));
  const teacherCoverage = base.contexts.reduce((totals, c) => { for (const key of Object.keys(totals)) totals[key] += c.teacherCounts[key]; return totals; }, { bishop: 0, deacon: 0, otherRecorded: 0, unnamed: 0 });
  const improves = eligible.length && eligible[0].metrics['nDCG@10'] > base.overall.answerCandidates['nDCG@10'] + 1e-12;
  return { approval: golden.approval, current, rows, teacherCoverage, observedOrderChange, a6Rule: 'Positive Bishop/Deacon lift, Bishop >= Deacon, each smaller than one topic-word lift; a better topic match can outweigh it',
    recommendation: improves && observedOrderChange && teacherCoverage.bishop && teacherCoverage.deacon ? { bishop: eligible[0].bishop, deacon: eligible[0].deacon, nDCG10: eligible[0].metrics['nDCG@10'], status: 'proposed; incomplete judgments and sample size require owner review' } : null,
    retainCurrent: !improves || !observedOrderChange,
    limitation: 'Best measured nDCG on proposed qrels, not a confidence bound or proof of doctrine. Zero-lift row is a diagnostic control, not an A6 recommendation.' };
}
