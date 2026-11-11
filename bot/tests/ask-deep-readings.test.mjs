import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { modelOf } from '../../shared/ask-models.mjs';
import { mergePassages } from '../../shared/ask-stream.mjs';

const out = new URL('./.build/ask-deep-readings.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { runAgent } from "./src/agent.ts"; export { readForAsk } from "./src/ask-readers.ts"; export { makeSpend } from "./src/spend.ts";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'public-reading-fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/(providers|resource-tools|ask-tools|data|teachings|bs)$/ }, args => {
    const parent = args.importer.split('/').at(-1), name = args.path.slice(2);
    if (parent === 'agent.ts' && ['providers', 'resource-tools', 'ask-tools', 'data'].includes(name) || parent === 'class-attribution.ts' && name === 'data' || parent === 'public-reading.ts' && ['data', 'teachings', 'bs'].includes(name)) return { path: name, namespace: 'fixture' };
  });
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
    providers: 'export async function claude(env) { return env.client ?? {}; }',
    'resource-tools': 'export async function resolveResourcePins() { return {}; }',
    'ask-tools': 'export const MORE_TOOLS=[]; export const MORE_RUN={};',
    data: 'export async function dataJson(env,path) { env.reads.push(path); return env.data[path] ?? null; } export async function books() { return [{book:"Exodus",slug:"exodus",chapters:40}]; } export async function chapter() { return null; }',
    teachings: 'export async function transcriptAround(env) { return env.transcript; } export async function captionCorrections() { return []; } export async function searchTeachings(env) { return env.classes; }',
    bs: 'export const bs={request:async (url,init,env)=>Response.json({content:env.commentary})};',
  }[args.path] }));
} }] });
const { runAgent, readForAsk, makeSpend } = await import(out);
const video = 'abcdefghijk', path = '/classes/2026/recorded-class';
const body = 'Original published note words. '.repeat(1800) + 'The recorded ending.';
function fixture() {
  const requests = [], events = [];
  const env = { reads: [], DATA_ORIGIN: 'https://data.cyberjudah.test', SITE_URL: 'https://cyberjudah.test', AI_GATEWAY: 'fixture', data: { [`/api/notes${path}.json`]: { title: 'Recorded Class', teacher: 'Recorded teacher', date: '2026-10-31', videoId: video, body }, '/api/cases/index.json': { cases: [{ name: 'Existing case' }] } }, transcript: { ok: true, title: 'Recorded Class', date: '2026-10-31', url: path, chunks: [{ t: 60, text: 'The original captions, word for word.' }, { t: 90, text: 'More recorded caption words.' }] }, classes: { ok: true, hits: [{ title: 'Recorded Class', date: '2026-10-31', feed: 'classes', video, start: 65, excerpt: 'A short original excerpt.', note: path }], more: false }, commentary: '<p>Existing published commentary words.</p>' };
  return { env, requests, events };
}

