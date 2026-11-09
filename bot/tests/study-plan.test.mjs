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

test('a plan keeps only short restatements of the reader\'s question, within the bounds', () => {
  const q = 'Explain the Sabbath in Exodus 20, the Passover and the dietary laws';
  const parts = api.planFrom(q, { parts: [
    { ask: 'The Sabbath in Exodus 20', refs: ['Exodus 20'] },
    { ask: 'The Passover', refs: ['Exodus 12', 'not a reference'] },
    { ask: 'What "the Lord said" about food' },             // a quotation: dropped
    { ask: 'Leviticus 11 on dietary laws' },               // Scripture the reader did not name: dropped
    { ask: 'x'.repeat(201) },                               // too long: dropped
    { ask: 'The dietary laws', refs: ['Leviticus 11'] },
  ] }, BOOKS, api.parseReference);
  assert.deepEqual(parts.map(p => [p.id, p.ask]), [[1, 'The Sabbath in Exodus 20'], [2, 'The Passover'], [3, 'The dietary laws']]);
  assert.deepEqual(parts[1].refs.map(r => r.label), ['Exodus 12'], 'refs the model needs read are kept when they parse');
  assert.equal(api.planFrom(q, { parts: Array.from({ length: 12 }, (_, i) => ({ ask: `Part ${i}: the 10 commandments` })) }, BOOKS, api.parseReference).length, api.PLAN_MAX_PARTS);
  assert.equal(api.planFrom(q, { parts: [{ ask: '“quoted”' }] }, BOOKS, api.parseReference), null);
  assert.equal(api.planFrom(q, {}, BOOKS, api.parseReference), null);
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
});

test('each part is covered, partial or missing, with at most 20 sources', () => {
  const parts = [{ id: 1, ask: 'the passover lamb blood doorposts', refs: [{ slug: 'exodus', chapter: 12, label: 'Exodus 12' }] }, { id: 2, ask: 'dietary laws clean unclean animals', refs: [] }];
  const note = { n: 1, kind: 'note', title: 'Passover class', text: 'The passover lamb was killed and the blood put on the doorposts of the houses, recorded in the class notes as read.' };
  const r = new api.Readings();
  let state = api.checklist(parts, [note], r);
  assert.deepEqual(state.map(p => p.status), ['partial', 'missing'], 'evidence without the chapter read is partial');
  assert.deepEqual(state[0].sources, [1]);
  r.record('exodus', 12, 1, 10, 1, 10);
  state = api.checklist(parts, [note], r);
  assert.deepEqual(state.map(p => p.status), ['covered', 'missing']);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...note, n: i + 1 }));
  assert.equal(api.checklist(parts, many, r)[0].sources.length, api.PART_MAX_SOURCES);
  const fields = api.studyFields(true, parts, { parts: state, complete: false, stopped: 'not_found' });
  assert.deepEqual(fields.unfinished, [{ id: 2, ask: 'dietary laws clean unclean animals' }]);
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

test('the plan is announced, the checklist follows every reading, and research ends because every part is covered', async () => {
  const requests = [], events = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }],
    [{ name: 'read_scripture', input: { reference: 'Psalms 119' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:41-80' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:81-120' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:121-160' } }, { name: 'read_scripture', input: { reference: 'Psalms 119:161-176' } }],
    'The answer [1].'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'));
  assert.deepEqual(events.find(e => e.plan).plan, { parts: [{ id: 1, ask: 'The Sabbath in Exodus 20' }, { id: 2, ask: 'The rest in Psalms 119' }] });
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
  assert.deepEqual(fields.unfinished, [{ id: 2, ask: 'The rest in Psalms 119' }]);
});

test('a round limit is named as the reason research stopped', async () => {
  const requests = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Answer at the limit [1].'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'), undefined, undefined, 3);
  assert.equal(result.coverage.stopped, 'rounds');
  assert.equal(result.coverage.complete, false);
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
