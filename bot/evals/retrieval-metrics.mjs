// TREC/BEIR conventions: positive grades are relevant; nDCG uses linear qrel gains.
// https://github.com/usnistgov/trec_eval/blob/main/m_ndcg_cut.c
// https://github.com/beir-cellar/beir/blob/main/beir/retrieval/custom_metrics.py
export const RETRIEVAL_STAGES = Object.freeze(['dense', 'fts', 'merge', 'rerank', 'answerCandidates']);
export const RETRIEVAL_METRICS = Object.freeze(['recall@5', 'recall@10', 'recall@20', 'MRR@10', 'nDCG@10']);

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const nonempty = (value) => typeof value === 'string' && value.length > 0;

/** Exact passage IDs, never answer text. Duplicate results cannot inflate relevance. */
export function rankingMetrics(ranked, judgments) {
  if (!Array.isArray(ranked) || !ranked.every(nonempty) || new Set(ranked).size !== ranked.length) throw new Error('Ranked passage IDs must be unique nonempty strings');
  if (!judgments || typeof judgments !== 'object' || Array.isArray(judgments)) throw new Error('Missing relevance judgments');
  const qrels = new Map(Object.entries(judgments));
  for (const [id, grade] of qrels) if (!nonempty(id) || ![1, 2].includes(grade)) throw new Error('Relevance grades must be 1 or 2');
  // Gap cases have no positive denominator. Report them separately, never as perfect recall.
  if (!qrels.size) return Object.fromEntries(RETRIEVAL_METRICS.map((key) => [key, null]));
  const metrics = {};
  for (const k of [5, 10, 20]) metrics[`recall@${k}`] = ranked.slice(0, k).filter((id) => qrels.has(id)).length / qrels.size;
  const first = ranked.slice(0, 10).findIndex((id) => qrels.has(id));
  metrics['MRR@10'] = first < 0 ? 0 : 1 / (first + 1);
  const dcg = (gains) => gains.slice(0, 10).reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  const ideal = dcg([...qrels.values()].sort((a, b) => b - a));
  metrics['nDCG@10'] = dcg(ranked.map((id) => qrels.get(id) ?? 0)) / ideal;
  return metrics;
}

function aggregate(rows) {
  const result = {};
  for (const stage of RETRIEVAL_STAGES) {
    const measured = rows.filter((row) => row.stages[stage]['recall@10'] !== null);
    result[stage] = { queries: rows.length, judgedQueries: measured.length, gapQueries: rows.length - measured.length };
    for (const metric of RETRIEVAL_METRICS) result[stage][metric] = measured.length
      ? measured.reduce((sum, row) => sum + row.stages[stage][metric], 0) / measured.length : null;
  }
  return result;
}

/** Every golden query must have every stage: failed/skipped captures are not dropped. */
export function scoreRetrieval(golden, results) {
  if (!Array.isArray(golden) || !golden.length || !Array.isArray(results)) throw new Error('A complete golden set and results are required');
  const byId = new Map(results.map((row) => [row?.id, row]));
  if (byId.size !== results.length || results.length !== golden.length) throw new Error('Duplicate, missing or extra query results');
  const seen = new Set();
  const rows = golden.map((query) => {
    if (!nonempty(query.id) || seen.has(query.id) || !nonempty(query.type)) throw new Error('Invalid golden query identity/type');
    seen.add(query.id);
    const result = byId.get(query.id);
    if (!result || result.error) throw new Error(`Incomplete retrieval capture: ${query.id}`);
    const stages = Object.fromEntries(RETRIEVAL_STAGES.map((stage) => [stage, rankingMetrics(result.stages?.[stage], query.judgments)]));
    return { id: query.id, type: query.type, stages };
  });
  return { queries: rows.length, overall: aggregate(rows), byType: Object.fromEntries([...new Set(rows.map((row) => row.type))].sort().map((type) => [type, aggregate(rows.filter((row) => row.type === type))])), results: rows };
}

/** A baseline cannot silently lose a type, stage or judged query to improve its averages. */
export function retrievalRegressions(baseline, current, tolerance = 0) {
  if (!finite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error('Invalid regression tolerance');
  if (JSON.stringify(baseline.results.map(({ id, type }) => [id, type]).sort()) !== JSON.stringify(current.results.map(({ id, type }) => [id, type]).sort())) throw new Error('Golden query identities/types changed');
  const failures = [];
  for (const [name, before, after] of [['overall', baseline.overall, current.overall], ...Object.keys(baseline.byType).sort().map((type) => [type, baseline.byType[type], current.byType[type]])]) {
    if (!after) throw new Error(`Missing query type: ${name}`);
    for (const stage of RETRIEVAL_STAGES) {
      const b = before[stage], c = after[stage];
      if (!b || !c || b.queries !== c.queries || b.judgedQueries !== c.judgedQueries || b.gapQueries !== c.gapQueries) throw new Error(`Evaluation coverage changed: ${name}/${stage}`);
      for (const metric of ['recall@10', 'nDCG@10']) {
        if (b[metric] === null && c[metric] === null) continue;
        if (!finite(b[metric]) || !finite(c[metric])) throw new Error(`Invalid metric: ${name}/${stage}/${metric}`);
        const delta = c[metric] - b[metric];
        if (delta < -tolerance - 1e-12) failures.push({ type: name, stage, metric, baseline: b[metric], current: c[metric], delta });
      }
    }
  }
  return failures;
}
