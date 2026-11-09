import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { modelOf } from '../../shared/ask-models.mjs';

// The research plan and coverage checklist (study-plan.ts). Verses and notes are placeholders,
// not Scripture or teaching.
const out = new URL('./.build/study-plan.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/study-plan.ts"; export { runAgent } from "./src/agent.ts"; export { parseReference } from "./src/refs.mjs";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/(providers|resource-tools|ask-tools|data)$/ }, args => args.importer.endsWith('/agent.ts') ? { path: args.path.slice(2), namespace: 'fixture' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: {
    providers: 'export async function claude(env) { return env.client; }',
    'resource-tools': 'export async function resolveResourcePins() { return {}; }',
    'ask-tools': 'export const MORE_TOOLS=[]; export const MORE_RUN={};',
    data: 'export async function dataJson() { return null; } export async function books() { return BOOKS; } export async function chapter(env, slug) { const n = slug === "psalms" ? 176 : 10; return { verses: Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `placeholder ${slug} ${i + 1}` })) }; } const BOOKS = [{book:"Exodus",slug:"exodus",chapters:40},{book:"Psalms",slug:"psalms",chapters:150},{book:"Leviticus",slug:"leviticus",chapters:27}];',
  }[args.path] }));
} }] });
const api = await import(out);
const BOOKS = [{ book: 'Exodus', slug: 'exodus', chapters: 40 }, { book: 'Psalms', slug: 'psalms', chapters: 150 }, { book: 'Leviticus', slug: 'leviticus', chapters: 27 }];

test('a plan is taken whole when every part is a short restatement, and refused whole with the reasons otherwise', () => {
  const q = 'Explain the Sabbath in Exodus 20, the Passover and the dietary laws';
  const plan = (parts) => api.planFrom(q, { parts }, BOOKS, api.parseReference);
  const ok = plan([
    { ask: 'The Sabbath in Exodus 20', refs: ['Exodus 20'] },
    { ask: 'The Passover', refs: ['Exodus 12', 'not a reference'] },
    { ask: 'The dietary laws', refs: ['Leviticus 11'] },
  ]);
  assert.deepEqual(ok.parts.map(p => [p.id, p.ask]), [['p1', 'The Sabbath in Exodus 20'], ['p2', 'The Passover'], ['p3', 'The dietary laws']]);
  assert.deepEqual(ok.parts[1].refs.map(r => r.label), ['Exodus 12'], 'refs the model needs read are kept when they parse');
  const bad = plan([
    { ask: 'The Sabbath in Exodus 20' },
    { ask: 'What "the Lord said" about food' },
    { ask: 'Leviticus 11 on dietary laws' },
    { ask: 'x'.repeat(201) },
  ]);
  assert.equal(bad.parts, undefined, 'no part is kept from a refused plan');
  assert.deepEqual(bad.refused, ['part 2: it has a quotation', 'part 3: it names Scripture the reader did not name', 'part 4: it is longer than 200 characters']);
  assert.deepEqual(plan(Array.from({ length: 9 }, (_, i) => ({ ask: `Part ${i}: the 10 commandments` }))).refused, [`at most ${api.PLAN_MAX_PARTS} parts`]);
  assert.equal(plan(Array.from({ length: 8 }, (_, i) => ({ ask: `Part ${i}: the 10 commandments` }))).parts.length, 8, 'numbers that are not Scripture are not references');
  assert.deepEqual(api.planFrom(q, {}, BOOKS, api.parseReference).refused, ['no parts were listed']);
});

