import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';

const out = new URL('./.build/ask-sources.mjs', import.meta.url).pathname;
await build({
  entryPoints: [new URL('../src/ai.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'agent-fixture', setup(b) {
    b.onResolve({ filter: /approved-answers\.json$/ }, () => ({ path: 'approved-data', namespace: 'approved-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'approved-fixture' }, () => ({ loader: 'json', contents: JSON.stringify({ answers: [{ id: 'approved-fixture', questions: ['Owner approved fixture'], answer: 'The owner approved this fixture answer.', sources: [{ kind: 'web', title: 'Approved attachment', url: 'https://example.test/approved' }] }] }) }));
    b.onResolve({ filter: /^\.\/agent$/ }, () => ({ path: 'agent', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      export async function runAgent(env, question, history, first, retrieve, emit) {
        env.fixtureQuestion = question;
        emit({ status: 'Reading sources' });
        emit({ delta: env.fixtureAnswer });
        return { text: env.fixtureAnswer, passages: env.fixtureSources, actions: [], cut: false };
      }
    ` }));
  } }],
});
const { ask, askStream, freeModel, answerApp, answerAppAgent } = await import(out);

test('owner-approved attachments survive without bracket citations on JSON, NDJSON and native paths', async () => {
  const question = 'Owner approved fixture';
  const json = await answerApp({}, question, 'owner');
  const agent = await answerAppAgent({}, question, 'owner');
  const stream = (await (await askStream({}, question, 77)).text()).trim().split('\n').map(JSON.parse).find(event => event.done);
  for (const result of [json, agent, stream]) {
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].title, 'Approved attachment');
    assert.deepEqual(result.unsupported_refs, []);
  }
});

for (const stream of [false, true]) {
  test(`${stream ? 'NDJSON' : 'JSON'} exposes unsupported refs and never attaches uncited first-four sources`, async t => {
    const { env } = financialDb(t), model = freeModel(env);
    Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureSources: [
      { kind: 'web', title: 'First recorded source', url: 'https://example.test/first', text: 'Existing first source words.' },
      { kind: 'web', title: 'Second recorded source', url: 'https://example.test/second', text: 'Existing second source words.' },
    ] });
    for (const [answer, ids, unsupported] of [
      ['An answer with no citation.', [], []],
      ['An unsupported answer [99].', [], ['[99]']],
      ['Grouped evidence [2, 1, 2], invalid [0] and mixed [1, 99].', [2, 1], ['[0]', '[1, 99]']],
    ]) {
      env.fixtureAnswer = answer;
      const result = stream
        ? (await (await askStream(env, 'Check the recorded citations', 77, undefined, [], undefined, false, model.id, [model.provider])).text()).trim().split('\n').map(JSON.parse).find(event => event.done)
        : await ask(env, 'Check the recorded citations', 77, undefined, [], [model.provider]);
      assert.deepEqual(result.sources.map(source => source.n), ids);
      assert.deepEqual(result.unsupported_refs, unsupported);
    }
  });
}

for (const stream of [false, true]) {
  test(`recorded teacher/date reach ${stream ? 'NDJSON' : 'JSON'} video sources without guessing unnamed sources`, async t => {
    const { env } = financialDb(t), model = freeModel(env);
    const fetchBefore = globalThis.fetch, cachesBefore = globalThis.caches;
    t.after(() => { globalThis.fetch = fetchBefore; globalThis.caches = cachesBefore; });
    globalThis.caches = { default: { match: async () => undefined, put: async () => undefined } };
    globalThis.fetch = async url => new URL(url).pathname === '/api/notes/index.json' ? Response.json([{ videoId: 'abcdefghijk', url: '/classes/2012/recorded', teacher: 'Deacon Eythan', date: '2012-07-14' }]) : new Response('', { status: 404 });
    const sources = [{ kind: 'spoken', title: 'Recorded class', video: 'abcdefghijk', t: 65, url: '/classes/2012/recorded', text: 'Existing words.' }, { kind: 'spoken', title: 'Unnamed class', video: 'lmnopqrstuv', t: 0, url: '', text: 'Other existing words.' }];
    Object.assign(env, { DATA_ORIGIN: `https://attribution-${stream}.data.test`, SITE_URL: 'https://cyberjudah.test', CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureAnswer: 'Recorded points [1, 2].', fixtureSources: sources });
    const result = stream ? (await (await askStream(env, 'Explain those recorded points', 77, undefined, [], undefined, false, model.id, [model.provider])).text()).trim().split('\n').map(JSON.parse).find(event => event.done) : await ask(env, 'Explain those recorded points', 77, undefined, [], [model.provider]);
    assert.equal(result.sources[0].teacher, 'Deacon Eythan');
    assert.equal(result.sources[0].date, '2012-07-14');
    assert.equal(result.sources[1].teacher, undefined);
    assert.equal(result.sources[1].date, undefined);
    assert.equal(result.sources[0].text, sources[0].text);
    assert.equal(sources[0].teacher, undefined, 'the original passage is not mutated');
  });

  test(`${stream ? 'NDJSON' : 'JSON'} Ask keeps a long question intact and rejects oversize input before research`, async t => {
    const { env } = financialDb(t), model = freeModel(env);
    Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureAnswer: 'An answer.', fixtureSources: [] });
    const question = `Explain this question ${'with its full context '.repeat(30)}`.trim();
    const invoke = q => stream ? askStream(env, q, 77, undefined, [], undefined, false, model.id, [model.provider]) : ask(env, q, 77, undefined, [], [model.provider]);
    const result = await invoke(question);
    if (stream) await result.text();
    else assert.equal(result.q, question);
    assert.equal(env.fixtureQuestion, question);
    env.fixtureQuestion = null;
    const refused = await invoke('a'.repeat(4001));
    if (stream) { assert.equal(refused.status, 400); assert.equal((await refused.json()).error, 'too-long'); }
    else assert.deepEqual(refused, { ok: false, reason: 'too-long' });
    assert.equal(env.fixtureQuestion, null);
  });
}

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

for (const stream of [false, true]) {
  test(`recorded book originals and exact scans reach normal ${stream ? 'NDJSON' : 'JSON'} sources`, async t => {
    const { env } = financialDb(t);
    const model = freeModel(env);
    const passage = { kind: 'book', title: 'Recorded edition', text: 'Existing OCR words.', url: '/resources/josephus/pinned-release?key=page%2F1%2F45', original: 'https://archive.org/details/recorded-edition', scan: 'https://archive.org/download/recorded-edition/page/n45_w1200.jpg', pdf: { slug: 'josephus', item: 'recorded-volume' } };
    Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureAnswer: 'An answer [1].', fixtureSources: [passage] });
    const result = stream
      ? (await (await askStream(env, 'Read the recorded edition', 77, undefined, [], undefined, false, model.id, [model.provider])).text()).trim().split('\n').map(JSON.parse).find(event => event.done)
      : await ask(env, 'Read the recorded edition', 77, undefined, [], [model.provider]);
    assert.deepEqual(result.sources, [{ ...passage, url: 'https://cyberjudah.io/app/resources/josephus/pinned-release?key=page%2F1%2F45', n: 1, excerpt: passage.text }]);
  });
}

for (const stream of [false, true]) {
  test(`approved library images reach normal ${stream ? 'NDJSON' : 'JSON'} sources without changing their words`, async t => {
    const { env } = financialDb(t);
    const model = freeModel(env);
    const passage = { kind: 'people', title: 'Moses', text: 'Existing source words.', url: '/person/moses-exo-2-10' };
    Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, AUDIO: { head: async () => ({}) }, fixtureAnswer: 'An answer [1].', fixtureSources: [passage] });
    const result = stream
      ? (await (await askStream(env, 'Who was Moses?', 77, undefined, [], undefined, false, model.id, [model.provider])).text()).trim().split('\n').map(JSON.parse).find(event => event.done)
      : await ask(env, 'Who was Moses?', 77, undefined, [], [model.provider]);
    assert.equal(result.answer, env.fixtureAnswer);
    assert.deepEqual(result.sources, [{ ...passage, n: 1, excerpt: passage.text, image: 'https://cyberjudah.io/api/img/people/moses-exo-2-10-256.webp', image_alt: '' }]);
  });
}
