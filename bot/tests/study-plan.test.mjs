import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import Anthropic from '@anthropic-ai/sdk';
import { modelOf } from '../../shared/ask-models.mjs';

// The research plan and coverage checklist (study-plan.ts). Verses and notes are placeholders,
// not Scripture or teaching.
const out = new URL('./.build/study-plan.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/study-plan.ts"; export { runAgent } from "./src/agent.ts"; export { researchOpen } from "./src/agent-open.ts"; export { parseReference } from "./src/refs.mjs"; export { makeSpend } from "./src/spend.ts";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
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
      if (turn instanceof Error) throw turn;
      if (typeof turn === 'string') { onText?.(turn); return { content: [{ type: 'text', text: turn }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } }; }
      return { content: turn.map((t, i) => ({ type: 'tool_use', id: `t${requests.length}-${i}`, name: t.name, input: t.input })), stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 } };
    } };
  } } };
}
const env = (client) => ({ client, DATA_ORIGIN: 'https://data.test', SITE_URL: 'https://site.test' });
const apiError = (status) => Anthropic.APIError.generate(status, { error: { type: 'x', message: 'm' } }, 'm', new Headers());
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
    'The Sabbath in Exodus 20 [1].\n\nThe rest in Psalms 119 [2].'];
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
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'The Sabbath in Exodus 20 [1].', 'The Sabbath in Exodus 20 [1]; the rest was not found.'];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(requests.length, 4, 'one extra round, not more');
  assert.match(requests[3].messages.at(-1).content, /Part 2 \(missing\)/);
  assert.equal(result.text, 'The Sabbath in Exodus 20 [1]; the rest was not found.');
  assert.deepEqual(result.coverage.parts.map(p => p.status), ['covered', 'missing']);
  assert.equal(result.coverage.stopped, 'not_found');
  const fields = api.studyFields(result.tracked, result.plan, result.coverage);
  assert.equal(fields.partial, true);
  assert.deepEqual(fields.unfinished, [{ id: 'p2', ask: 'The rest in Psalms 119' }]);
});

