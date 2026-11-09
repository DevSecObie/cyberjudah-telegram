/** Offline replay against explicit claim/evidence annotations, never an LLM judge. */
const citation = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const normalize = text => String(text).replace(/^\s*>\s?/gm, '').replace(/\s+/g, ' ').trim();
const numbers = text => [...text.matchAll(citation)].flatMap(match => match[1].split(/\s*,\s*/).map(Number));

export function evaluateRecordedAnswer(record, answer = record.answer) {
  const sources = new Map(record.retrieval.map(source => [source.n, source]));
  const failures = [];
  let aligned = 0, uncited = 0, unsupported = 0, unknown = 0;
  if (record.non_claim && answer === record.answer) return { id: record.id, ok: true, claims: 0, aligned: 0, uncited: 0, unsupported: 0, unknown: 0, failures: [] };
  let remaining = normalize(answer);
  for (const claim of record.claims) {
    const text = normalize(claim.text);
    const at = remaining.indexOf(text);
    if (at < 0) { failures.push('expected-claim-missing'); continue; }
    // The citation must be attached to this claim, before another sentence or paragraph.
    const after = remaining.slice(at + text.length);
    const attached = /^(?:\s*\[\d+(?:\s*,\s*\d+)*\])+/.exec(after)?.[0] ?? '';
    const cited = [...new Set(numbers(attached))];
    const supports = new Set();
    for (const support of claim.support) {
      const source = sources.get(support.n);
      // Extractive annotations are mechanically checkable: both the claim and exact evidence
      // must exist in the recorded source. Paraphrases need separately reviewed annotations.
      if (!source || !source.text.includes(support.quote) || normalize(support.quote) !== text) failures.push('invalid-recorded-evidence');
      else supports.add(support.n);
    }
    if (!cited.length) { uncited++; failures.push('uncited-claim'); }
    else if (cited.some(n => !supports.has(n))) { unsupported++; failures.push('citation-does-not-support-claim'); }
    else aligned++;
    remaining = `${remaining.slice(0, at)} ${after.slice(attached.length)}`;
  }
  const residual = normalize(remaining.replace(citation, '').replace(/[*_#>]/g, ''));
  if (residual) {
    // Unknown prose must not silently disappear from the denominator. It is unreviewed,
    // and an uncited addition also contributes to the uncited-claim rate.
    unknown++;
    if (!numbers(remaining).length) uncited++;
    failures.push('unreviewed-claim');
  }
  const claims = aligned + unsupported + uncited + (unknown && numbers(remaining).length ? unknown : 0);
  return { id: record.id, ok: failures.length === 0, claims, aligned, uncited, unsupported, unknown, failures: [...new Set(failures)] };
}

export function evaluateRecordedSuite(records) {
  const results = records.map(record => evaluateRecordedAnswer(record));
  const claims = results.reduce((sum, result) => sum + result.claims, 0);
  const aligned = results.reduce((sum, result) => sum + result.aligned, 0);
  const uncited = results.reduce((sum, result) => sum + result.uncited, 0);
  return {
    cases: results.length, passed: results.filter(result => result.ok).length,
    claims, alignmentRate: claims ? aligned / claims : 1, uncitedClaimRate: claims ? uncited / claims : 0,
    answersWithUncitedClaims: results.filter(result => result.uncited > 0).length,
    results,
  };
}

/** Explicit extractive requirements per subquestion, not answer length or citation existence. */
export function evaluateRecordedCompleteness(record, answer = record.answer) {
  const grounding = evaluateRecordedAnswer(record, answer);
  const assigned = new Set(record.parts.flatMap(part => part.claims));
  if (!record.parts.length || assigned.size !== record.claims.length || [...assigned].some(i => !Number.isInteger(i) || i < 0 || i >= record.claims.length) || record.parts.some(part => !part.claims.length)) throw new Error('Every recorded claim must belong to an explicit part');
  const parts = record.parts.map(part => {
    const claims = part.claims.map(i => record.claims[i]);
    const present = claims.filter(claim => normalize(answer).includes(normalize(claim.text))).length;
    const evidence = evaluateRecordedAnswer({ ...record, claims }, answer);
    const status = evidence.aligned === claims.length && !evidence.failures.includes('invalid-recorded-evidence') ? 'covered' : present ? 'partial' : 'missing';
    return { id: part.id, status };
  });
  const covered = parts.filter(part => part.status === 'covered').length;
  return { id: record.id, complete: grounding.ok && covered === parts.length, coverage: covered / parts.length, parts, grounding };
}

/** Deterministic multipart replays of the existing public extracts; no generated teaching. */
export function multipartRecords(records) {
  const eligible = records.filter(record => record.claims.length && !record.non_claim);
  const out = [];
  for (let i = 0; i + 1 < eligible.length; i += 2) {
    const pair = eligible.slice(i, i + 2), retrieval = [], claims = [], parts = [], answers = [];
    for (const record of pair) {
      const remap = new Map(record.retrieval.map(source => [source.n, retrieval.length + record.retrieval.indexOf(source) + 1]));
      retrieval.push(...record.retrieval.map(source => ({ ...source, n: remap.get(source.n) })));
      parts.push({ id: `p${parts.length + 1}`, claims: record.claims.map((_, index) => claims.length + index) });
      claims.push(...record.claims.map(claim => ({ ...claim, support: claim.support.map(support => ({ ...support, n: remap.get(support.n) })) })));
      answers.push(record.answer.replace(citation, (_, ns) => `[${ns.split(/\s*,\s*/).map(n => remap.get(Number(n))).join(',')}]`));
    }
    out.push({ id: `multipart-${i / 2 + 1}`, question: pair.map(record => record.question).join(' '), retrieval, claims, parts, answer: answers.join('\n\n') });
  }
  return out;
}
