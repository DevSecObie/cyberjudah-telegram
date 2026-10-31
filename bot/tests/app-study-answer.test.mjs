import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-study-answer.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-study-answer.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { selectAppStudyEvidence, appTranscriptQueries, checkAppStudyOutput, citedScriptures } = await import(out);
const uiOut = new URL('./.build/app-study-answer-ui.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-study-ui.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: uiOut, logLevel: 'error' });
const { validateStudyProgram } = await import(uiOut);

test('the composer cannot receive more citations than the renderer admits', () => {
  const sources = Array.from({ length: 24 }, (_, i) => ({ n: i+1, kind: 'spoken', evidence: 'teaching', title: `Teaching ${i+1}`, text: 'Recorded words.', url: `/classes/${i+1}` }));
  const selected = selectAppStudyEvidence(sources, 8);
  assert.equal(selected.length, 12);
  assert.deepEqual(selected.map(s => s.n), Array.from({ length: 12 }, (_, i) => i+9));
  assert.notEqual(selected[0], sources[8]);
  const program = `root = StudyAnswer([Teaching("Recorded explanation.", [9]), Sources([${selected.map(s => s.n)}])])`;
  assert.ok(validateStudyProgram(program, selected)?.teachingFound);
});
test('broad retrieval fills unused space without renumbering targeted evidence', () => {
  const sources = Array.from({ length: 10 }, (_, i) => ({ n: i+1, kind: 'spoken', evidence: 'teaching', title: `Teaching ${i+1}`, text: 'Recorded words.', url: `/classes/${i+1}` }));
  assert.deepEqual(selectAppStudyEvidence(sources, 8).map(s => s.n), sources.map(s => s.n));
  assert.deepEqual(selectAppStudyEvidence([], 0), []);
});

test('named scriptures focus transcript retrieval instead of searching conversational filler', () => {
  const catalog = [{book:'Romans',slug:'romans',chapters:16},{book:'James',slug:'james',chapters:5}];
  assert.deepEqual(appTranscriptQueries('What did the teachers say about Romans 3:31 and James 2:17? Show the related scriptures.', catalog), ['Romans 3:31','James 2:17']);
  assert.deepEqual(appTranscriptQueries('Romans 3:31 and Romans 3:31', catalog), ['Romans 3:31']);
  assert.deepEqual(appTranscriptQueries('Who was Abraham?', catalog), ['Who was Abraham?']);
  assert.deepEqual(appTranscriptQueries('James 99:1', catalog), ['James 99:1']);
});

test('a malformed OpenUI answer gets one checked replacement when the caller admits it', async () => {
  const sources = [{ n: 2, kind: 'people', evidence: 'reference', title: 'Person', text: 'A biographical fact.', url: '/person/example' }];
  let calls = 0;
  const result = await checkAppStudyOutput({ text: 'Invalid answer format', cut: false }, sources, async () => {
    calls++;
    return { text: 'root = StudyAnswer([Context("A biographical fact. [2]", [2])])', cut: false };
  });
  assert.equal(calls, 1);
  assert.equal(result.answer, 'A biographical fact. [2]');
  assert.equal(result.teachingFound, false);
});

test('the retry cannot promote reference data into doctrine or return truncated output', async () => {
  const sources = [{ n: 2, kind: 'people', evidence: 'reference', title: 'Person', text: 'A biographical fact.', url: '/person/example' }];
  const first = { text: 'bad format', cut: false };
  const result = await checkAppStudyOutput(first, sources, async () => ({ text: 'root = StudyAnswer([Teaching("Invented doctrine. [2]", [2])])', cut: false }));
  assert.equal(result, null);
  assert.equal(await checkAppStudyOutput(first, sources), null);
  assert.equal(await checkAppStudyOutput(first, sources, async () => ({ text: 'root = StudyAnswer([])', cut: true })), null);
});

test('a card-only response is retried instead of being mistaken for an answer', async () => {
  const sources = [{ n: 2, kind: 'people', evidence: 'reference', title: 'Person', text: 'A biographical fact.', url: '/person/example' }];
  let retries = 0;
  const result = await checkAppStudyOutput({ text: 'root = StudyAnswer([Sources([2])])', cut: false }, sources, async () => {
    retries++;
    return { text: 'root = StudyAnswer([Context("A biographical fact. [2]", [2])])', cut: false };
  });
  assert.equal(retries, 1);
  assert.equal(result.answer, 'A biographical fact. [2]');
});

test('a valid first answer never incurs a retry', async () => {
  const sources = [{ n: 1, kind: 'spoken', evidence: 'teaching', title: 'Class', text: 'A recorded point.', url: '/class/example' }];
  const result = await checkAppStudyOutput({ text: 'root = StudyAnswer([Teaching("A recorded point. [1]", [1])])', cut: false }, sources, async () => { throw new Error('Unexpected retry'); });
  assert.equal(result.teachingFound, true);
});
test('the scriptures the classes cite are read, the most cited first, and always kept among the sources', () => {
  assert.deepEqual(citedScriptures('Exodus 12:14 says for ever. Lev. 23:5-6 the passover. Again Exodus 12:14, and 1 Corinthians 5:7.'), ['Exodus 12:14', 'Lev 23:5-6', '1 Corinthians 5:7']);
  const sources = Array.from({ length: 20 }, (_, i) => ({ n: i+1, kind: i === 19 ? 'verse' : 'spoken', evidence: i === 19 ? 'scripture' : 'teaching', title: `S ${i+1}`, text: 'x', url: `/s/${i+1}` }));
  assert.ok(selectAppStudyEvidence(sources, 4).some(s => s.n === 20), 'the verse read last is not dropped by the 12-source limit');
});
