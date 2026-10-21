import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/lib/entity-list.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { annotationNoteRows, queryHighlights, normalizeHighlightFilters, queryEntityList, normalizeListQuery, queryBookmarks } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const chapters = [
  { slug: 'exodus', chapter: 2, verses: { 10: { color: 'color2', date: 200, tags: { faith: true } } } },
  { slug: 'genesis', chapter: 10, verses: { 2: { color: 'color1', date: 100, tags: { wisdom: true } }, 1: { color: 'color1', date: 100, tags: { faith: true } } } },
  { slug: 'genesis', chapter: 2, verses: { 11: { color: 'color2', date: 300 } } },
  { slug: 'john', chapter: 1, verses: { 1: { color: 'color1', date: 400 } } },
];
const annotations = [2, 1].map(verse => ({ id: `w${verse}`, group: 'span', verseKey: `genesis-1-${verse}`, start: 0, quote: `part ${verse}`, color: 'color2', style: 'underline', created: '2026-10-01', tags: { faith: true } }));

test('highlights group verse selections and word marks, then sort numerically in Bible order', () => {
  const rows = queryHighlights(chapters, annotations, { sort: 'bible' });
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(row => `${row.locations[0].slug}/${row.locations[0].chapter}`), ['genesis/1', 'genesis/2', 'genesis/10', 'exodus/2', 'john/1']);
  assert.equal(rows[0].text, 'part 1 … part 2');
  assert.deepEqual(rows[2].locations.map(v => v.verse), [1, 2]);
  assert.deepEqual(rows[2].tags, { faith: true, wisdom: true });
  assert.equal(queryHighlights(chapters, annotations, {})[0].kind, 'annotation');
  assert.equal(queryHighlights(chapters, annotations, { sort: 'oldest' })[0].date, 100);
});

test('color, book, testament, tag and type filters intersect before grouping', () => {
  assert.equal(queryHighlights(chapters, annotations, { colorId: 'color1', tagId: 'faith', typeFilter: 'highlights' })[0].locations.length, 1);
  assert.equal(queryHighlights(chapters, annotations, { typeFilter: 'annotations', book: 'genesis' }).length, 1);
  assert.equal(queryHighlights(chapters, annotations, { typeFilter: 'annotations', book: 'exodus' }).length, 0);
  assert.equal(queryHighlights(chapters, annotations, { testament: 'new' }).length, 1);
  assert.equal(queryHighlights(chapters, annotations, { colorId: 'color2', testament: 'new' }).length, 0);
  assert.equal(queryHighlights(chapters, annotations, { typeFilter: 'highlights', tagId: 'missing' }).length, 0);
});

test('persisted filters reject invalid values and incompatible books', () => {
  assert.deepEqual(normalizeHighlightFilters(null), {});
  const state = normalizeHighlightFilters({ sort: 'broken', book: 'genesis', testament: 'new', typeFilter: 'LSG', colorId: 4 });
  assert.equal(state.book, undefined); assert.equal(state.colorId, undefined); assert.equal(state.typeFilter, undefined); assert.equal(state.sort, 'newest');
  assert.equal(normalizeHighlightFilters({ book: 'john', testament: 'new' }).book, 'john');
  assert.deepEqual(normalizeListQuery({ query: 4, sort: false, tagId: 9 }), { query: '', sort: 'newest', tagId: null });
});

test('entity queries support creation order, stable date ties and accent-insensitive search', () => {
  const rows = [{ id: 'b', title: 'Café', description: 'Peace', date: 10, createdAt: 1 }, { id: 'a', title: 'Alpha', date: 10, createdAt: 20 }];
  assert.deepEqual(queryEntityList(rows, { query: '', sort: 'newest' }).map(r => r.id), ['a', 'b']);
  assert.deepEqual(queryEntityList(rows, { query: '', sort: 'created-oldest' }).map(r => r.id), ['b', 'a']);
  assert.deepEqual(queryEntityList(rows, { query: '', sort: 'created-newest' }).map(r => r.id), ['a', 'b']);
  assert.deepEqual(queryEntityList(rows, { query: 'cafe', sort: 'newest' }).map(r => r.id), ['b']);
  assert.deepEqual(rows.map(r => r.id), ['b', 'a']);
});

test('bookmarks search names and references using substring matching and date ordering', () => {
  const rows = [{ id: 'a', name: 'Creation', date: 20, book: 'genesis', chapter: 1 }, { id: 'b', name: 'Later', date: 10, book: 'john', chapter: 3 }];
  const reference = b => `${b.book} ${b.chapter}`;
  assert.deepEqual(queryBookmarks(rows, { query: 'Gen', sort: 'newest' }, reference).map(b => b.id), ['a']);
  assert.deepEqual(queryBookmarks(rows, { query: 'e', sort: 'oldest' }, reference).map(b => b.id), ['b', 'a']);
});

test('word annotation notes are listed once for a grouped mark at the first verse', () => {
  const rows = annotationNoteRows(annotations.map(r => ({ ...r, note: { title: 'A note', description: 'Keep content', date: 123 } })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, '1');
  assert.equal(rows[0].note.id, 'annotation:span');
  assert.equal(rows[0].note.description, 'Keep content');
});
