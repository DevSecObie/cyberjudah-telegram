import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from '../../../resources/bundle.mjs';
import { ResourcePinsSchema, APPROVED_RESOURCE_IDS } from '../../../shared/resources.ts';
import { readResourceRecord, resources as route } from '../../src/resources.ts';
import { resolveResourcePins, approvedEditionUrl } from '../../src/resource-tools.ts';
import { MORE_RUN } from '../../src/ask-tools.ts';
import type { Env } from '../../src/env.ts';

async function setup() {
  const files = new Map<string, Uint8Array>(), old: Record<string, string> = {}, current = [];
  for (const id of APPROVED_RESOURCE_IDS) for (const version of ['old', 'new']) {
    const records = id === 'strongs' ? [{ key: 'entry/H430', data: { number: 'H430', language: 'Hebrew', lemma: 'fixture', xlit: 'fixture', def: `${version} synthetic definition` } }, { key: 'index', data: [{ n: 'H430', lemma: 'fixture', xlit: 'fixture', def: `${version} synthetic definition`, count: 1 }] }] : [{ key: 'search/israel', data: { keys: ['page/1/1'], total: 1 } }, { key: 'page/1/1', data: { title: `${id} edition`, text: `${version} synthetic Israel page. `.repeat(5), scan: 'https://example.invalid/scan', volume: 1, page: 1 } }];
    const bundle = await buildBundle({ id, kind: id === 'strongs' ? 'lexicon' : 'reference', title: 'Synthetic fixture', language: 'en', source: [{ url: 'https://example.invalid/fixture', revision: version, sha256: 'a'.repeat(64) }], license: [{ id: 'public-domain', url: 'https://example.invalid/fixture', attribution: 'TEST ONLY', modifications: '' }], approval: { reference: 'https://example.invalid/fixture', approvedBy: 'TEST ONLY' } }, records);
    for (const [name, bytes] of bundle.files) files.set(`resources/${id}/${bundle.entry.release}/${name}`, bytes);
    files.set(`resources/approved/${id}/${bundle.entry.release}.json`, new TextEncoder().encode(JSON.stringify({ manifestSha256: bundle.entry.manifestSha256 })));
    if (version === 'old') old[id] = bundle.entry.release; else current.push(bundle.entry);
  }
  files.set('resources/catalog/current.json', new TextEncoder().encode(JSON.stringify({ schemaVersion: 1, revision: 2, resources: current })));
  const env = { AUDIO: { get: async (key: string) => { const bytes = files.get(key); return bytes ? { size: bytes.length, httpEtag: '"catalog"', arrayBuffer: async () => bytes.buffer, json: async () => JSON.parse(new TextDecoder().decode(bytes)) } : null; } } } as unknown as Env;
  return { env, old: ResourcePinsSchema.parse(old), current, files };
}
const line = (name: string, what: string, url: string) => `${name}: ${what} Link: ${url}`;
test('Strong’s tool, HTTP reader and installed client snapshot use the same old release after publication advances', async () => {
  const { env, old, current } = await setup();
  const pins = await resolveResourcePins(env, old);
  assert.deepEqual(pins, old); assert.notEqual(pins.strongs, current[0].release);
  const record = await readResourceRecord(env, 'strongs', 'entry/H430', pins.strongs!);
  const response = await route.request(`https://example.invalid/strongs/${pins.strongs}/record?key=entry/H430`, {}, env);
  assert.deepEqual(await response.json(), record);
  const result = await MORE_RUN.look_up_word(env, { word: 'H430' }, undefined, () => {}, line, () => null, pins);
  assert.match(result.content, /old synthetic definition/); assert.ok(result.content.includes(pins.strongs!)); assert.doesNotMatch(result.content, /new synthetic/);
  const english = await MORE_RUN.look_up_word(env, { word: 'fixture' }, undefined, () => {}, line, () => null, pins);
  assert.match(english.content, /old synthetic definition/);
});
test('all three book tools cite the same approved pinned page that the app endpoint returns', async () => {
  const { env, old } = await setup();
  for (const id of APPROVED_RESOURCE_IDS.filter((id) => id !== 'strongs')) {
    const citations: { url: string; text: string }[] = [];
    const result = await MORE_RUN.outside_source(env, { resource: id, query: 'israel' }, undefined, () => {}, line, (p) => { citations.push(p); return { n: citations.length, fresh: true }; }, old);
    const page = await readResourceRecord(env, id, 'page/1/1', old[id]!);
    assert.ok(result.content.includes((page!.data as { text: string }).text.trim()));
    assert.ok(citations[0].url.includes(old[id]!)); assert.doesNotMatch(result.content, /new synthetic/);
  }
});
test('unapproved releases never substitute the current release or fetch an outside edition', async () => {
  const { env, old } = await setup(); const pins = { ...old, josephus: 'missing' };
  const result = await MORE_RUN.outside_source(env, { resource: 'josephus', key: 'page/1/1' }, undefined, () => {}, line, () => null, pins);
  assert.equal(result.error, true); assert.match(result.content, /No other edition/);
  assert.equal(ResourcePinsSchema.safeParse({ easton: 'v1' }).success, false);
  assert.equal(ResourcePinsSchema.safeParse({ strongs: '../current' }).success, false);
  const defaultPins = await resolveResourcePins(env); assert.notDeepEqual(defaultPins, old);
  assert.equal((await resolveResourcePins(env, { strongs: null })).strongs, null);
});
test('only the approved scan editions map into the resource tools', () => {
  assert.deepEqual(approvedEditionUrl('https://archive.org/download/1889dictionaryofb02smituoft/page/n55_w1200.jpg'), { id: 'smiths-dictionary-of-the-bible', key: 'page/2/55' });
  assert.equal(approvedEditionUrl('https://archive.org/details/another-edition'), null);
  assert.equal(approvedEditionUrl('https://example.invalid/details/completeworksoff05jose'), null);
});