test('numbered books keep their number, a chapter.verse form is not taken as the chapter, and a part may restate a named chapter', () => {
  const books = [...BOOKS, { book: 'John', slug: 'john', chapters: 21 }, { book: '1 John', slug: '1-john', chapters: 5 }, { book: '1 Corinthians', slug: '1-corinthians', chapters: 16 }, { book: 'Romans', slug: 'romans', chapters: 16 }];
  const labels = (t) => api.namedRefs(t, books, api.parseReference).map(r => r.slug + ' ' + r.chapter);
  assert.deepEqual(labels('What does 1 John 4:1-3 teach?'), ['1-john 4']);
  assert.deepEqual(labels('Compare Romans 8 and 1 Corinthians 13'), ['romans 8', '1-corinthians 13']);
  assert.deepEqual(labels('What is John 3.16 about'), []);
  assert.deepEqual(labels('Read Exodus 20.'), ['exodus 20']);
  const ok = api.planFrom('What does Exodus 12:1-8 mean and how is it kept', { parts: [{ ask: 'What Exodus 12:1-8 means' }, { ask: 'How Exodus 12 is kept' }] }, books, api.parseReference);
  assert.equal(ok.parts.length, 2, 'the chapter the reader named, in another form');
});

test('a reference counts as read only when every verse of it was read, across parts of a chapter', () => {
  const r = new api.Readings();
  const ref = { slug: 'psalms', chapter: 119, label: 'Psalms 119' }, range = { slug: 'psalms', chapter: 119, from: 30, to: 70, label: 'Psalms 119:30-70' };
  assert.equal(r.covers(ref), false);
  r.record('psalms', 119, 1, 40, 1, 176);
  assert.equal(r.covers(range), false);
  assert.equal(r.touched(ref), true);
  r.record('psalms', 119, 41, 80, 1, 176);
  assert.equal(r.covers(range), true);
  assert.equal(r.covers(ref), false, 'half a chapter is not the chapter');
  for (const [a, b] of [[81, 120], [121, 160], [161, 176]]) r.record('psalms', 119, a, b, 1, 176);
  assert.equal(r.covers(ref), true);
  assert.equal(r.covers({ slug: 'psalms', chapter: 119, from: 180, to: 190, label: 'Psalms 119:180-190' }), false, 'verses past the chapter\'s end were never read');
});

test('each part is covered, partial or missing, with at most 20 sources', () => {
  const parts = [{ id: 'p1', ask: 'the passover lamb blood doorposts', refs: [{ slug: 'exodus', chapter: 12, label: 'Exodus 12' }] }, { id: 'p2', ask: 'dietary laws clean unclean animals', refs: [] }];
  const note = { n: 1, kind: 'note', title: 'Passover class', text: 'The passover lamb was killed and the blood put on the doorposts of the houses, recorded in the class notes as read.' };
  const r = new api.Readings();
  let state = api.checklist(parts, [note], r);
  assert.deepEqual(state.map(p => p.status), ['partial', 'missing'], 'evidence without the chapter read is partial');
  assert.deepEqual(state[0].sources, [1]);
  r.record('exodus', 12, 1, 10, 1, 10);
  state = api.checklist(parts, [note], r);
  assert.deepEqual(state.map(p => p.status), ['covered', 'missing']);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...note, n: i + 1 }));
  const all = api.checklist(parts, many, r);
  assert.equal(all[0].sources.length, 30, 'the checklist keeps every source; only what is sent is bounded');
  assert.equal(api.studyFields(true, parts, { parts: all, complete: true, stopped: 'covered' }).coverage.parts[0].sources.length, api.PART_MAX_SOURCES);
  assert.deepEqual(api.studyFields(true, parts, { parts: all, complete: true, stopped: 'covered' }, [2, 5, 99]).coverage.parts[0].sources, [2, 5], 'only sources the answer cites');
  const fields = api.studyFields(true, parts, { parts: state, complete: false, stopped: 'not_found' });
  assert.deepEqual(fields.unfinished, [{ id: 'p2', ask: 'dietary laws clean unclean animals' }]);
  assert.equal(fields.partial, true);
  assert.deepEqual(api.studyFields(false, parts, { parts: state, complete: false, stopped: 'not_found' }), {});
});