test('Ask reads full note parts, real transcript windows, classes, commentary and public data as numbered sources', async () => {
  const f = fixture();
  f.env.AI = { run: async (_model, input) => {
    f.requests.push(structuredClone(input));
    if (f.requests.length === 1) return { response: '', tool_calls: [
      { name: 'read_note', arguments: { path } }, { name: 'read_note', arguments: { path, offset: 40000 } },
      { name: 'read_transcript', arguments: { video, at: 65, span: 600 } },
      { name: 'search_classes', arguments: { query: 'recorded words' } },
      { name: 'commentary', arguments: { reference: 'Exodus 12:14' } },
      { name: 'read_data', arguments: { path: 'api/cases/index.json' } },
    ], usage: { prompt_tokens: 100, completion_tokens: 50 } };
    return { response: 'Retrieved material [1, 2, 3, 4, 5].', usage: { prompt_tokens: 1500, completion_tokens: 30 } };
  } };
  const result = await runAgent(f.env, 'Read the existing material deeply', [], [], async () => [], event => f.events.push(event), undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'));
  assert.equal(result.calls, 2, 'the agent finishes when the research is complete');
  assert.equal(result.passages.length, 5, 'the same class moment is not duplicated by a later search');
  assert.ok(result.passages[0].text.length > 40000);
  assert.equal(result.passages[0].teacher, 'Recorded teacher');
  assert.ok(result.passages[1].text.includes('The recorded ending.'));
  assert.ok(result.passages[2].text.includes(f.env.transcript.chunks[0].text));
  assert.equal(result.passages[2].video, video);
  assert.equal(result.passages[2].t, 65);
  assert.ok(result.passages[3].text.includes('Existing published commentary words.'));
  assert.equal(result.passages[4].url, 'https://data.cyberjudah.test/api/cases/index.json');
  assert.deepEqual(result.passages.map(source => source.n), [1, 2, 3, 4, 5]);
  assert.ok(f.requests[1].messages.filter(message => message.role === 'tool').every(message => /Sources for this reading: \[\d+\]/.test(message.content)));
  assert.ok(f.requests[0].max_tokens > 4096);
});

test('invalid reading paths, video IDs and pagination never reach the public data source', async () => {
  const f = fixture();
  for (const [name, input] of [['read_note', { path: 'https://evil.test/a' }], ['read_note', { path: '/../secret' }], ['read_note', { path, offset: 1.5 }], ['read_data', { path: 'api/../secret.json' }], ['read_data', { path: 'https://evil.test/a.json' }], ['read_transcript', { video: '../secret', at: 0 }], ['read_transcript', { video, at: -1 }]]) {
    const result = await readForAsk(name, input, f.env);
    assert.equal(result.isError, true);
  }
  assert.deepEqual(f.env.reads, []);
});

test('a longer transcript reading extends an existing snippet without changing its citation number', async () => {
  const f = fixture();
  f.env.AI = { run: async (_model, input) => {
    f.requests.push(structuredClone(input));
    return f.requests.length === 1 ? { response: '', tool_calls: [{ name: 'read_transcript', arguments: { video, at: 65 } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } : { response: 'The recorded words [1].', usage: { prompt_tokens: 200, completion_tokens: 10 } };
  } };
  const result = await runAgent(f.env, 'Read the actual recording', [], [{ kind: 'spoken', title: 'Snippet title', video, t: 60, url: path, text: 'Short snippet.' }], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'));
  assert.equal(result.passages.length, 1);
  assert.equal(result.passages[0].n, 1);
  assert.equal(result.passages[0].title, 'Recorded Class');
  assert.ok(result.passages[0].text.includes('The original captions, word for word.'));
});

test('native Opus can research past six rounds with bounded output/high thinking, preserving thinking blocks', async () => {
  const f = fixture(), thought = { type: 'thinking', thinking: '', signature: 'recorded-signature' };
  f.env.client = { messages: { stream(input) {
    f.requests.push(structuredClone(input));
    let emit;
    const done = f.requests.length === 8;
    return { on(_event, handler) { emit = handler; }, async finalMessage() {
      if (done) emit('A supported answer [1].');
      return { content: done ? [{ type: 'text', text: 'A supported answer [1].' }] : [thought, { type: 'tool_use', id: `read-${f.requests.length}`, name: 'read_note', input: { path } }], stop_reason: done ? 'end_turn' : 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
    } };
  } } };
  const result = await runAgent(f.env, 'Research the full recorded material', [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.calls, 8);
  assert.equal(result.cut, false);
  assert.ok(f.requests.every(request => request.max_tokens === 12000));
  assert.ok(f.requests.every(request => request.output_config.effort === 'high' && request.thinking.type === 'adaptive'));
  assert.deepEqual(f.requests[1].messages.at(-2).content[0], thought);
});

test('the default research loop has a 25-round runaway guard and can cite more than 48 sources', async () => {
  const f = fixture();
  f.env.client = { messages: { stream(input) {
    f.requests.push(structuredClone(input));
    let emit;
    const done = input.tool_choice?.type === 'none';
    return { on(_event, handler) { emit = handler; }, async finalMessage() {
      if (done) emit('The retrieved source [51].');
      return { content: done ? [{ type: 'text', text: 'The retrieved source [51].' }] : [{ type: 'tool_use', id: `read-${f.requests.length}`, name: 'read_note', input: { path } }], stop_reason: done ? 'end_turn' : 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
    } };
  } } };
  const first = Array.from({ length: 50 }, (_, index) => ({ kind: 'note', title: `Existing source ${index}`, url: `/existing/${index}`, text: 'Existing original words.' }));
  const result = await runAgent(f.env, 'Read the library', [], first, async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.calls, 25);
  assert.equal(result.passages.length, 51);
  assert.equal(result.passages[50].n, 51);
});

test('missing Claude usage stops further paid rounds rather than spending an unknown balance', async () => {
  const f = fixture();
  f.env.client = { messages: {
    async countTokens() { return { input_tokens: 100 }; },
    stream(input) {
      f.requests.push(structuredClone(input));
      return { on() {}, async finalMessage() { return { content: [{ type: 'tool_use', id: 'read-1', name: 'read_note', input: { path } }], stop_reason: 'tool_use' }; } };
    },
  } };
  const result = await runAgent(f.env, 'Read the recorded class', [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'), makeSpend({ budgetUsd: 5 }));
  assert.equal(f.requests.length, 1);
  assert.equal(result.cut, true);
});

test('newly opened transcript sources and tool results use only the recorded class teacher and date', async () => {
  const f = fixture();
  f.env.DATA_ORIGIN = 'https://recorded-teacher.data.test';
  f.env.data['/api/notes/index.json'] = [{ url: path, videoId: video, teacher: 'Deacon Eythan', date: '2012-07-14' }];
  f.env.AI = { run: async (_model, input) => {
    f.requests.push(structuredClone(input));
    return f.requests.length === 1 ? { response: '', tool_calls: [{ name: 'read_transcript', arguments: { video, at: 65 } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } : { response: 'The recorded teaching [1].', usage: { prompt_tokens: 200, completion_tokens: 10 } };
  } };
  const result = await runAgent(f.env, 'Explain this teaching', [], [], async () => [], event => f.events.push(event), undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'));
  assert.equal(result.passages[0].teacher, 'Deacon Eythan');
  assert.equal(result.passages[0].date, '2012-07-14');
  const reading = f.requests[1].messages.find(message => message.role === 'tool').content;
  assert.match(reading, /\[1\] Recorded Class \(2012-07-14\) \(taught by Deacon Eythan\)/);
  assert.equal(f.events.findLast(event => event.passages_delta).passages_delta[0].teacher, 'Deacon Eythan');
});

test('25-round research streams each preview once and keeps full readings out of progress packets', async () => {
  const f = fixture();
  const fullText = 'Existing published words. '.repeat(1700);
  for (let index = 1; index < 25; index++) f.env.data[`/api/notes/classes/2026/reading-${index}.json`] = { title: `Recorded source ${index}`, body: fullText };
  f.env.client = { messages: { stream(input) {
    f.requests.push(structuredClone(input));
    const round = f.requests.length, done = round === 25;
    let emit;
    return { on(_name, handler) { emit = handler; }, async finalMessage() {
      if (done) emit('Recorded evidence [25].');
      return { content: done ? [{ type: 'text', text: 'Recorded evidence [25].' }] : [{ type: 'tool_use', id: `read-${round}`, name: 'read_note', input: { path: `/classes/2026/reading-${round}` } }], stop_reason: done ? 'end_turn' : 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
    } };
  } } };
  const result = await runAgent(f.env, 'Read these classes deeply', [], [{ kind: 'note', title: 'First source', url: '/first', text: fullText }], async () => [], event => f.events.push(event), undefined, undefined, modelOf('claude-opus-5-5'));
  const packets = f.events.filter(event => event.passages || event.passages_delta);
  assert.equal(packets.length, 25);
  assert.equal(packets[0].passages.length, 1);
  assert.ok(packets.slice(1).every(event => event.passages_delta.length === 1));
  assert.ok(packets.every(event => (event.passages ?? event.passages_delta).every(source => source.text.length <= 1000)));
  assert.ok(Buffer.byteLength(JSON.stringify(packets)) < 50000, 'one megabyte of readings stays under 50 KB of progress previews');
  const shown = packets.reduce((sources, event) => event.passages ?? mergePassages(sources, event.passages_delta), []);
  assert.deepEqual(shown.map(source => source.n), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal(result.passages.length, 25);
  assert.ok(result.passages.every(source => source.text.length >= 40000), 'research and final citations keep the full reading');
});

test('the agent bounds prior turns while keeping the complete current question', async () => {
  const f = fixture();
  f.env.AI = { run: async (_model, input) => { f.requests.push(input); return { response: 'Existing answer.', usage: { prompt_tokens: 100, completion_tokens: 10 } }; } };
  const history = [{ role: 'user', content: `Opening context ${'x'.repeat(10000)} Last request` }, { role: 'assistant', content: `Opening explanation ${'y'.repeat(10000)} Last explanation` }];
  const question = 'q'.repeat(4000);
  await runAgent(f.env, question, history, [], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'));
  const messages = f.requests[0].messages;
  assert.equal(messages[1].content.length, 3000);
  assert.equal(messages[2].content.length, 1500);
  assert.match(messages[1].content, /^Opening context/);
  assert.match(messages[1].content, /Last request$/);
  assert.ok(messages.at(-1).content.endsWith(question));
});

test('incremental previews extend a citation without losing earlier sources or duplicating numbers', () => {
  const initial = [{ n: 1, title: 'First', text: 'short' }, { n: 2, title: 'Second', text: 'second' }];
  const next = mergePassages(initial, [{ n: 1, title: 'First', text: 'longer reading' }, { n: 3, title: 'Third', text: 'third' }]);
  assert.deepEqual(next.map(source => source.n), [1, 2, 3]);
  assert.equal(next[0].text, 'longer reading');
  assert.equal(initial[0].text, 'short');
});

test('even an unbudgeted open adapter cannot exceed 8000 output tokens or 25 requested rounds', async () => {
  const f = fixture();
  f.env.data[`/api/notes${path}.json`].body = 'Existing recorded words from a small public note.';
  f.env.AI = { run: async (_model, input) => {
    f.requests.push(input);
    return { response: '', tool_calls: [{ name: 'read_note', arguments: { path } }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  } };
  await runAgent(f.env, 'Read recorded material', [], [], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'), undefined, undefined, 1000);
  assert.equal(f.requests.length, 25);
  assert.ok(f.requests.every(request => request.max_tokens <= 8000));
});

test('disconnect after a provider reply stops before its proposed tools and any next model round', async () => {
  const f = fixture(), controller = new AbortController();
  f.env.AI = { run: async (_model, input) => {
    f.requests.push(input); controller.abort();
    return { response: '', tool_calls: [{ name: 'read_note', arguments: { path } }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
  } };
  await assert.rejects(runAgent(f.env, 'Read recorded material', [], [], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'), undefined, undefined, 25, false, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.requests.length, 1);
  assert.equal(f.env.reads.includes(`/api/notes${path}.json`), false);
});

test('the writing reserve stops tools and forces a final model round from registered evidence', async () => {
  const f = fixture(), now = Date.now, started = now();
  let clock = started;
  Date.now = () => clock;
  try {
    f.env.AI = { run: async (_model, input) => {
      f.requests.push(input);
      if (f.requests.length === 1) {
        clock = started + 91000;
        return { response: '', tool_calls: [{ name: 'read_note', arguments: { path } }], usage: { prompt_tokens: 100, completion_tokens: 10 } };
      }
      return { response: 'A source-backed fixture answer [1].', usage: { prompt_tokens: 100, completion_tokens: 10 } };
    } };
    const result = await runAgent(f.env, 'Read recorded material', [], [{ kind: 'note', title: 'Recorded material', url: '/study/recorded', text: 'Existing recorded source words, copied exactly.' }], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'), undefined, undefined, 25, false, { deadlineAt: started + 110000 });
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1].tool_choice, 'none');
    assert.equal(f.env.reads.includes(`/api/notes${path}.json`), false);
    assert.equal(result.text, 'A source-backed fixture answer [1].');
  } finally { Date.now = now; }
});

test('aborted Claude streams retain provider-reported usage rather than inventing tokens', async () => {
  const f = fixture(), controller = new AbortController(), spend = makeSpend({ budgetUsd: 1.5 });
  f.env.client = { messages: { countTokens: async () => ({ input_tokens: 100 }), stream() {
    let text;
    return { currentMessage: { usage: { input_tokens: 100, output_tokens: 1 } }, on(_event, emit) { text = emit; }, async finalMessage() { text('Visible fixture words.'); controller.abort(); throw controller.signal.reason; } };
  } } };
  await assert.rejects(runAgent(f.env, 'Read recorded material', [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-sonnet-5-5'), spend, undefined, 25, false, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(spend.calls, 1);
  assert.ok(spend.total() > 0);
  assert.equal(spend.unreported, true, 'a partial snapshot is a lower bound, never complete usage');
});

test('a research-round timeout never promotes search narration to the final answer', async () => {
  const f = fixture(), controller = new AbortController();
  f.env.client = { messages: { stream() {
    let text;
    return { on(_event, emit) { text = emit; }, async finalMessage() { text('Let me search the recorded material.'); controller.abort(new DOMException('Research deadline reached', 'TimeoutError')); throw controller.signal.reason; } };
  } } };
  const result = await runAgent(f.env, 'Read recorded material', [], [{ kind: 'note', title: 'Recorded material', url: '/study/recorded', text: 'Existing recorded source words, copied exactly.' }], async () => [], () => {}, undefined, undefined, modelOf('claude-sonnet-5-5'), undefined, undefined, 25, false, { signal: controller.signal });
  assert.equal(result.cut, true);
  assert.ok(!result.text.includes('Let me search'));
  assert.ok(result.text.includes('Existing recorded source words, copied exactly.'));
  assert.equal(result.fixed, true, 'on the Claude path too, the deadline text is marked as written by no model (#600)');
});

test('cancelled or expired research starts no provider call, and sources are bounded at 100 (the Mini App keeps at most 100 per answer)', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  f.env.AI = { run: async (_model, input) => { f.requests.push(input); return { response: 'Fixture answer.', usage: { prompt_tokens: 100, completion_tokens: 10 } }; } };
  const model = modelOf('@cf/google/gemma-4-26b-a4b-it');
  await assert.rejects(runAgent(f.env, 'Read recorded material', [], [], async () => [], () => {}, undefined, undefined, model, undefined, undefined, 25, false, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(runAgent(f.env, 'Read recorded material', [], [], async () => [], () => {}, undefined, undefined, model, undefined, undefined, 25, false, { deadlineAt: Date.now() - 1 }), { name: 'TimeoutError' });
  assert.equal(f.requests.length, 0);
  const sources = Array.from({ length: 300 }, (_, index) => ({ kind: 'note', title: `Recorded material ${index}`, url: `/study/${index}`, text: 'Existing recorded source words, unchanged.' }));
  const result = await runAgent(f.env, 'Read recorded material', [], sources, async () => [], () => {}, undefined, undefined, model);
  assert.equal(result.passages.length, 100);
  assert.equal(result.fixed, undefined, 'a model-written answer is not marked fixed');
});

test('a hard deadline aborts the provider, returns marked verbatim evidence and starts no further research', async () => {
  const f = fixture(), deadline = new AbortController();
  f.env.AI = { run: async (_model, input, options) => {
    f.requests.push(input);
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      // Fire the deadline after the provider starts. A 100 ms wall-clock window can expire
      // during setup on a loaded runner, testing the pre-call rejection instead of this path.
      deadline.abort(new DOMException('Research deadline reached', 'TimeoutError'));
    });
  } };
  const result = await runAgent(f.env, 'Read recorded material', [], [{ kind: 'note', title: 'Recorded material', url: '/study/recorded', text: 'Existing recorded source words, copied exactly.' }], async () => [], () => {}, undefined, undefined, modelOf('@cf/google/gemma-4-26b-a4b-it'), undefined, undefined, 25, false, { signal: deadline.signal });
  assert.equal(result.cut, true);
  assert.match(result.text, /Research reached its time limit/);
  assert.ok(result.text.includes('Existing recorded source words, copied exactly.'));
  assert.equal(result.fixed, true, 'no model wrote the deadline text: its versions name no model (#600)');
  assert.equal(f.requests.length, 1);
});
