import test from 'node:test';
import assert from 'node:assert/strict';
import { passageExport } from '../src/bible/passage-export.ts';
import { readerSession, saveReaderSession } from '../src/bible/session.ts';
const all = { text: true, notes: true, links: true, tags: true, relations: true, phrases: true };
const chapter = {
  slug: 'genesis', book: 'Genesis', chapter: 1, verses: [{ verse: 1, text: 'In the beginning' }],
  notes: { '1/2': { title: 'A note', description: 'Unchanged words', tags: { faith: true } }, '9': { title: 'Outside note', description: 'Must not appear' } },
  links: { '1': { title: 'A source', url: 'https://example.com/source' } }, highlights: { 1: { tags: { faith: true } } },
  relations: [{ id: 'r', type: 'explains', direction: 'backward', endpoints: [{ type: 'verse', verseKeys: ['genesis-1-1'], label: 'Genesis 1:1' }, { type: 'verse', verseKeys: ['john-1-1'], label: 'John 1:1' }] }],
  annotations: [{ verseKey: 'genesis-1-1', style: 'underline', quote: 'beginning' }, { verseKey: 'genesis-1-9', style: 'highlight', quote: 'Outside phrase' }],
};
test('selected passage keeps overlapping notes, direction, links, tags and phrase marks; excludes unrelated data', () => {
  const text = passageExport('Genesis 1:1', [chapter], all, { faith: { name: 'Faith' } });
  for (const included of ['In the beginning', 'Unchanged words', 'outside this selection', 'John 1:1 — explains → Genesis 1:1', 'https://example.com/source', 'Faith', 'underline: “beginning”']) assert.ok(text.includes(included), included);
  for (const excluded of ['Outside note', 'Must not appear', 'Outside phrase']) assert.ok(!text.includes(excluded), excluded);
});
test('export options remove excluded content and whole-book exports deduplicate shared relations', () => {
  const text = passageExport('Genesis', [chapter, { ...chapter, chapter: 2 }], { ...all, text: false, notes: false, tags: false, links: false, phrases: false }, {});
  assert.equal(text.match(/explains/g)?.length, 1);
  for (const excluded of ['In the beginning', 'A note', 'Faith', 'https://', 'underline']) assert.ok(!text.includes(excluded), excluded);
});
test('reader session is isolated by tab and passage, retaining focus context on reopening', () => {
  saveReaderSession('one:john:3:16-18', { selected: [17], contextMode: 'fullChapter', fullscreen: true });
  assert.deepEqual(readerSession('one:john:3:16-18', true), { selected: [17], contextMode: 'fullChapter', fullscreen: true });
  assert.deepEqual(readerSession('two:john:3:16-18', true), { selected: [], contextMode: 'focused', fullscreen: false });
  assert.deepEqual(readerSession('one:john:4:', false), { selected: [], contextMode: 'fullChapter', fullscreen: false });
});
