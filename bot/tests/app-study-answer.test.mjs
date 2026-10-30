import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-study-answer.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-study-answer.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { selectAppStudyEvidence, appTranscriptQueries } = await import(out);
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
