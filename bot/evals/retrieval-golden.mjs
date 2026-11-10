/** Validate before any network or scoring. A schema failure must not shrink denominators. */
export function validateGolden(golden, { minimum = 60 } = {}) {
  if (golden.version !== 1 || !['proposed, awaiting owner approval', 'owner-approved'].includes(golden.approval) || golden.relevanceUnit !== 'library-reference-url') throw new Error('Invalid golden-set version/approval/unit');
  if (!Array.isArray(golden.queries) || golden.queries.length < minimum || golden.queries.length > 100 || new Set(golden.queries.map((q) => q.id)).size !== golden.queries.length) throw new Error('Golden set needs 60–100 unique questions');
  for (const q of golden.queries) {
    if (!/^[a-z0-9-]+$/.test(q.id) || !/^[a-z0-9-]+$/.test(q.type) || typeof q.q !== 'string' || !q.q.trim() || !q.sourceQuestion || !['supported', 'gap', 'not-applicable'].includes(q.coverageLabel) || !q.judgments || Array.isArray(q.judgments)) throw new Error('Invalid question shape');
    if (['answer', 'answers', 'referenceAnswer', 'approved'].some((key) => key in q)) throw new Error('Golden set must contain no reference answers');
    if (q.history?.some((h) => h.role !== 'user' || typeof h.content !== 'string')) throw new Error('Use recorded reader question history only');
    const direct = Object.entries(q.judgments).filter(([, grade]) => grade === 2);
    if (q.coverageLabel === 'supported' && !direct.length || q.coverageLabel !== 'supported' && Object.keys(q.judgments).length) throw new Error('Coverage label and relevance disagree');
    for (const [url, grade] of Object.entries(q.judgments)) if (![1, 2].includes(grade) || !url.startsWith('/') || url.startsWith('//') || !golden.references?.[url]) throw new Error('Relevance needs an existing reference and grade 1/2');
    if (q.coverageLabel === 'supported' && (!q.supportGroups?.length || q.supportGroups.some((group) => !group.length || group.some((url) => q.judgments[url] !== 2)))) throw new Error('Invalid support groups');
  }
  return golden;
}