// A Claude stand-in that plays a script of turns: each is a list of tool calls, or the final text.
function claudeScript(turns, requests) {
  return { messages: { countTokens: async () => ({ input_tokens: 100 }), stream(input) {
    requests.push(structuredClone(input));
    const turn = turns[Math.min(requests.length - 1, turns.length - 1)];
    let onText;
    return { on(event, handler) { if (event === 'text') onText = handler; }, async finalMessage() {
      if (typeof turn === 'string') { onText?.(turn); return { content: [{ type: 'text', text: turn }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } }; }
      return { content: turn.map((t, i) => ({ type: 'tool_use', id: `t${requests.length}-${i}`, name: t.name, input: t.input })), stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
    } };
  } } };
}
const env = (client) => ({ client, DATA_ORIGIN: 'https://data.test', SITE_URL: 'https://site.test' });
const plan = { name: 'plan_research', input: { parts: [{ ask: 'The Sabbath in Exodus 20', refs: ['Exodus 20'] }, { ask: 'The rest in Psalms 119', refs: ['Psalms 119'] }] } };
const question = 'Explain the Sabbath in Exodus 20 and the rest in Psalms 119';

test('a part is judged on its own words: a new plan reuses no old decision, and a retrieval score covers nothing', () => {
  const memo = new Map(), r = new api.Readings();
  const src = { n: 1, kind: 'note', title: 'Passover class', text: 'The passover lamb was killed and the blood put on the doorposts of the houses, recorded in the class notes as read.' };
  assert.equal(api.checklist([{ id: 'p1', ask: 'the passover lamb blood doorposts', refs: [] }], [src], r, memo)[0].status, 'covered');
  assert.equal(api.checklist([{ id: 'p1', ask: 'mountains rivers deserts geography', refs: [] }], [src], r, memo)[0].status, 'missing', 'p1 with new words is judged again');
  const scored = { ...src, [Symbol.for('cyberjudah.retrieval-provenance')]: { mode: 'vector', score: 0.95 } };
  assert.equal(api.checklist([{ id: 'p2', ask: 'mountains rivers deserts geography', refs: [] }], [scored], r)[0].status, 'missing');
});

test('the plan is announced, the checklist follows every reading, and research ends because every part is covered', async () => {
  const requests = [], events = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }],
    [{ name: 'read_scripture', input: { reference: 'Psalms 119' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:41-80' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:81-120' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:121-160' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:161-176' } }],
    'The answer [1].'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'));
  assert.deepEqual(events.find(e => e.plan).plan, { parts: [{ id: 'p1', ask: 'The Sabbath in Exodus 20' }, { id: 'p2', ask: 'The rest in Psalms 119' }] });
  const note = (i) => requests[i].messages.at(-1).content.at(-1);
  assert.equal(note(2).type, 'text', 'the checklist follows the tool results as a separate text block');
  assert.match(note(2).text, /Part 2 \(missing\): The rest in Psalms 119; not yet read in full: Psalms 119/);
  assert.match(note(3).text, /every part of the question is covered/);
  assert.equal(result.tracked, true);
  assert.deepEqual(result.coverage.parts.map(p => p.status), ['covered', 'covered']);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.stopped, 'covered');
});

test('an answer written with a part still open is sent back once, then finishes as not found and partial', async () => {
  const requests = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Only part one [1].', 'Still only part one [1]; the rest was not found.'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(requests.length, 4, 'one extra round, not more');
  assert.match(requests[3].messages.at(-1).content, /Part 2 \(missing\)/);
  assert.equal(result.text, 'Still only part one [1]; the rest was not found.');
  assert.deepEqual(result.coverage.parts.map(p => p.status), ['covered', 'missing']);
  assert.equal(result.coverage.stopped, 'not_found');
  const fields = api.studyFields(result.tracked, result.plan, result.coverage);
  assert.equal(fields.partial, true);
  assert.deepEqual(fields.unfinished, [{ id: 'p2', ask: 'The rest in Psalms 119' }]);
});

test('an answer sent back is kept when the model then writes nothing', async () => {
  const requests = [], events = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Only part one [1].', ''];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(requests.length, 4);
  assert.equal(result.text, 'Only part one [1].');
  assert.equal(events.filter(e => 'delta' in e).at(-1).delta, 'Only part one [1].', 'the kept answer is shown again');
});

