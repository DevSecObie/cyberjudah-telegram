import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/verse-study.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/verse-study.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { formatVerseStudy, teacherRank, versesOf, captionAt, snippetWanted, undatedVideos } = await import(out);

const site = (p) => `https://cyberjudah.io${p}`;
const names = { exodus: 'Exodus', leviticus: 'Leviticus' };
const ask = { book: 'Exodus', slug: 'exodus', chapter: 12, from: 14, to: 14 };
const conc = {
  book: 'Exodus', chapter: 12,
  cited_by: [
    { kind: 'note', label: 'Revelation 13 · The Beast', url: '/study/revelation/13', verses: '' },
    { kind: 'note', label: 'Revelation 13 · The Beast', url: '/study/revelation/13', verses: '1-2' },
    { kind: 'note', label: 'Day of Atonement', url: '/classes/2026/day-of-atonement', verses: '14' },
  ],
  precepts: [
    { verses: '14', kind: 'precept', ref: { label: '1 Corinthians 5:7-8', url: '/bible/1-corinthians/5#v7' }, text: 'Christ our passover is sacrificed for us.', note: { label: "Exodus 12: The Lord's Passover", url: '/study/exodus/12', date: '', teacher: '' }, ts: '' },
    { verses: '15', kind: 'precept', ref: { label: 'Romans 6:23', url: '/bible/romans/6#v23' }, text: 'x', note: { label: 'Bitterness', url: '/classes/2026/bitterness', date: '2026-04-18', teacher: 'Captain Matt' }, ts: '21:19' },
  ],
  moments: [{ verses: '1-17', label: 'Passover Class', url: '/classes/2026/passover', date: '2026-04-16', teacher: 'Deacon Malachiyah', video: 'VyDEbsxgcas', t: 1379, ts: '22:59' }],
  commentary: [
    { verses: '14', points: ['This day is a memorial.', 'It was not done away.'], sources: [null, { video: 'AAAAAAAAAAA', t: 60, ts: '1:00', title: 'A class', date: '2020-01-01', teacher: 'Bishop Nathanyel', how: 'pass' }], note: { label: "Exodus 12: The Lord's Passover", url: '/study/exodus/12' }, ts: '' },
  ],
  read: {
    '14': [
      { video: '-t9W3dyGuTI', t: 713, ts: '11:53', vt: 732.6, how: 'called', said: "let's go to Exodus 12 and 14", feed: 'captains', title: 'Gods Holidays', date: '2020-05-25', teacher: '' },
      { video: 'VyDEbsxgcas', t: 1668, ts: '27:48', vt: 1851.5, how: 'followed', said: 'Verse 12', feed: 'classes', title: 'Passover Class', date: '2026-04-17', teacher: 'Deacon Malachiyah', url: '/classes/2026/passover' },
    ],
  },
};
const xref = { '14': [['exodus', 5, 1], ['leviticus', 23, 4]] };

test('verse_study gives the study note with a source or "unsourced" on every point', () => {
  const text = formatVerseStudy(conc, xref, ask, names, site);
  assert.match(text, /STUDY NOTE/);
  assert.match(text, /This day is a memorial\.\n  Source: unsourced/);
  assert.match(text, /It was not done away\.\n  Source: A class \(2020-01-01, Bishop Nathanyel\) at 1:00, https:\/\/www\.youtube\.com\/watch\?v=AAAAAAAAAAA&t=60s/);
  assert.match(text, /Precept on verse 14: 1 Corinthians 5:7-8/);
});

test('every class hit has a match reason, a moment link, a teacher or "teacher unknown", and notes or "none yet"', () => {
  const text = formatVerseStudy(conc, xref, ask, names, site, { 'VyDEbsxgcas@1851': 'And this day shall be unto you for a memorial.' });
  const classes = text.split('CLASSES')[1].split('CROSS-REFERENCES')[0];
  const hits = classes.split(/\n(?=\d+\. )/).slice(1);
  assert.ok(hits.length >= 3);
  for (const h of hits) { assert.match(h, /Match: /); assert.match(h, /Notes: /); assert.match(h, /, (teacher unknown|Bishop|Deacon|Captain)/); }
  // Both are readings of the verse; the Deacon's comes first.
  assert.match(hits[0], /Passover Class .*Deacon Malachiyah\n   Match: reads Exodus 12:14 at 30:51/);
  assert.match(hits[0], /Said: “And this day shall be unto you for a memorial\.”/);
  assert.match(hits[0], /Notes: https:\/\/cyberjudah\.io\/classes\/2026\/passover/);
  assert.match(hits[1], /^2\. Gods Holidays \(15 Min w\/ Captains\), 2020-05-25, teacher unknown\n   Match: calls for Exodus 12:14 at 11:53 and reads it at 12:12/);
  assert.match(hits[1], /Video: https:\/\/www\.youtube\.com\/watch\?v=-t9W3dyGuTI&t=732s/);
  assert.match(hits[1], /Notes: none yet/);
});

test('a note with no verse of its own (a chapter-level row) does not match a verse; one citing the verse does, ranked last', () => {
  const text = formatVerseStudy(conc, xref, ask, names, site);
  assert.doesNotMatch(text, /Revelation 13/);
  assert.match(text, /Day of Atonement.*\n   Match: cites Exodus 12:14 in its text \(no moment recorded\)/);
  assert.doesNotMatch(text, /Romans 6:23/);
});

test('a reading that began elsewhere says so when its own words were not read', () => {
  assert.match(formatVerseStudy(conc, xref, ask, names, site), /Said: “\(where the reading began, 27:48\) Verse 12”/);
});

test('cross-references are named, not dropped', () => {
  assert.match(formatVerseStudy(conc, xref, ask, names, site), /CROSS-REFERENCES\nExodus 5:1; Leviticus 23:4/);
});

test('rank: Bishops, Deacons, Captains, the rest, unknown, Zakai last', () => {
  assert.deepEqual(['Bishop Kani', 'Deacon Isaac', 'Captain Matt', 'Officer Seir', '', 'Zakai'].map(teacherRank), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(versesOf('2,26-27'), [[2, 2], [26, 27]]);
});

test('snippets are fetched for the readings shown first and cut from the captions', () => {
  assert.deepEqual(snippetWanted(conc, 14, 14).map((x) => x.video), ['VyDEbsxgcas', '-t9W3dyGuTI']);
  assert.equal(captionAt([[1850, '>> Uh-huh.'], [1851.5, '>> And this day shall be unto you for a'], [1853.9, 'memorial.']], 1851, 10), 'And this day shall be unto you for a memorial.');
});

test('a class with no date of its own shows its YouTube upload date, said to be that', async () => {
  const text = formatVerseStudy(conc, xref, ask, names, site, {}, { 'VyDEbsxgcas': '2099-01-01' });
  assert.match(text, /Passover Class.*, 2026-04-17, Deacon Malachiyah/, 'a known date is kept');
  const undated = { ...conc, read: { '14': [{ ...conc.read['14'][0], date: '' }] } };
  assert.match(formatVerseStudy(undated, xref, ask, names, site, {}, { '-t9W3dyGuTI': '2020-05-25' }), /Gods Holidays \(15 Min w\/ Captains\), 2020-05-25 \(YouTube upload date\), teacher unknown/);
  assert.match(formatVerseStudy(undated, xref, ask, names, site), /Gods Holidays \(15 Min w\/ Captains\), date unknown/);
  assert.deepEqual(undatedVideos(undated, 14, 14), ['-t9W3dyGuTI']);
});
