import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';

const out = new URL('./.build/ask-sources.mjs', import.meta.url).pathname;
await build({
  entryPoints: [new URL('../src/ai.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'agent-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/agent$/ }, () => ({ path: 'agent', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      export async function runAgent(env, question, history, first, retrieve, emit) {
        emit({ status: 'Reading sources' });
        emit({ delta: env.fixtureAnswer });
        return { text: env.fixtureAnswer, passages: env.fixtureSources, actions: [], cut: false };
      }
    ` }));
  } }],
});
const { ask, askStream, freeModel } = await import(out);

for (const stream of [false, true]) {
  test(`normal ${stream ? 'streamed' : 'one-piece'} Ask includes bounded excerpts with source attribution`, async t => {
    const { env } = financialDb(t);
    const model = freeModel(env);
    const passages = [
      { kind: 'web', title: 'Outside history', url: 'https://example.test/history', sub: 'Historical context', text: 'A short historical passage.' },
      { kind: 'book', title: 'Original edition', url: 'https://example.test/book', text: 'Original text. '.repeat(100) },
      { kind: 'web', title: 'Not cited', url: 'https://example.test/unused', text: 'Uncited passage.' },
      { kind: 'spoken', title: 'Class recording', url: '/classes/history', video: 'recording', t: 42, text: '' },
    ];
    Object.assign(env, {
      CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture',
      AI: { run: async () => ({ data: [] }) },
      fixtureAnswer: 'The original edition [2] and the outside history [1], with a class [4].',
      fixtureSources: passages,
    });
    let result;
    if (stream) {
      const response = await askStream(env, 'Explain the historical sources', 77, undefined, [], undefined, false, model.id, [model.provider]);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
      const events = (await response.text()).trim().split('\n').map(JSON.parse);
      assert.deepEqual(events[0], { status: 'Reading sources' });
      assert.deepEqual(events[1], { delta: env.fixtureAnswer });
      result = events.find(event => event.done);
      assert.ok(result);
    } else {
      result = JSON.parse(JSON.stringify(await ask(env, 'Explain the historical sources', 77, undefined, [], [model.provider])));
      assert.equal(result.ok, true);
    }
    assert.equal(result.answer, env.fixtureAnswer);
    assert.deepEqual(result.sources, [2, 1, 4].map(n => ({ ...passages[n - 1], n, excerpt: passages[n - 1].text.slice(0, 1000) })));
    assert.equal(result.sources[0].excerpt.length, 1000);
    assert.equal(result.sources[1].excerpt, passages[0].text);
    assert.equal(result.sources[2].excerpt, '');
    assert.ok(passages.every(passage => !('excerpt' in passage)), 'source passages are not mutated');
  });
}
