import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.build/ask-source-pictures.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/ask-source-pictures.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { withAskSourcePictures } = await import(out);
const source = (url, kind = 'people') => ({ n: 7, kind, title: 'Existing source label', text: 'The existing source words.', excerpt: 'The existing source words.', url });

test('approved portraits match stable identities, preserve source text, and use only existing image files', async () => {
  const asked = [], input = source('/person/moses-exo-2-10');
  const env = { AUDIO: { head: async key => { asked.push(key); return {}; } } };
  const result = await withAskSourcePictures(env, [input, { ...input, n: 8 }]);
  assert.deepEqual(asked, ['images/people/moses-exo-2-10-256.webp']);
  assert.deepEqual(result[0], { ...input, image: 'https://cyberjudah.io/api/img/people/moses-exo-2-10-256.webp', image_alt: '' });
  assert.equal(result[1].n, 8);
  assert.ok(!('image' in input));
});

test('timeline events use their exact approved portrait or registered library leader photo', async () => {
  const env = { AUDIO: { head: async () => ({}) } };
  const result = await withAskSourcePictures(env, [source('/timeline/event/moses', 'timeline'), source('/timeline/event/iuic-founded-2003', 'timeline')]);
  assert.match(result[0].image, /\/people\/moses-exo-2-10-256\.webp$/);
  assert.equal(result[0].text, 'The existing source words.');
  assert.equal(result[1].image, 'https://cyberjudah.io/api/img/timeline/leaders/bishop-nathanyel-256.webp');
  assert.equal(result[1].credit, 'Israel United in Christ');
});

test('held-back, ambiguous, unknown and externally sourced portraits have no substitute', async () => {
  const input = [
    source('/person/naamah-gen-4-22'), source('/person/cain-gen-4-1'),
    source('/person/not-a-library-person'), source('/timeline/event/lamech', 'timeline'),
    source('/timeline/event/julius-caesar', 'timeline'), source('/person/herod-mat-14-1'),
    source('/person/augustus-luk-2-1'), source('/timeline/event/martin-luther', 'timeline'),
    source('/place/jerusalem', 'place'), source('https://en.wikipedia.org/person/moses-exo-2-10', 'web'),
    source('/unrelated/moses-exo-2-10'), source('https://cyberjudah.io.evil.test/person/moses-exo-2-10'),
  ];
  const env = { AUDIO: { head: async () => { assert.fail('unapproved images must not be read'); } } };
  assert.deepEqual(await withAskSourcePictures(env, input), input);
});

test('Telegram alone cites existing person and timeline tool text, without adding narrative', async () => {
  const agentOut = new URL('./.build/ask-picture-agent.mjs', import.meta.url).pathname;
  await build({ entryPoints: [new URL('../src/agent.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: agentOut, logLevel: 'error', plugins: [{ name: 'research-fixtures', setup(b) {
    b.onResolve({ filter: /^\.\/agent-open$/ }, () => ({ path: 'research', namespace: 'fixture' }));
    b.onResolve({ filter: /^\.\/ask-tools$/ }, () => ({ path: 'tools', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'tools' ? `
      export const MORE_TOOLS = [];
      export const MORE_RUN = { person: async (env, input, ctx, emit, line) => ({ content: line('Moses', env.words, '/person/moses-exo-2-10') }) };
    ` : `
      export async function researchOpen(env, model, system, messages, defs, schemas, run) {
        env.toolResult = await run('person', {});
        return { text: 'An answer [1].', units: 0, calls: 1, cut: false, refused: false };
      }
    ` }));
  } }] });
  const { runAgent } = await import(agentOut);
  const env = { ANTHROPIC_API_KEY: 'local-test-only', words: 'The exact existing library source text.' };
  const model = { id: 'fixture-free', format: 'chat' };
  const run = flag => runAgent(env, 'Who was Moses?', [], [], async () => [], () => {}, undefined, undefined, model, undefined, undefined, undefined, flag);
  assert.deepEqual((await run(undefined)).passages, [], 'native callers retain the existing behavior');
  const result = await run(true);
  assert.deepEqual(result.passages, [{ n: 1, kind: 'people', title: 'Moses', text: env.words, url: '/person/moses-exo-2-10' }]);
  assert.equal(env.toolResult.content, `[1] Moses: ${env.words} Link: /person/moses-exo-2-10`);
});

test('missing images, storage errors and a successful HTML fallback leave the answer intact', async () => {
  const input = [source('/person/moses-exo-2-10')];
  for (const env of [
    {}, { AUDIO: { head: async () => null } },
    { AUDIO: { head: async () => { throw new Error('offline'); } } },
    { ASSETS: { fetch: async () => new Response('<html>app shell</html>', { headers: { 'content-type': 'text/html' } }) } },
  ]) assert.deepEqual(await withAskSourcePictures(env, input), input);
});

test('a matching bundled WebP is accepted, without fetching an outside image', async () => {
  const paths = [];
  const env = { ASSETS: { fetch: async request => { paths.push([new URL(request.url).pathname, request.method]); return new Response(null, { headers: { 'content-type': 'image/webp' } }); } } };
  const [result] = await withAskSourcePictures(env, [source('https://cyberjudah.io/person/moses-exo-2-10')]);
  assert.deepEqual(paths, [['/app/people/moses-exo-2-10-256.webp', 'HEAD']]);
  assert.equal(result.image, 'https://cyberjudah.io/app/people/moses-exo-2-10-256.webp');
});

test('arbitrary incoming image fields and invented captions or credits are never forwarded', async () => {
  const input = { ...source('https://example.test/article', 'web'), image: 'https://commons.wikimedia.org/image.jpg', image_alt: 'Invented caption', credit: 'Invented maker' };
  assert.deepEqual(await withAskSourcePictures({}, [input]), [source(input.url, 'web')]);
});