test('an empty answer cut off at the token limit stays cut off', async () => {
  const requests = [];
  const client = { messages: { countTokens: async () => ({ input_tokens: 100 }), stream(input) {
    requests.push(input);
    return { on() {}, async finalMessage() { return { content: [], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: 10 } }; } };
  } } };
  const result = await api.runAgent(env(client), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.cut, true);
  assert.equal(requests.length, 1, 'an empty answer is not sent back');
});

test('a refused plan is sent back with the reasons, and a corrected one is taken', async () => {
  const requests = [], events = [];
  const bad = { name: 'plan_research', input: { parts: [{ ask: 'The Sabbath in Exodus 20' }, { ask: 'Leviticus 11 on food' }] } };
  const turns = [[bad], [plan], 'The answer [1].'];
  await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'));
  assert.match(JSON.stringify(requests[1].messages.at(-1).content), /part 2: it names Scripture the reader did not name/);
  assert.deepEqual(events.filter(e => e.plan).map(e => e.plan.parts.length), [2], 'only the accepted plan is announced');
});

test('a round limit is named as the reason research stopped', async () => {
  const requests = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Answer at the limit [1].'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'), undefined, undefined, 3);
  assert.equal(result.coverage.stopped, 'rounds');
  assert.equal(result.coverage.complete, false);
});

test('rounds used up without a final answer are named as the round limit', async () => {
  const requests = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }]];
  const client = claudeScript(turns, requests);
  // Every turn asks for a tool, even the one where tools are turned off: the loop runs out.
  const result = await api.runAgent(env(client), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'), undefined, undefined, 2);
  assert.equal(result.coverage.stopped, 'rounds');
});

test('verses already in hand count as read for a named reference', async () => {
  const requests = [];
  const first = [{ kind: 'verse', title: 'Exodus 20:1-3 (KJV)', text: 'placeholder exodus 1 placeholder exodus 2 placeholder exodus 3', url: 'https://site.test/exodus/20' }];
  const result = await api.runAgent(env(claudeScript(['Answer [1].', 'Answer [1].'], requests)), 'Explain Exodus 20:1-3', [], first, async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.tracked, true);
  assert.deepEqual(result.coverage.parts.map(p => p.status), ['covered'], 'the verses found before research are the named reference, read');
  assert.equal(requests.length, 1, 'so the answer is not sent back');
});

test('a question with no parts and no Scripture is not tracked and gets no checklist', async () => {
  const requests = [];
  const result = await api.runAgent(env(claudeScript(['A short answer.'], requests)), 'Who was Moses?', [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.tracked, false);
  assert.equal(requests.length, 1, 'no extra round');
  assert.deepEqual(api.studyFields(result.tracked, result.plan, result.coverage), {});
});

test('one answer registers at most 100 sources, the Mini App\'s limit', async () => {
  const requests = [];
  const reads = Array.from({ length: 105 }, (_, i) => ({ name: 'read_scripture', input: { reference: `Psalms 119:${i + 1}` } }));
  const result = await api.runAgent(env(claudeScript([reads, 'Done [1].'], requests)), 'Read Psalms 119 verse by verse', [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(result.passages.length, 100);
});

test('part ids are short unique strings, and every coverage and unfinished id is one of the plan\'s', () => {
  const { parts } = api.planFrom('Explain three things', { parts: Array.from({ length: 8 }, (_, i) => ({ ask: `Thing ${String.fromCharCode(97 + i)}` })) }, BOOKS, api.parseReference);
  const ids = parts.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => typeof id === 'string' && id.length <= 16));
  const state = api.checklist(parts, [], new api.Readings());
  const fields = api.studyFields(true, parts, { parts: state, complete: false, stopped: 'not_found' });
  for (const p of [...fields.coverage.parts, ...fields.unfinished]) assert.ok(ids.includes(p.id), p.id);
});
