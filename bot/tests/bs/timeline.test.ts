import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as Schema from 'effect/Schema';
import { bs } from '../../src/bs/index.ts';
import publication from '../../data/bs-timeline.json';
import source from '../../../app/src/data/timeline.json';
import final from '../../../app/src/data/final-captivity.json';
import { TimelineEventDto, TimelineEventsResponseDto, TimelineEventResponseDto } from '../upstream/contracts/timelineContract.ts';
import { metadata } from '../../src/bs/core.ts';
const request = (path: string) => bs.request(path, {}, {} as any);

test('every published timeline event survives the existing captivity grouping, with unique readable details', () => {
  const original = new Set(source.sections.flatMap(s => s.events.map(e => e.slug)));
  const projected = new Set(publication.sections.flatMap(s => s.events.map(e => e.slug)));
  assert.deepEqual(projected, original);
  assert.equal(projected.size, 991);
  assert.equal(publication.sections.length, 21);
  assert.equal(publication.events.length, new Set(publication.events.map(e => e.slug)).size);
  assert.equal(publication.revision, `cj-timeline-${createHash('sha256').update(JSON.stringify({ geometry: publication.sections, events: publication.events })).digest('hex')}`);
  for (const event of publication.events) {
    Schema.decodeUnknownSync(TimelineEventDto)(event);
    assert.ok(projected.has(event.slug));
    assert.ok(!event.article.includes('[object Object]'));
    for (const ref of event.scriptures) {
      const match = /^(\d+)\|(\d+):(\d+)(?:-(\d+))?$/.exec(ref);
      assert.ok(match, ref);
      assert.ok(Number(match[3]) > 0 && Number(match[4] ?? match[3]) <= metadata.verseCountByBookChapter[`${match[1]}-${match[2]}`], ref);
    }
    for (const related of event.related) assert.ok(publication.events.some(e => e.slug === related.slug));
  }
});

test('case studies retain sources and CyberJudah Apocrypha numbering', () => {
  const adam = publication.events.find(e => e.slug === 'adam')!;
  assert.ok(adam.scriptures.includes('68|3:5'));
  assert.ok(adam.scriptures.includes('73|25:24'));
  assert.match(adam.article, /https:\/\/cyberjudah.io\/cases\/01-primeval\/adam-and-eve/);
  assert.match(publication.events.find(e => e.slug === 'saul')!.article, /Who's Who in the Bible/);
});

test('all 434 Final Captivity accounts retain documented history, sources and disagreements', () => {
  assert.equal(Object.keys(final).length, 434);
  for (const [slug, source] of Object.entries(final)) {
    const event = publication.events.find(e => e.slug === slug)!;
    assert.ok(event, slug);
    assert.equal(event.description, source.summary);
    for (const paragraph of source.account ?? []) assert.ok(event.article.includes(paragraph), slug);
    for (const ref of source.sources ?? []) assert.ok(event.article.includes(ref.url), slug);
    if ('uncertainty' in source && source.uncertainty) assert.ok(event.article.includes(source.uncertainty), slug);
    if ('disagreements' in source) for (const disagreement of source.disagreements ?? []) for (const view of disagreement.views) assert.ok(event.article.includes(view), slug);
    assert.equal(event.dates, source.date.text);
  }
});

test('the complete index exceeds search limits, search is bounded, and English content is declared', async () => {
  const full = await request('/v1/timelines/en/events');
  const all = Schema.decodeUnknownSync(TimelineEventsResponseDto)(await full.json());
  assert.equal(all.events.length, 517);
  assert.equal(full.headers.get('content-language'), 'en');
  const search = await request('/v1/timelines/fr/events?search=Gon%C3%A7alves&limit=2');
  const found = Schema.decodeUnknownSync(TimelineEventsResponseDto)(await search.json());
  assert.ok(found.events.length > 0 && found.events.length <= 2);
  assert.equal(search.headers.get('content-language'), 'en');
  const detail = await request('/v1/timelines/en/events/portuguese-captives-1441');
  Schema.decodeUnknownSync(TimelineEventResponseDto)(await detail.json());
  assert.equal((await request('/v1/timelines/en/events/missing-event')).status, 404);
  assert.equal((await request('/v1/timelines/de/events')).status, 400);
  assert.equal((await request('/v1/timelines/en/events?limit=101')).status, 400);
  assert.equal((await request(`/v1/timelines/en/events?search=${'x'.repeat(201)}`)).status, 400);
});
