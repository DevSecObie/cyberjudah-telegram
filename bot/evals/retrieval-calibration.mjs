import { rankingMetrics } from './retrieval-metrics.mjs';
import { COVERAGE_THRESHOLDS } from '../src/grounding.mjs';

const rate = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
const mean = (rows, key) => { const values = rows.map((r) => r[key]).filter((v) => v !== null); return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; };

/** Label completeness is not assumed: these are errors relative to proposed support groups. */
export function coverageCalibration(golden, report, overlaps = [0.15, 0.25, 0.35, 0.5, 0.75, 1], cosines = [0.55, 0.6, 0.65, 0.68, 0.7, 0.75, 0.8, 0.9]) {
  const contexts = new Map(report.contexts.map((row) => [row.id, row]));
  if (contexts.size !== golden.queries.length || report.contexts.length !== contexts.size) throw new Error('Incomplete coverage contexts');
  const cases = golden.queries.filter((q) => q.coverageLabel !== 'not-applicable').map((q) => {
    const context = contexts.get(q.id);
    if (!context || typeof context.coverage?.enough !== 'boolean') throw new Error(`Missing coverage result: ${q.id}`);
    const groups = q.supportGroups;
    if (q.coverageLabel !== 'gap' && (!Array.isArray(groups) || !groups.length || groups.some((g) => !g.length || g.some((url) => q.judgments[url] !== 2)))) throw new Error(`Missing proposed support groups: ${q.id}`);
    const supported = q.coverageLabel !== 'gap' && groups.every((group) => group.some((url) => context.references.includes(url)));
    return { q, context, supported };
  });
  const score = (overlap, cosine) => {
    const rows = cases.map(({ q, context, supported }) => {
      const d = context.coverage;
      const numeric = ['retrieved-evidence', 'thin-retrieval'].includes(d.reason);
      if (numeric && (!Number.isFinite(d.usable) || !Number.isFinite(d.overlap) || (d.cosine !== null && !Number.isFinite(d.cosine)))) throw new Error(`Invalid coverage features: ${q.id}`);
      if (!numeric && !['small-talk', 'recorded-app-state', 'named-scripture', 'named-library-record'].includes(d.reason)) throw new Error(`Unrecognized coverage rule: ${d.reason}`);
      const numericDecision = (o, c) => d.usable > 0 && (d.overlap >= o || (d.cosine !== null && d.cosine >= c));
      if (numeric && numericDecision(COVERAGE_THRESHOLDS.overlap, COVERAGE_THRESHOLDS.cosine) !== d.enough) throw new Error('Calibration no longer reproduces production coverage');
      const enough = numeric ? numericDecision(overlap, cosine) : d.enough;
      return { type: q.type, supported, librarySupported: q.coverageLabel === 'supported', enough, falseGap: supported && !enough, falseCoverage: q.coverageLabel === 'gap' && enough, unsupportedContextAccepted: !supported && enough };
    });
    const aggregate = (part) => ({ falseGap: rate(part.filter((r) => r.falseGap).length, part.filter((r) => r.supported).length), falseCoverage: rate(part.filter((r) => r.falseCoverage).length, part.filter((r) => !r.librarySupported).length),
      unsupportedContextAccepted: rate(part.filter((r) => r.unsupportedContextAccepted).length, part.filter((r) => !r.supported).length),
      retrievalMisses: part.filter((r) => r.librarySupported && !r.supported).length,
      endToEndFalseGap: rate(part.filter((r) => r.librarySupported && !r.enough).length, part.filter((r) => r.librarySupported).length),
      endToEndFalseCoverage: rate(part.filter((r) => !r.librarySupported && r.enough).length, part.filter((r) => !r.librarySupported).length) });
    return { overlap, cosine, ...aggregate(rows), byType: Object.fromEntries([...new Set(rows.map((r) => r.type))].sort().map((type) => [type, aggregate(rows.filter((r) => r.type === type))])) };
  };
  const current = score(COVERAGE_THRESHOLDS.overlap, COVERAGE_THRESHOLDS.cosine);
  const grid = overlaps.flatMap((o) => cosines.map((c) => {
    if (![o, c].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Invalid calibration threshold');
    return score(o, c);
  }));
  // No unapproved weighting of coverage errors: only recommend a strict Pareto improvement.
  const improvements = grid.filter((r) => [r.falseGap.rate, r.falseCoverage.rate, current.falseGap.rate, current.falseCoverage.rate].every((v) => v !== null) && r.falseGap.rate <= current.falseGap.rate && r.falseCoverage.rate <= current.falseCoverage.rate && r.unsupportedContextAccepted.rate <= current.unsupportedContextAccepted.rate && (r.falseGap.rate < current.falseGap.rate || r.falseCoverage.rate < current.falseCoverage.rate) && Object.keys(current.byType).every((type) => ['falseGap', 'falseCoverage', 'unsupportedContextAccepted'].every((key) => current.byType[type][key].rate === null || r.byType[type][key].rate <= current.byType[type][key].rate)));
  improvements.sort((a, b) => Math.abs(a.overlap - current.overlap) + Math.abs(a.cosine - current.cosine) - Math.abs(b.overlap - current.overlap) - Math.abs(b.cosine - current.cosine));
  return { approval: golden.approval, oracle: 'proposed reference support groups, incomplete judgments', cases: cases.length, current, grid,
    recommendation: { overlap: improvements[0]?.overlap ?? current.overlap, cosine: improvements[0]?.cosine ?? current.cosine, scope: 'initial ask/askStream retrieval; native named-verse assembly is not measured', status: 'provisional; owner must approve labels and acceptable error rates before enforcement', reason: improvements.length ? 'Pareto improvement overall and no per-type regression; closest pair to current thresholds' : 'No measured strict Pareto improvement; retain current thresholds pending owner review' } };
}

/** Candidate-score curve, not the hydrated semantic endpoint's end-to-end recall. */
export function semanticCalibration(golden, recording, thresholds = [0, 0.45, 0.5, 0.55, 0.6, 0.65, 0.68, 0.7, 0.75, 0.8]) {
  const records = new Map(recording.records.map((r) => [r.id, r]));
  return { current: 0.55, scope: 'frozen top-50 vector candidate URLs before hydration; unjudged is not proven irrelevant', curve: thresholds.map((threshold) => {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Invalid semantic threshold');
    const rows = golden.queries.map((query) => {
      const probe = records.get(query.id)?.semanticProbe;
      if (!Array.isArray(probe)) throw new Error(`Missing top-50 semantic probe: ${query.id}`);
      const unique = [...new Map([...probe].sort((a, b) => b.score - a.score).filter((r) => {
        if (typeof r.reference !== 'string' || !Number.isFinite(r.score)) throw new Error('Invalid semantic probe');
        return r.score >= threshold;
      }).map((r) => [r.reference, r])).values()];
      return { ...rankingMetrics(unique.map((r) => r.reference), query.judgments), candidates: unique.length, related: unique.filter((r) => query.judgments[r.reference] === 1).length, direct: unique.filter((r) => query.judgments[r.reference] === 2).length, unjudged: unique.filter((r) => !query.judgments[r.reference]).length };
    });
    return { threshold, queries: rows.length, judgedQueries: rows.filter((r) => r['recall@10'] !== null).length, recall10: mean(rows, 'recall@10'), nDCG10: mean(rows, 'nDCG@10'), candidates: rows.reduce((n, r) => n + r.candidates, 0), direct: rows.reduce((n, r) => n + r.direct, 0), related: rows.reduce((n, r) => n + r.related, 0), unjudged: rows.reduce((n, r) => n + r.unjudged, 0) };
  }) };
}
