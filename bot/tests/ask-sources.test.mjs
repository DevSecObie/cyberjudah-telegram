import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { modelOf } from '../../shared/ask-models.mjs';

const out = new URL('./.build/ask-sources.mjs', import.meta.url).pathname;
await build({
  stdin: { contents: 'export * from "./src/ai.ts"; export { grantPayment, ownerOfUser, wallet } from "./src/credits.ts"; export { default as worker } from "./src/index.ts";', resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'agent-fixture', setup(b) {
    b.onResolve({ filter: /approved-answers\.json$/ }, () => ({ path: 'approved-data', namespace: 'approved-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'approved-fixture' }, () => ({ loader: 'json', contents: JSON.stringify({ answers: [{ id: 'approved-fixture', questions: ['Owner approved fixture'], answer: 'The owner approved this fixture answer.', sources: [{ kind: 'web', title: 'Approved attachment', url: 'https://example.test/approved' }] }] }) }));
    b.onResolve({ filter: /^\.\/agent$/ }, () => ({ path: 'agent', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      export async function runAgent(env, question, history, first, retrieve, emit, ctx, uid, model, spend, resources, rounds, cite, control) {
        env.fixtureQuestion = question;
        emit({ status: 'Reading sources' });
        if (env.fixtureCancelMode) {
          spend.call({ input_tokens: 1000, output_tokens: 100 }, model);
          if (['after', 'reset'].includes(env.fixtureCancelMode)) emit({ delta: 'A streamed fixture answer.' });
          if (env.fixtureCancelMode === 'reset') emit({ reset: true });
          env.fixtureStarted?.();
          await new Promise((_resolve, reject) => control.signal.addEventListener('abort', () => reject(control.signal.reason), { once: true }));
        }
        emit({ delta: env.fixtureAnswer });
        return { text: env.fixtureAnswer, passages: env.fixtureSources, actions: [], cut: false };
      }
    ` }));
  } }],
});
const { ask, askStream, freeModel, answerApp, answerAppAgent, grantPayment, ownerOfUser, wallet, worker } = await import(out);

for (const mode of ['before', 'after', 'reset']) {
  test(`paid cancellation ${mode} streamed answer text settles once with the proper charge`, async t => {
    const { env, sql } = financialDb(t), model = modelOf('claude-sonnet-5-5');
    Object.assign(env, { CLAUDE_MODEL: model.id, ANTHROPIC_API_KEY: 'fixture-only', AI: { run: async () => ({ data: [] }) }, fixtureCancelMode: mode });
    const owner = await ownerOfUser(env, 77);
    await grantPayment(env, owner, { charge: `cancel-${mode}`, kind: 'pack', stars: 10, mc: 2_000_000 });
    const pending = [], ctx = { waitUntil: promise => pending.push(promise) };
    const response = await askStream(env, 'Check cancellation charging', 77, ctx, [], undefined, false, model.id, [model.provider], { caps: { [model.id]: 2_000_000 } });
    assert.equal(response.status, 200);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let received = '';
    while (mode === 'after' ? !received.includes('A streamed fixture answer.') : mode === 'reset' ? !received.includes('\"reset\":true') : !received.includes('Reading sources')) received += (await reader.read()).value;
    await reader.cancel();
    await Promise.all(pending);
    const rows = sql.prepare('SELECT status, charged_mc, held_mc FROM credit_usage WHERE user_id = ?').all(owner);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, mode === 'after' ? 'partial' : 'failed');
    assert.equal(rows[0].charged_mc > 0, mode === 'after');
    assert.ok(rows[0].charged_mc <= rows[0].held_mc);
    assert.equal((await wallet(env, owner)).total_mc, 2_000_000 - rows[0].charged_mc);
  });
}

test('a misconfigured primary backup stays free when the reader cancels its text', async t => {
  const { env, sql } = financialDb(t), model = modelOf('claude-sonnet-5-5');
  Object.assign(env, { CLAUDE_MODEL: model.id, AI: { run: async (id, _input, options) => {
    if (id.includes('bge-m3')) return { data: [[1, 2]] };
    return new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ response: 'A free backup fixture answer.', usage: { prompt_tokens: 1000, completion_tokens: 10 } }) + '\n\n'));
      options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true });
    } });
  } }, VEC: { query: async () => ({ matches: [{ score: 0.95, metadata: { kind: 'web', title: 'Recorded material', url: 'https://cyberjudah.io/recorded-fixture', text: 'Existing recorded public words about the source material and its historical context, copied from the supplied fixture without adding any teaching or interpretation.' } }] }) } });
  const owner = await ownerOfUser(env, 77);
  await grantPayment(env, owner, { charge: 'backup-cancel', kind: 'pack', stars: 10, mc: 2_000_000 });
  // The reader agreed to the backup's provider too: only then may the backup answer (backup-answer.ts mayUseBackup).
  const pending = [], response = await askStream(env, 'Read recorded material', 77, { waitUntil: promise => pending.push(promise) }, [], undefined, false, model.id, [model.provider, 'Cloudflare (Workers AI)'], { caps: { [model.id]: 2_000_000 } });
  assert.equal(response.status, 200);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  while (!text.includes('A free backup fixture answer.')) text += (await reader.read()).value;
  await reader.cancel();
  await Promise.all(pending);
  const row = sql.prepare('SELECT status, charged_mc FROM credit_usage WHERE user_id = ?').get(owner);
  assert.equal(row.status, 'failed');
  assert.equal(row.charged_mc, 0);
  assert.equal((await wallet(env, owner)).total_mc, 2_000_000);
});

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

test('a final line citing seven long notes stays under the Mini App\'s 256 KiB frame, with previews and lengths', async t => {
  const { env } = financialDb(t), model = freeModel(env);
  const long = (i) => (`Note ${i}: ` + 'recorded words of a long class note '.repeat(1200)).slice(0, 40_000);
  const sources = Array.from({ length: 7 }, (_, i) => ({ kind: 'web', title: `Long note ${i + 1}`, url: `https://cyberjudah.io/notes/long-${i + 1}`, text: long(i + 1) }));
  Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureAnswer: 'Seven notes agree [1, 2, 3, 4, 5, 6, 7].', fixtureSources: sources });
  const lines = (await (await askStream(env, 'Compare the seven long notes', 77, undefined, [], undefined, false, model.id, [model.provider])).text()).trim().split('\n');
  const doneLine = lines.find(l => JSON.parse(l).done);
  assert.ok(sources.reduce((n, s) => n + s.text.length, 0) > 256 * 1024, 'the full texts alone would pass the limit');
  for (const l of lines) assert.ok(new TextEncoder().encode(l).length < 256 * 1024, `a line of ${l.length} chars`);
  const done = JSON.parse(doneLine);
  assert.equal(done.answer, 'Seven notes agree [1, 2, 3, 4, 5, 6, 7].');
  assert.deepEqual(done.sources.map(s => s.n), [1, 2, 3, 4, 5, 6, 7]);
  for (const [i, s] of done.sources.entries()) {
    assert.equal(s.text, sources[i].text.slice(0, 1000), 'a preview of the start of the text');
    assert.equal(s.excerpt, s.text);
    assert.equal(s.text_chars, 40_000);
    assert.equal(s.truncated, true);
    assert.equal(s.url, sources[i].url, 'the full source stays one tap away');
  }
  assert.equal(sources[0].text.length, 40_000, 'the passages themselves are not cut');
});

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

// A streamed line cuts a long source's text to a preview and says how long it was (ask-frame.ts).
const streamed = (stream, s) => stream && s.text.length > 1000 ? { ...s, text: s.text.slice(0, 1000), text_chars: s.text.length, truncated: true } : s;

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
    assert.deepEqual(result.sources, [2, 1, 4].map(n => streamed(stream, { ...passages[n - 1], n, excerpt: passages[n - 1].text.slice(0, 1000) })));
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
    assert.deepEqual(result.sources, [streamed(stream, { ...passage, url: 'https://cyberjudah.io/app/resources/josephus/pinned-release?key=page%2F1%2F45', n: 1, excerpt: passage.text })]);
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
    assert.deepEqual(result.sources, [streamed(stream, { ...passage, n: 1, excerpt: passage.text, image: 'https://cyberjudah.io/api/img/people/moses-exo-2-10-256.webp', image_alt: '' })]);
  });
}


test('non-stream Ask forwards cancellation and never charges for internally buffered deltas', async t => {
  assert.match(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'), /"compatibility_flags":\s*\[[^\]]*"enable_request_signal"/);
  const { env, sql } = financialDb(t), model = modelOf('claude-sonnet-5-5');
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  Object.assign(env, { CLAUDE_MODEL: model.id, ANTHROPIC_API_KEY: 'fixture-only', AI: { run: async () => ({ data: [] }) }, fixtureCancelMode: 'after', fixtureStarted: started });
  const owner = await ownerOfUser(env, 77);
  await grantPayment(env, owner, { charge: 'nonstream-cancel', kind: 'pack', stars: 10, mc: 2_000_000 });
  const params = { user: JSON.stringify({ id: 77, first_name: 'Fixture' }), auth_date: String(Math.floor(Date.now()/1000)) };
  const check = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const controller = new AbortController(), pending = [];
  const response = worker.fetch(new Request('https://example.test/api/ask', { method: 'POST', headers: { authorization: `tma ${new URLSearchParams({ ...params, hash })}`, 'content-type': 'application/json' }, body: JSON.stringify({ q: 'Read recorded material', model: model.id, consent: [model.provider], caps: { [model.id]: 2_000_000 } }), signal: controller.signal }), env, { waitUntil: promise => pending.push(promise) });
  await ready; controller.abort();
  assert.equal((await response).status, 503);
  await Promise.all(pending);
  const row = sql.prepare('SELECT charged_mc FROM credit_usage WHERE user_id = ?').get(owner);
  assert.equal(row.charged_mc, 0);
});

test('Mini App JSON and stream responses issue fresh owner-bound receipts for actual final citation IDs', async t => {
  const { env, sql } = financialDb(t), model = freeModel(env);
  Object.assign(env, { CLAUDE_MODEL: model.id, AI_GATEWAY: 'fixture', AI: { run: async () => ({ data: [] }) }, fixtureAnswer: 'Recorded fixture words [100].', fixtureSources: [{ n: 100, kind: 'web', title: 'Recorded source', url: 'https://example.test/source', text: 'Existing source words.' }] });
  const params = { user: JSON.stringify({ id: 77, first_name: 'Fixture' }), auth_date: String(Math.floor(Date.now()/1000)) };
  const check = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const ids = [];
  for (const choice of [{}, { model: model.id }, { stream: true }]) {
    const pending = [], response = await worker.fetch(new Request('https://example.test/api/ask', { method: 'POST', headers: { authorization: `tma ${new URLSearchParams({ ...params, hash })}`, 'content-type': 'application/json' }, body: JSON.stringify({ q: 'Check final citation receipts', consent: [model.provider], ...choice }) }), env, { waitUntil: promise => pending.push(promise) });
    assert.equal(response.status, 200);
    const result = choice.stream ? (await response.text()).trim().split('\n').map(JSON.parse).find(event => event.done) : await response.json();
    assert.match(result.answer_id, /^[a-f0-9-]{36}$/);
    assert.deepEqual(result.sources.map(source => source.n), [100]);
    const receipt = sql.prepare('SELECT source_ns FROM ask_answer_receipts WHERE id = ?').get(result.answer_id);
    assert.deepEqual(JSON.parse(receipt.source_ns), [100]);
    ids.push(result.answer_id);
    await Promise.all(pending);
  }
  assert.equal(new Set(ids).size, 3);
});

test('a backup answer names its model only when a model wrote it; the no-budget notice names none', async t => {
  for (const budget of ['0', '1']) {
    // A Claude model with no Claude access answers through the backup (ai.ts), as when Claude is down.
    const { env } = financialDb(t), model = modelOf('claude-sonnet-5-5');
    Object.assign(env, { ASK_BILLING: 'off', CLAUDE_MODEL: model.id, ASK_FREE_DAILY_USD_CAP: budget, ASK_FREE_MAX_USD: '0.05', AI: { run: async (id) => id.includes('bge-m3') ? { data: [[1, 2]] } : new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: 'Backup words [1].', usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\n`)); c.close(); } }) },
      VEC: { query: async () => ({ matches: [{ score: 0.95, metadata: { kind: 'web', title: 'Recorded material', url: 'https://cyberjudah.io/recorded-fixture', text: 'Existing recorded public words about the source material and its historical context, copied from the supplied fixture without adding any teaching or interpretation.' } }] }) } });
    delete env.AI_GATEWAY; delete env.ANTHROPIC_API_KEY;
    const lines = (await (await askStream(env, 'Read recorded material', 77, undefined, [], undefined, false, model.id, [model.provider, 'Cloudflare (Workers AI)'], { caps: { [model.id]: 500_000 } })).text()).trim().split('\n').map(JSON.parse);
    const done = lines.find(l => l.done);
    assert.ok(done, `${budget}: ${JSON.stringify(lines.slice(-2))}`);
    assert.equal(done.sources.length > 0, true, `${budget}: the backup path, not the nothing-found sentence`);
    if (budget === '0') {
      assert.match(done.answer, /can't generate a new answer right now/);
      assert.equal(done.model, undefined, 'the fixed notice and excerpts were written by no model');
    } else {
      assert.equal(done.answer, 'Backup words [1].');
      assert.equal(done.model, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    }
  }
});

// A reader who agreed only to Claude's provider is never sent to Workers AI when Claude cannot answer
// (OWASP LLM02; the consent promise): the question reaches no backup model, and the reader is told.
test('without agreement to the backup provider, no backup answer is written and the question is not sent to it', async t => {
  for (const stream of [true, false]) {
    const { env } = financialDb(t), model = modelOf('claude-sonnet-5-5'), sent = [];
    Object.assign(env, { ASK_BILLING: 'off', CLAUDE_MODEL: model.id, AI: { run: async (id) => { if (id.includes('bge-m3')) return { data: [[1, 2]] }; sent.push(id); return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ response: 'Backup words [1].' })}\n\n`)); c.close(); } }); } },
      VEC: { query: async () => ({ matches: [{ score: 0.95, metadata: { kind: 'web', title: 'Recorded material', url: 'https://cyberjudah.io/recorded-fixture', text: 'Existing recorded public words about the source material and its historical context, copied from the supplied fixture without adding any teaching or interpretation.' } }] }) } });
    delete env.AI_GATEWAY; delete env.ANTHROPIC_API_KEY;
    if (stream) {
      const lines = (await (await askStream(env, 'Read recorded material', 77, undefined, [], undefined, false, model.id, [model.provider], { caps: { [model.id]: 500_000 } })).text()).trim().split('\n').map(JSON.parse);
      assert.equal(lines.find(l => l.done), undefined, 'no answer');
      assert.deepEqual(lines.at(-1), { error: 'unavailable' });
      assert.ok(!lines.some(l => typeof l.delta === 'string' && l.delta.includes('Backup words')));
    } else {
      assert.deepEqual(await ask(env, 'Read recorded material', 77, undefined, [], [model.provider]), { ok: false, reason: 'unavailable' });
    }
    assert.deepEqual(sent, [], `${stream ? 'askStream' : 'ask'}: the backup model was never called`);
  }
});