test('an answer sent back is kept when the model then writes nothing', async () => {
  const requests = [], events = [];
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'The Sabbath in Exodus 20 [1].', ''];
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'));
  assert.equal(requests.length, 4);
  assert.equal(result.text, 'The Sabbath in Exodus 20 [1].');
  assert.equal(events.filter(e => 'delta' in e).at(-1).delta, 'The Sabbath in Exodus 20 [1].', 'the kept answer is shown again');
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
  const result = await api.runAgent(env(claudeScript(['Exodus 20:1-3 [1].', 'Exodus 20:1-3 [1].'], requests)), 'Explain Exodus 20:1-3', [], first, async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'));
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

test('reading every source is not answering every part: omitted, uncited and wrongly cited parts stay partial', () => {
  const parts = [{ id: 'p1', ask: 'Exodus 20 Sabbath', refs: [] }, { id: 'p2', ask: 'Psalms 119 rest', refs: [] }];
  const covered = [{ id: 'p1', status: 'covered', sources: [1] }, { id: 'p2', status: 'covered', sources: [2] }];
  for (const answer of ['Exodus 20 Sabbath [1].', 'Exodus 20 Sabbath [1].\n\nPsalms 119 rest.', 'Exodus 20 Sabbath [1].\n\nPsalms 119 rest [1].']) {
    const checked = api.verifyAnswer(parts, covered, answer);
    assert.deepEqual(checked.map(p => p.status), ['covered', 'partial']);
  }
  assert.deepEqual(api.verifyAnswer(parts, covered, 'Exodus 20 Sabbath [1].\n\nPsalms 119 rest [1,2].').map(p => p.status), ['covered', 'covered'], 'short answers and grouped citations are valid');
  const fields = api.studyFields(true, parts, { parts: covered, complete: true, stopped: 'covered' }, [1]);
  assert.equal(fields.coverage.complete, false, 'the final source filter cannot leave a covered part without a supporting citation');
  assert.deepEqual(fields.unfinished, [{ id: 'p2', ask: 'Psalms 119 rest' }]);
});

for (const status of [400, 429]) test(`hotfix: a provider error (${status}) on the sent-back round finishes with the first answer, not cut`, async (t) => {
  const requests = [], events = [], logged = [];
  t.mock.method(console, 'error', (line) => logged.push(String(line)));
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Only part one [1].', apiError(status)];
  const spend = api.makeSpend();
  const result = await api.runAgent(env(claudeScript(turns, requests)), question, [], [], async () => [], e => events.push(e), undefined, undefined, modelOf('claude-opus-5-5'), spend);
  assert.equal(requests.length, 4, 'the sent-back call was made and failed');
  assert.equal(result.text, 'Only part one [1].');
  assert.equal(result.cut, false);
  assert.equal(events.filter(e => 'delta' in e).at(-1).delta, 'Only part one [1].', 'the first answer is shown again after the reset');
  assert.equal(spend.unreported, false, 'a request refused outright used nothing');
  assert.ok(logged.some(l => l.includes('"event":"ask_sendback_failed"') && l.includes(`"status":${status}`)));
  assert.ok(logged.every(l => !l.includes('Sabbath')), 'no question text in the log');
});

test('hotfix: a failed sent-back call that had begun is counted and marked as not fully reported', async (t) => {
  t.mock.method(console, 'error', () => {});
  const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'Only part one [1].', apiError(529)];
  const base = claudeScript(turns, []);
  const client = { messages: { countTokens: base.messages.countTokens, stream(input) { const s = base.messages.stream(input); return { ...s, currentMessage: { usage: { input_tokens: 500, output_tokens: 50 } } }; } } };
  const spend = api.makeSpend();
  const result = await api.runAgent(env(client), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5'), spend);
  assert.equal(result.text, 'Only part one [1].');
  assert.equal(result.calls, 4, 'the failed call is counted');
  assert.equal(spend.unreported, true);
});

test('hotfix: a provider error before any send-back is still raised', async () => {
  await assert.rejects(api.runAgent(env(claudeScript([apiError(429)], [])), question, [], [], async () => [], () => {}, undefined, undefined, modelOf('claude-opus-5-5')));
});

test('hotfix: a part reads the Scripture its own ask names, whatever refs the model lists', () => {
  const src = { n: 1, kind: 'note', title: 'Psalm class', text: 'placeholder note about all of psalms 119 recorded in the class notes, with enough words to count.' };
  for (const refs of [undefined, [], ['Psalms 119:1']]) {
    const { parts } = api.planFrom('Explain all of Psalms 119', { parts: [{ ask: 'All of Psalms 119', ...(refs ? { refs } : {}) }] }, BOOKS, api.parseReference);
    const r = new api.Readings();
    r.record('psalms', 119, 1, 1, 1, 176);
    assert.equal(api.checklist(parts, [src], r)[0].status, 'partial', `refs ${JSON.stringify(refs)}: one verse is not the chapter`);
    r.record('psalms', 119, 2, 176, 1, 176);
    assert.equal(api.checklist(parts, [src], r)[0].status, 'covered');
  }
  const wide = api.planFrom('Explain Psalms 119 and its first part', { parts: [{ ask: 'The first part, Psalms 119:1-8' }] }, BOOKS, api.parseReference).parts;
  assert.ok(wide[0].refs.some(r => r.label === 'Psalms 119' && r.from == null), 'the reader named the whole chapter, so the whole chapter is read');
  const two = api.planFrom('Compare Psalms 119:1-8 with Psalms 119:105', { parts: [{ ask: 'Psalms 119:1-8' }, { ask: 'Psalms 119:105' }] }, BOOKS, api.parseReference).parts;
  assert.deepEqual(two.map(p => p.refs.map(r => r.label)), [['Psalms 119:1-8'], ['Psalms 119:105']], 'each part reads only its own range');
  const overlap = api.planFrom('Explain Exodus 12:3-11', { parts: [{ ask: 'Exodus 12:1-8' }] }, BOOKS, api.parseReference).parts;
  assert.deepEqual(overlap[0].refs.map(r => r.label), ['Exodus 12:1-8', 'Exodus 12:3-11'], 'a reader range that meets the part is read too');
  assert.deepEqual(api.namedRefs('the significance of the 3 days', BOOKS, api.parseReference), []);
});

function gatewayScript(format, turns, requests) {
  return { run: async (_model, input) => {
    requests.push(structuredClone(input));
    const turn = turns[Math.min(requests.length - 1, turns.length - 1)];
    const usage = { input_tokens: 100, output_tokens: 10, prompt_tokens: 100, completion_tokens: 10 };
    if (format === 'responses') return { usage, status: 'completed', output: typeof turn === 'string'
      ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: turn }] }]
      : turn.map((t, i) => ({ type: 'function_call', call_id: `t${requests.length}-${i}`, name: t.name, arguments: JSON.stringify(t.input) })) };
    if (format === 'messages') return { usage, stop_reason: typeof turn === 'string' ? 'end_turn' : 'tool_use', content: typeof turn === 'string'
      ? [{ type: 'text', text: turn }]
      : turn.map((t, i) => ({ type: 'tool_use', id: `t${requests.length}-${i}`, name: t.name, input: t.input })) };
    return { usage, response: typeof turn === 'string' ? turn : '', ...(typeof turn === 'string' ? {} : { tool_calls: turn.map(t => ({ name: t.name, arguments: t.input })) }) };
  } };
}

