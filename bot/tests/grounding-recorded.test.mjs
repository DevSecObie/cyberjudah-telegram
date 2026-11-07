import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateRecordedAnswer, evaluateRecordedSuite } from '../evals/grounding-eval.mjs';
import { coverageDecision } from '../src/grounding.mjs';

const fixture = JSON.parse(readFileSync(new URL('../evals/grounding-recorded.json', import.meta.url), 'utf8'));

test('50 public recorded questions replay without network/inference and report claim alignment and uncited rates', t => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Recorded eval must be offline'); };
  t.after(() => { globalThis.fetch = fetchBefore; });
  assert.equal(fixture.cases.length, 50);
  assert.match(fixture.provenance.sha256, /^[a-f0-9]{64}$/);
  const report = evaluateRecordedSuite(fixture.cases);
  assert.equal(report.passed, 50, JSON.stringify(report.results.filter(result => !result.ok)));
  assert.equal(report.alignmentRate, 1);
  assert.equal(report.uncitedClaimRate, 0);
  assert.equal(report.answersWithUncitedClaims, 0);
});

for (const record of fixture.cases.filter(record => record.claims.length)) {
  test(`${record.id}: a valid but wrong source fails alignment, and removing the citation raises the uncited rate`, () => {
    const cited = record.claims[0].support[0].n;
    const wrong = record.retrieval.find(source => source.n !== cited).n;
    const bad = evaluateRecordedAnswer(record, record.answer.replace(`[${cited}]`, `[${wrong}]`));
    assert.equal(bad.ok, false);
    assert.equal(bad.unsupported, 1, 'existence of the other citation does not prove support');
    const missing = evaluateRecordedAnswer(record, record.answer.replace(`[${cited}]`, ''));
    assert.equal(missing.ok, false);
    assert.equal(missing.uncited, 1);
  });
}

test('uncited or cited unreviewed additions are counted, not hidden by annotated claims', () => {
  const record = fixture.cases[0];
  const missing = evaluateRecordedAnswer(record, `${record.answer}\n\nAn additional unsupported assertion.`);
  assert.equal(missing.unknown, 1);
  assert.equal(missing.uncited, 1);
  const cited = evaluateRecordedAnswer(record, `${record.answer}\n\nAn additional unsupported assertion. [1]`);
  assert.equal(cited.unknown, 1);
  assert.equal(cited.ok, false);
});

test('coverage admits named short Scripture and rejects empty/unrelated data without a model call', () => {
  const short = fixture.cases.find(record => record.question.includes('John 11:35'));
  assert.equal(coverageDecision(short.question, short.retrieval).enough, true);
  assert.equal(coverageDecision('What is the library recommendation for a spacecraft engine?', fixture.cases[0].retrieval).enough, false);
  assert.equal(coverageDecision('What is the law of inheritance?', []).enough, false);
  assert.equal(coverageDecision('Shalom!', []).enough, true);
});
