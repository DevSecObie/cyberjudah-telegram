import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Hono } from 'hono';

const out = new URL('./.build/bs-timeline.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/bs/timeline.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { timelines } = await import(out);
const source = JSON.parse(await readFile(new URL('../../app/src/data/timeline.json', import.meta.url)));
const details = JSON.parse(await readFile(new URL('../../app/src/data/final-captivity.json', import.meta.url)));
const app = new Hono().route('/', timelines).onError((e, c) => c.json({ error: e.code }, e.status ?? 500));
const env = { DATA_ORIGIN: 'https://data.test', SUBS: { get: async () => null } };
const request = (path, bindings = env) => app.request(`https://cyberjudah.test${path}`, {}, bindings);

test('the fork receives every published event, the original geometry, and Redemption last', async () => {
  const response = await request('/en/sections');
  assert.equal(response.status, 200);
  const sections = await response.json();
  assert.equal(sections.length, source.sections.length);
  for (const [i, section] of sections.entries()) {
    assert.deepEqual(section.events.map(({ id, slug, row, start, end }) => ({ id, slug, row, start, end })), source.sections[i].events.map(({ id, slug, row, start, end }) => ({ id, slug, row, start, end })));
    assert.equal(section.titleEn, source.sections[i].title);
    assert.ok(!section.image.includes('biblehistory.com'));
  }
  assert.equal(sections.at(-1).title, 'Redemption');
  assert.ok(sections.at(-1).events.some(e => e.slug === 'iuic-founded-2003'));
  assert.ok(!sections.some(s => /IUIC|Israel United in Christ/.test(s.title)));
  assert.equal(sections.find(s => s.id === '3')?.image ?? '', '');
});

test('the full event index enables every published detail; search honors its limit', async () => {
  const { events } = await (await request('/en/events')).json();
  for (const slug of Object.keys(details)) assert.ok(events.some(e => e.slug === slug), `missing ${slug}`);
  assert.ok(events.length > 100, 'the canvas index must not be truncated to the search page size');
  const search = await (await request('/en/events?search=IUIC&limit=2')).json();
  assert.equal(search.events.length, 2);
  assert.equal((await request('/en/events?limit=101')).status, 400);
  assert.equal((await request('/xx/events')).status, 400);
});

test('event details retain exact sources, dated class quotations and scriptural attribution', async () => {
  const slug = 'portuguese-captives-1441', detail = details[slug];
  const response = await request(`/en/events/${slug}`);
  assert.equal(response.status, 200);
  const { event } = await response.json();
  assert.equal(event.description, detail.summary);
  assert.equal(event.dates, detail.date.text);
  assert.match(event.article, /Documented History/);
  assert.match(event.article, /Quotes and Sources — From the Classes/);
  assert.equal(event.article.includes('Scriptural Application'), !!detail.scriptures?.length);
  for (const paragraph of detail.account) assert.ok(event.article.includes(paragraph));
  for (const teaching of detail.teaching) {
    if (teaching.quote) assert.ok(event.article.includes(teaching.quote));
    assert.ok(event.article.includes(teaching.source.url));
    if (teaching.source.ts) assert.ok(event.article.includes(teaching.source.ts));
  }
  for (const ref of [...(detail.scriptures ?? []), ...(detail.answer ?? [])]) assert.ok(event.scriptures.includes(ref.ref));
  assert.equal((await request('/en/events/not-a-published-event')).status, 404);
});

test('scriptural references are carried verbatim when the source includes them', async () => {
  const [slug, detail] = Object.entries(details).find(([, value]) => value.scriptures?.length);
  const { event } = await (await request(`/en/events/${slug}`)).json();
  assert.match(event.article, /Scriptural Application/);
  for (const ref of detail.scriptures) {
    assert.ok(event.scriptures.includes(ref.ref));
    if (ref.why) assert.ok(event.article.includes(ref.why));
  }
});

test('an early event opens CyberJudah case studies, never the upstream article', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://data.test/api/cases/adam-and-eve.json');
    return Response.json({ charge: 'Local fixture charge', url: '/cases/adam-and-eve', refsResolved: [{ label: 'Genesis 3:6' }] });
  };
  try {
    const { event } = await (await request('/en/events/adam')).json();
    assert.match(event.article, /Local fixture charge/);
    assert.match(event.article, /https:\/\/cyberjudah.io\/cases\/adam-and-eve/);
    assert.deepEqual(event.scriptures, ['Genesis 3:6']);
  } finally { globalThis.fetch = original; }
});