for (const format of ['chat', 'responses', 'messages']) {
  const model = { ...modelOf('@cf/google/gemma-4-26b-a4b-it'), format };
  test(`${format}: research plans, trusted checklist feedback and one repair round share the same coverage contract`, async () => {
    const requests = [], events = [];
    const turns = [[plan], [{ name: 'read_scripture', input: { reference: 'Exodus 20' } }], 'The Sabbath in Exodus 20 [1].', 'The Sabbath in Exodus 20 [1]; the remaining evidence was not found.'];
    const e = { ...env({}), AI_GATEWAY: 'fixture', AI: gatewayScript(format, turns, requests) };
    const result = await api.runAgent(e, question, [], [], async () => [], event => events.push(event), undefined, undefined, model);
    assert.equal(result.tracked, true);
    assert.equal(requests.length, 4, 'at most one repair round');
    assert.ok(JSON.stringify(requests[0].tools).includes('plan_research'));
    assert.match(JSON.stringify(requests[2]), /Part 2 \(missing\)/);
    assert.match(JSON.stringify(requests[3]), /not yet read in full: Psalms 119/);
    assert.equal(events.filter(event => event.plan).length, 1);
    assert.deepEqual(result.coverage.parts.map(p => p.status), ['covered', 'missing']);
    assert.equal(result.coverage.stopped, 'not_found');
    assert.equal(result.text, turns[3]);
    assert.deepEqual(events.filter(event => event.delta).map(event => event.delta), [turns[3]], 'reviewed drafts are not appended to the final answer');
  });

  test(`${format}: a blank repair preserves the completed draft and round limits remain explicit`, async () => {
    const requests = [];
    const turns = [[plan], 'A usable draft.', ''];
    const e = { ...env({}), AI_GATEWAY: 'fixture', AI: gatewayScript(format, turns, requests) };
    const result = await api.runAgent(e, question, [], [], async () => [], () => {}, undefined, undefined, model, undefined, undefined, 3);
    assert.equal(result.text, 'A usable draft.');
    assert.equal(result.cut, false);
    assert.equal(result.coverage.stopped, 'rounds');
    assert.equal(requests.length, 3);
  });

  test(`${format}: researched but unanswered parts receive one answer-repair pass`, async () => {
    const requests = [];
    const first = [{ kind: 'verse', title: 'Exodus 20:1-3 (KJV)', text: 'placeholder exodus 1 placeholder exodus 2 placeholder exodus 3', url: 'https://site.test/exodus/20' }];
    const e = { ...env({}), AI_GATEWAY: 'fixture', AI: gatewayScript(format, ['Unrelated final prose [1].', 'Exodus 20:1-3 [1].'], requests) };
    const result = await api.runAgent(e, 'Explain Exodus 20:1-3', [], first, async () => [], () => {}, undefined, undefined, model);
    assert.equal(requests.length, 2);
    assert.equal(result.coverage.complete, true);
    assert.match(JSON.stringify(requests[1]), /finding evidence alone does not answer it/);
  });

  test(`${format}: a completed draft survives the repair budget limit`, async () => {
    const requests = [], events = [];
    const e = { AI_GATEWAY: 'fixture', AI: gatewayScript(format, ['A usable draft.'], requests) };
    const spend = { budgetUsd: 1, unreported: false, over: () => false, inputUsd: () => 0, outputTokensLeft: () => requests.length ? 0 : 1000, call: () => {} };
    const result = await api.researchOpen(e, model, 'Fixture', [{ role: 'user', content: 'question' }], [], new Map(), async () => '', event => events.push(event), 3, spend, false, undefined, { reviewAnswer: () => 'An unfinished part remains.' });
    assert.equal(result.text, 'A usable draft.');
    assert.equal(result.stopped, 'budget');
    assert.equal(requests.length, 1);
    assert.deepEqual(events.filter(event => event.delta), [{ delta: 'A usable draft.' }]);
  });

  test(`hotfix ${format}: a provider error on the repair round keeps the draft`, async (t) => {
    const requests = [], logged = [];
    t.mock.method(console, 'error', (line) => logged.push(String(line)));
    const first = gatewayScript(format, ['A usable draft.'], requests);
    const e = { AI_GATEWAY: 'fixture', AI: { run: async (...args) => {
      if (!requests.length) return first.run(...args);
      throw Object.assign(new Error('rate limited'), { status: 429 });
    } } };
    const result = await api.researchOpen(e, model, 'Fixture', [{ role: 'user', content: 'question' }], [], new Map(), async () => '', () => {}, 3, undefined, false, undefined, { reviewAnswer: () => 'An unfinished part remains.' });
    assert.equal(result.text, 'A usable draft.');
    assert.equal(result.cut, false);
    assert.ok(logged.some(l => l.includes('"status":429')));
  });

  for (const reason of ['TimeoutError', 'AbortError']) test(`${format}: repair ${reason === 'TimeoutError' ? 'deadline keeps the draft' : 'cancellation is not swallowed'}`, async () => {
    const requests = [], abort = new AbortController();
    const first = gatewayScript(format, ['A usable draft.'], requests);
    const e = { AI_GATEWAY: 'fixture', AI: { run: async (...args) => {
      if (!requests.length) return first.run(...args);
      abort.abort(new DOMException('Stopped', reason));
      throw abort.signal.reason;
    } } };
    const run = () => api.researchOpen(e, model, 'Fixture', [{ role: 'user', content: 'question' }], [], new Map(), async () => '', () => {}, 3, undefined, false, undefined, { signal: abort.signal, reviewAnswer: () => 'An unfinished part remains.' });
    if (reason === 'AbortError') await assert.rejects(run, { name: reason });
    else {
      const result = await run();
      assert.equal(result.text, 'A usable draft.');
      assert.equal(result.stopped, 'deadline');
    }
  });
}
