import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-study-ui.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-study-ui.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
// Match Workers' startup restriction: importing the route must not mint an ID.
const originalUUID = globalThis.crypto.randomUUID;
globalThis.crypto.randomUUID = () => { throw new Error('random UUID outside a request'); };
let study;
try { study = await import(out); } finally { globalThis.crypto.randomUUID = originalUUID; }
const { validateStudyProgram, APP_TEACHING_POLICY, getAppStudyPrompt, getAppStudyLibrary, evidenceOf, NO_TEACHING, studyProgramDiagnostics } = study;
test('OpenUI initializes lazily and reuses its request-created library', () => {
  assert.equal(getAppStudyLibrary(), getAppStudyLibrary());
  assert.equal(getAppStudyPrompt(), getAppStudyPrompt());
});
const sources = [
  { n: 1, kind: 'spoken', evidence: 'teaching', title: 'A recorded lesson', url: '/classes/a', text: 'The teacher read Romans 3:31 in this lesson.' },
  { n: 2, kind: 'dictionary', evidence: 'reference', title: 'A reference entry', url: '/dictionary/en/isbe/1/a', text: 'Historical reference material.' },
];
test('native policy supports teachers and explicitly rejects unsupported doctrine and model memory', () => {
  for (const rule of ['not an independent teacher', 'Do not complete gaps from model memory', 'reference entry is not a teacher', 'not decide doctrine yourself']) assert.ok(APP_TEACHING_POLICY.includes(rule));
  assert.ok(!APP_TEACHING_POLICY.includes('draw the whole conclusion yourself'));
  for (const name of ['Teaching', 'Context', 'Sources', 'RelatedScriptures', 'Explore', 'FollowUp']) assert.ok(getAppStudyPrompt().includes(name));
});
test('generative composition preserves source IDs, creates source previews and bounds related scriptures to evidence', () => {
  const result = validateStudyProgram('root = StudyAnswer([Teaching("The recorded explanation.", [1]), Context("Historical detail. [2]", [2]), RelatedScriptures(["Romans 3:31", "Genesis 99:1"]), Explore("people"), FollowUp("What did the lesson say next?")])', sources);
  assert.ok(result.teachingFound);
  assert.deepEqual(result.sources.map(s => s.n), [1, 2]);
  assert.match(result.program, /Sources\(\[1, 2\]\)/);
  assert.match(result.program, /RelatedScriptures\(\["Romans 3:31"\]\)/);
  assert.doesNotMatch(result.program, /Genesis 99/);
  assert.match(result.answer, /\[1\]/);
});
test('reference-only citations cannot be promoted to a teacher-backed answer', () => {
  const result = validateStudyProgram('root = StudyAnswer([Teaching("Invented doctrine. [2]", [2]), Context("A reference fact. [2]", [2]), Sources([2])])', sources);
  assert.equal(result.teachingFound, false);
  assert.equal(result.answer, 'A reference fact. [2]');
  assert.doesNotMatch(result.program, /Invented doctrine|Teaching\(/);
});

test('a reference-backed factual answer does not get an irrelevant no-teaching disclaimer', () => {
  const result = validateStudyProgram('root = StudyAnswer([Context("A historical detail. [2]", [2])])', sources);
  assert.equal(result.teachingFound, false);
  assert.equal(result.answer, 'A historical detail. [2]');
  assert.doesNotMatch(result.program, /I couldn|Supporting context/);
});
test('unknown citations and citation laundering are removed', () => {
  const result = validateStudyProgram('root = StudyAnswer([Teaching("Unbacked. [2]", [1]), Context("Unknown. [9]", [9])])', sources);
  assert.equal(result.teachingFound, false);
  assert.deepEqual(result.sources, []);
  assert.equal(result.answer, NO_TEACHING);
});
test('rejects unrecognized UI, incomplete output, state, queries and mutations', () => {
  for (const raw of ['root = Unknown("x")', 'root = StudyAnswer([Teaching("unfinished', '$secret = "x"\nroot = StudyAnswer([])', 'x = Query("read_private_notes", {})\nroot = StudyAnswer([])', 'x = Mutation("purchase", {})\nroot = StudyAnswer([])', 'x = "orphan"\nroot = StudyAnswer([])']) assert.equal(validateStudyProgram(raw, sources), null, raw);
});
test('streaming only emits completed validated components; model links and images never become navigation', () => {
  const result = validateStudyProgram('root = StudyAnswer([Teaching("See [bad](https://evil.test) ![image](https://evil.test/leak) [1]", [1])])', sources, true);
  assert.ok(result.teachingFound);
  assert.doesNotMatch(result.program, /https|!\[/);
  const partial = validateStudyProgram('root = StudyAnswer([Teaching("not finished', sources, true);
  assert.equal(partial, null);
});
test('a photo or arbitrary video does not make a reference a teaching source', () => {
  assert.equal(evidenceOf({ kind: 'encyclopedia', video: 'abcdefghijk' }), 'reference');
  assert.equal(evidenceOf({ kind: 'spoken' }), 'teaching');
  assert.equal(evidenceOf({ kind: 'verse' }), 'scripture');
});

test('normalizes grouped citations without appending duplicate markers', () => {
  const result = validateStudyProgram('root = StudyAnswer([Context("A supported detail. [1, 2] [1] [2]", [1, 2])])', sources);
  assert.match(result.answer, /A supported detail\. \[1\] \[2\]$/);
  assert.doesNotMatch(result.answer, /\[1, 2\]/);
});

test('grouped citations cannot launder an unknown or unlisted source', () => {
  for (const cite of ['[1, 9]', '[1, 2]']) {
    const result = validateStudyProgram(`root = StudyAnswer([Teaching("Unsupported. ${cite}", [1])])`, sources);
    assert.equal(result.teachingFound, false);
    assert.equal(result.answer, NO_TEACHING);
  }
});

test('keeps one source rail with both explicit and automatically included citations', () => {
  const result = validateStudyProgram('root = StudyAnswer([Teaching("Recorded point. [1]", [1]), Sources([1]), Context("A reference fact. [2]", [2]), Sources([2]), Sources([1])])', sources);
  assert.equal((result.program.match(/Sources\(/g) || []).length, 1);
  assert.match(result.program, /Sources\(\[1, 2\]\)/);
  assert.ok(result.program.indexOf('Sources(') > result.program.indexOf('Context('));
});

test('preserves paragraph structure and source links when stripping model-generated URLs', () => {
  const raw = 'root = StudyAnswer([Teaching("**The point**\\n\\nA supported explanation. [1](https://untrusted.test)\\n\\nA second paragraph.", [1])])';
  const result = validateStudyProgram(raw, sources);
  assert.ok(result.teachingFound);
  assert.match(result.answer, /\*\*The point\*\*\n\n/);
  assert.match(result.answer, /\[1\]$/);
  assert.doesNotMatch(result.program, /https:/);
});

test('an optional card error can be dropped without losing the validated answer or its source rail', () => {
  for (const card of ['Sources("invalid")', 'InventedCard("ignore this")']) {
    const raw = `root = StudyAnswer([Context("A reference fact. [2]", [2]), ${card}])`;
    assert.equal(validateStudyProgram(raw, sources), null);
    const recovered = validateStudyProgram(raw, sources, false, true);
    assert.equal(recovered.answer, 'A reference fact. [2]');
    assert.match(recovered.program, /Sources\(\[2\]\)/);
    assert.doesNotMatch(recovered.program, /invalid|InventedCard|ignore this/);
  }
});

test('card recovery never admits invalid answer fields, executable state, unresolved names or incomplete output', () => {
  const fact = 'Context("A reference fact. [2]", [2])';
  for (const raw of [
    `root = StudyAnswer([${fact}, Teaching(42, [1])])`,
    `$secret = "x"\nroot = StudyAnswer([${fact}])`,
    `q = Query("read_private_notes", {})\nroot = StudyAnswer([${fact}])`,
    `root = StudyAnswer([${fact}, missing])`,
    `root = StudyAnswer([${fact}, Sources([2]`,
    'root = StudyAnswer([InventedCard("Only unsupported output")])',
  ]) assert.equal(validateStudyProgram(raw, sources, false, true), null, raw);
});

test('format diagnostics never contain model text or model-supplied names', () => {
  const details = studyProgramDiagnostics('root = StudyAnswer([SecretName("private question")])');
  assert.equal(details.errorCount, 1);
  assert.deepEqual(details.errorCodes, ['unknown-component']);
  assert.doesNotMatch(JSON.stringify(details), /SecretName|private question/);
});
