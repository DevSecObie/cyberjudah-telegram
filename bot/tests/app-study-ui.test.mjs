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
const { validateStudyProgram, APP_TEACHING_POLICY, getAppStudyPrompt, getAppStudyLibrary, evidenceOf, NO_TEACHING } = study;
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
  assert.ok(result.answer.startsWith(NO_TEACHING));
  assert.doesNotMatch(result.program, /Invented doctrine|Teaching\(/);
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
