import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/transcript-lint.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/transcript-lint.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { cleanTranscript, lintTranscript, formatLint, tidy, bookKey } = await import(out);

const BOOKS = ['Genesis', 'Exodus', 'Deuteronomy', 'Psalms', '2 Esdras', 'Baruch', '1 Maccabees', 'Song of Solomon', 'Revelation'];

test('the clean view: a paragraph per turn of speaker, cues and fillers out, nothing else reworded', () => {
  const segs = [
    [10, 'Give me Psalms 2 verse1.'],
    [12, '>> Why do the heathen rage and the the people'],
    [14, 'imagine a vain thing? [Music]'],
    [16, '>> Um the heathen here will be the other nations. >> Read on.'],
  ];
  const { paragraphs, changes } = cleanTranscript(segs, []);
  assert.deepEqual(paragraphs.map((p) => [p.t, p.turn, p.text]), [
    [10, false, 'Give me Psalms 2 verse 1.'],
    [12, true, 'Why do the heathen rage and the people imagine a vain thing?'],
    [16, true, 'the heathen here will be the other nations.'],
    [16, true, 'Read on.'],
  ]);
  assert.deepEqual(changes, []);
});

test('the King James doubled words are never collapsed', () => {
  assert.equal(tidy('Verily verily I say unto you'), 'Verily verily I say unto you');
  assert.equal(tidy('Holy holy holy Lord God'), 'Holy holy holy Lord God');
  assert.equal(tidy('I said that that is true'), 'I said that that is true');
  assert.equal(tidy('and the the people'), 'and the people');
});

test('a known correction is applied in the clean view and listed, only while the caption still matches', () => {
  const segs = [[100, 'go to second edges chapter 2 and verse 4'], [104, 'read it']];
  const fix = [[0, 100, 'go to second edges chapter 2 and verse 4', 'go to 2 Esdras chapter 2 and verse 4', 'esdras-edges']];
  const a = cleanTranscript(segs, fix);
  assert.equal(a.paragraphs[0].text, 'go to 2 Esdras chapter 2 and verse 4 read it');
  assert.deepEqual(a.changes, [{ t: 100, was: segs[0][1], now: fix[0][3], rule: 'esdras-edges' }]);
  // A transcript re-downloaded since the correction was made: the stale correction is ignored.
  const b = cleanTranscript([[100, 'go to Second Edges chapter 2']], fix);
  assert.equal(b.paragraphs[0].text, 'go to Second Edges chapter 2');
  assert.deepEqual(b.changes, []);
});

test('a range reads only its seconds', () => {
  const segs = [[5, 'one'], [50, 'two'], [95, 'three']];
  assert.deepEqual(cleanTranscript(segs, [], { from: 40, to: 60 }).paragraphs.map((p) => p.text), ['two']);
});

test('the lint finds unpunctuated captions, missing metadata and words before "chapter N" that are no book', () => {
  const segments = [];
  for (let i = 0; i < 60; i++) segments.push([i * 3, i === 20 ? 'turn to baroo chapter 3 and verse 9' : i === 30 ? 'go to the book of psalms chapter 23' : i === 40 ? 'read the next chapter 4 now' : 'and the lord said unto moses go down']);
  const r = lintTranscript({ title: 'Old class', date: null, duration: 180, segments }, [], BOOKS, {});
  const by = Object.fromEntries(r.findings.map((f) => [f.check, f]));
  assert.equal(by.punctuation.level, 'warn');
  assert.equal(by.metadata.level, 'warn');
  assert.match(by.metadata.detail, /date, teacher, written notes/);
  assert.equal(by['possible mishearings'].level, 'warn');
  assert.deepEqual(by['possible mishearings'].examples, ['[0:01:00] “turn to baroo chapter 3”']);
  assert.equal(r.grade, 'D');
  assert.match(formatLint('Old class', 'abcdefghijk', r), /^Transcript lint: Old class\nVideo: https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk\nGrade D/);
});

test('a clean, cited recording grades A', () => {
  const segments = Array.from({ length: 200 }, (_, i) => [i * 3, 'And the Lord spake unto Moses, saying, read Exodus chapter 12.']);
  const r = lintTranscript({ title: 'Class', date: '2026-01-01', duration: 600, segments }, [], BOOKS, { teacher: 'Bishop Nathanyel', notes: '/classes/2026/x' });
  assert.equal(r.grade, 'A', JSON.stringify(r.findings));
  assert.equal(lintTranscript({ title: 'Empty', segments: [] }, [], BOOKS).grade, 'D');
});

test('book names compare as spoken', () => {
  assert.equal(bookKey('First Maccabees'), '1 maccabees');
  assert.equal(bookKey('Psalm'), 'psalms');
  assert.equal(bookKey('Revelations'), 'revelation');
});
