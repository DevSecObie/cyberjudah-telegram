import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { modelOf } from '../../shared/ask-models.mjs';

// read_scripture against a stand-in chapter of 176 numbered verses (the words are placeholders,
// not Scripture) and one of 5.
const out = new URL('./.build/ask-scripture-chapter.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { runAgent, CHAPTER_READ_VERSES } from "./src/agent.ts";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/(providers|resource-tools|ask-tools|data)$/ }, args => args.importer.endsWith('/agent.ts') ? { path: args.path.slice(2), namespace: 'fixture' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
    providers: 'export async function claude(env) { return env.client ?? {}; }',
    'resource-tools': 'export async function resolveResourcePins() { return {}; }',
    'ask-tools': 'export const MORE_TOOLS=[]; export const MORE_RUN={};',
    data: 'export async function dataJson() { return null; } export async function books() { return [{book:"Psalms",slug:"psalms",chapters:150},{book:"Jude",slug:"jude",chapters:1}]; } export async function chapter(env, slug) { const n = slug === "psalms" ? 176 : 5; return { verses: Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `placeholder ${i + 1}` })) }; }',
  }[args.path] }));
} }] });
const { runAgent, CHAPTER_READ_VERSES } = await import(out);

async function read(...references) {
  const requests = [];
  const env = { AI_GATEWAY: 'fixture', DATA_ORIGIN: 'https://data.test', SITE_URL: 'https://site.test', AI: { run: async (_m, input) => {
    requests.push(structuredClone(input));
    return requests.length === 1 ? { response: '', tool_calls: references.map(reference => ({ name: 'read_scripture', arguments: { reference } })), usage: { prompt_tokens: 1, completion_tokens: 1 } } : { response: 'Read [1].', usage: { prompt_tokens: 1, completion_tokens: 1 } };
  } } };
  const result = await runAgent(env, 'Read it', [], [], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'));
  // Tool output reaches the model wrapped as untrusted data (grounding.mjs); read the content back.
  const content = requests[1].messages.filter(m => m.role === 'tool').map(m => JSON.parse(/```json\n([\s\S]*)\n```/.exec(m.content)[1]).content).join('\n');
  return { content, passages: result.passages };
}

test('a long chapter without a range reads the first part, gives the verse count and what to read next', async () => {
  const { content, passages } = await read('Psalms 119');
  assert.match(content, /Psalms 119:1-40 \(KJV\)/);
  assert.match(content, /\n40 placeholder 40\n/);
  assert.doesNotMatch(content, /\n41 placeholder 41/);
  assert.match(content, /Verses 1-40 of Psalms 119, which ends at verse 176\. The chapter is not finished: read "Psalms 119:41-80" next/);
  assert.equal(passages[0].title, 'Psalms 119:1-40', 'the source is labelled with what was read, not the whole chapter');
  assert.equal(CHAPTER_READ_VERSES, 40);
});

test('the continuation reads on, and the last part names the end of the chapter', async () => {
  const middle = await read('Psalms 119:41-80');
  assert.match(middle.content, /Psalms 119:41-80 \(KJV\)\n41 placeholder 41/);
  assert.match(middle.content, /\(Psalms 119 ends at verse 176; to read on, read "Psalms 119:81-120"\.\)/);
  assert.equal(middle.passages[0].text.split('\n').length, 40, 'the source holds every verse it is labelled with');
  const end = await read('Psalms 119:161-200');
  assert.match(end.content, /Psalms 119:161-176 \(KJV\)/);
  assert.match(end.content, /176 placeholder 176/);
  assert.match(end.content, /\(Psalms 119 ends at verse 176\.\)/);
});

test('a short chapter is read whole and says so', async () => {
  const { content, passages } = await read('Jude 1');
  assert.match(content, /Jude 1 \(KJV\)/);
  assert.match(content, /\(All of Jude 1, verses 1-5\.\)/);
  assert.equal(passages[0].title, 'Jude 1');
});

test('verses past the end of a chapter say how many it has', async () => {
  assert.match((await read('Jude 1:9')).content, /has no such verses\. Jude 1 ends at verse 5\./);
});

test('each part of a chapter read in one study is its own source', async () => {
  const { content, passages } = await read('Psalms 119', 'Psalms 119:41-80');
  assert.deepEqual(passages.map(p => [p.n, p.title]), [[1, 'Psalms 119:1-40'], [2, 'Psalms 119:41-80']]);
  assert.match(content, /\[2\] Psalms 119:41-80 \(KJV\)/);
  assert.ok(passages[1].text.startsWith('41 placeholder 41'));
});
