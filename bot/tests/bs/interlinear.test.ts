import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as Schema from 'effect/Schema';
import { bs } from '../../src/bs/index';
import * as Bible from '../upstream/contracts/bibleChapterContract';
import * as Interlinear from '../upstream/contracts/interlinearBibleContract';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const textResource = { kind: 'bible-text', versionId: 'BHG', revision: 'fixture-text', textRevision: 'fixture-text', textSha256: 'a'.repeat(64) };
const tokenResource = { ...textResource, kind: 'interlinear-index', datasetId: 'CYBERJUDAH', language: 'en', revision: 'fixture-tokens' };
const coverage = { books: [1], chaptersByBook: { 1: [1] }, verseCountByBookChapter: { '1-1': 1 } };
const presentation = { startTags: [], layout: [], notes: [], headings: [] };
const token = { id: 1, ordinal: 0, startOffset: 0, length: 2, segments: [{ ordinal: 0, startOffset: 0, length: 2, transliteration: 'ab', lemma: 'אב', morphology: '', gloss: 'fixture', identities: [{ kind: 'strong', code: 'H1' }] }] };
const wire = {
  'text/coverage.json': { resource: textResource, ...coverage, canon: { id: 'protestant-66', orderedBooks: [1] }, versification: 'bible-strong-default' },
  'text/1/1.json': { resource: textResource, book: 1, chapter: 1, verses: [{ number: 1, text: 'אב', presentation }] },
  'en/coverage.json': { resource: tokenResource, ...coverage },
  'en/1/1.json': { resource: tokenResource, book: 1, chapter: 1, verses: [{ number: 1, tokens: [token] }] },
};
function fixture() {
  const assets = new Map(Object.entries(wire).map(([path, data]) => [path, JSON.stringify(data)]));
  assets.set('manifest.json', JSON.stringify({ version: 1, datasetId: 'CYBERJUDAH', textRevision: textResource.textRevision, textSha256: textResource.textSha256, files: Object.fromEntries([...assets].map(([path, body]) => [path, sha(body)])) }));
  const env = { ASSETS: { fetch: async (req: Request) => {
    assert.equal(req.headers.get('authorization'), null);
    assert.equal(req.headers.get('cookie'), null);
    assert.equal(new URL(req.url).origin, 'https://assets.internal');
    const body = assets.get(new URL(req.url).pathname.replace('/bs-data/interlinear/', ''));
    return new Response(body ?? '<html>SPA fallback</html>', { headers: { 'content-type': body ? 'application/json' : 'text/html' } });
  } } };
  return { assets, env };
}
const get = (env: unknown, path: string) => bs.request('https://test' + path, {}, env as any);
const OwnedRevision = Schema.Struct({ ...Interlinear.InterlinearBibleRevisionDto.fields, datasetId: Schema.Literal('CYBERJUDAH') });
const OwnedChapter = Schema.Struct({ ...Interlinear.InterlinearBibleChapterDto.fields, resource: OwnedRevision });
const OwnedCoverage = Schema.Struct({ ...Interlinear.InterlinearBibleCoverageDto.fields, resource: OwnedRevision });

test('owned text and tokens are served online with matching identity and unchanged content', async () => {
  const { env } = fixture();
  for (const [path, schema] of [
    ['/v1/bibles/BHG/coverage', Bible.BibleVersionCoverageDto],
    ['/v1/bibles/BHG/books/1/chapters/1', Bible.BibleChapterDto],
    ['/v1/interlinear-bibles/BHG/languages/en/coverage', OwnedCoverage],
    ['/v1/interlinear-bibles/BHG/languages/en/books/1/chapters/1', OwnedChapter],
  ] as const) {
    const res = await get(env, path), body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    Schema.decodeUnknownSync(schema as Schema.Schema.Any)(body);
    assert.equal((body as any).resource.textSha256, textResource.textSha256);
  }
  const verses = await (await get(env, '/v1/bibles/BHG/verses?references=1-1-1,1-1-1')).json() as any;
  assert.deepEqual(verses.verses, [{ book: 1, chapter: 1, number: 1, text: 'אב' }, { book: 1, chapter: 1, number: 1, text: 'אב' }]);
  const batch = await (await get(env, '/v1/bibles/chapters?versions=BHG,BHG&book=1&chapter=1')).json() as any;
  assert.equal(batch.chapters.length, 1);
});

test('missing publication, changed assets and changed text identities fail closed', async () => {
  for (const mode of ['missing', 'tampered', 'wrong-identity']) {
    const { env, assets } = fixture();
    if (mode === 'missing') assets.delete('manifest.json');
    if (mode === 'tampered') assets.set('en/1/1.json', assets.get('en/1/1.json')!.replace('fixture-tokens', 'other-tokens'));
    if (mode === 'wrong-identity') {
      const manifest = JSON.parse(assets.get('manifest.json')!); manifest.textSha256 = 'b'.repeat(64);
      assets.set('manifest.json', JSON.stringify(manifest));
    }
    const res = await get(env, '/v1/interlinear-bibles/BHG/languages/en/books/1/chapters/1');
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal((await res.json() as any).code, 'INTERLINEAR_PUBLICATION_INACTIVE');
  }
});

test('unsupported languages, absent chapters and invalid references remain distinct', async () => {
  const { env } = fixture();
  for (const [path, status, code] of [
    ['/v1/interlinear-bibles/BHG/languages/fr/coverage', 404, 'INTERLINEAR_UNSUPPORTED'],
    ['/v1/interlinear-bibles/OTHER/languages/en/coverage', 404, 'INTERLINEAR_UNSUPPORTED'],
    ['/v1/interlinear-bibles/BHG/languages/en/books/81/chapters/1', 404, 'INTERLINEAR_CHAPTER_NOT_FOUND'],
    ['/v1/bibles/BHG/books/0/chapters/1', 400, 'INVALID_RESOURCE_REQUEST'],
    ['/v1/bibles/BHG/verses?references=1-1-2', 404, 'BIBLE_VERSES_NOT_FOUND'],
  ] as const) {
    const res = await get(env, path); assert.equal(res.status, status, path); assert.equal((await res.json() as any).code, code);
  }
});

test('every locally generated chapter validates against the consumer contract', { skip: !process.env.BHG_ONLINE_ASSET_ROOT }, async () => {
  const root = resolve(process.env.BHG_ONLINE_ASSET_ROOT!);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  for (const [path, expected] of Object.entries(manifest.files)) {
    const raw = await readFile(resolve(root, path), 'utf8'); assert.equal(sha(raw), expected, path);
    const body = JSON.parse(raw);
    const schema = path.startsWith('en/') ? path.endsWith('coverage.json') ? OwnedCoverage : OwnedChapter : path.endsWith('coverage.json') ? Bible.BibleVersionCoverageDto : Bible.BibleChapterDto;
    Schema.decodeUnknownSync(schema as Schema.Schema.Any)(body);
    assert.equal(body.resource.textSha256, manifest.textSha256);
  }
});
