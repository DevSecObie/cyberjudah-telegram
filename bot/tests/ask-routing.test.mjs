import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { signInitData } from '../src/initdata.mjs';
import { FRONTIER_ORDER, MODELS, modelOf } from '../../shared/ask-models.mjs';
import catalog from '../../shared/ask-models.json' with { type: 'json' };

const out = new URL('./.build/ask-routing.mjs', import.meta.url).pathname;
await build({
  stdin: { contents: 'export { default as worker } from "./src/index"; export * from "./src/ask-routing"; export * from "./src/credits"; export * from "./src/ai"; export { askJson } from "./src/ask-json";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'answer-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/agent$/ }, () => ({ path: 'agent', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
      export async function runAgent(env, question, history, first, retrieve, emit, ctx, uid, model, spend, resources) {
        env.calls.push({model:model.id, resources});
        spend.modelUsd += 0.001;
        if (env.failAnswer) throw new Error('fixture failed');
        emit({delta:'Existing library words [1].'});
        if (env.gapAnswer) return {text:'Fixture gap sentence.', passages:[], actions:[], cut:false, grounded:false};
        return {text:'Existing library words [1].', passages:[{kind:'spoken',title:'Existing class',url:'/classes/existing',text:'Existing library words.'}], actions:[],cut:false};
      }
    ` }));
  } }],
});
const api = await import(out);
const DEFAULT = modelOf('claude-sonnet-5-5');
const BEST = modelOf('claude-fable-5-1');
const FAST = '@cf/zai-org/glm-4.7-flash';
function setup(t, overrides = {}) {
  const db = financialDb(t);
  Object.assign(db.env, { AI_GATEWAY: 'fixture', ANTHROPIC_API_KEY: 'fixture', CLAUDE_MODEL: DEFAULT.id, calls: [], AI: { run: async () => ({data:[]}) } }, overrides);
  return db;
}
async function request(env, body, uid = 77, path = '/api/ask') {
  const auth = await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: uid, first_name: 'Fixture' } }, env.BOT_TOKEN);
  const response = await api.worker.fetch(new Request(`https://cyberjudah.io${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `tma ${auth}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : {body:JSON.stringify(body)}) }), env, {waitUntil: () => {}, passThroughOnException: () => {}});
  return response;
}
async function funded(env, amount) {
  const owner = await api.ownerOfUser(env, 77);
  await api.grantPayment(env, owner, {charge:'fixture-topup',kind:'pack',stars:77,mc:amount});
  return owner;
}
async function events(response) { return (await response.text()).trim().split('\n').map(JSON.parse); }

test('catalog routing metadata preserves every existing field and separates capability from price', () => {
  assert.deepEqual(MODELS.map(({tier,tools,...m}) => m), catalog.models);
  assert.equal(new Set(FRONTIER_ORDER).size, FRONTIER_ORDER.length);
  for (const id of FRONTIER_ORDER) assert.ok(MODELS.some(m => m.id === id), id);
  for (const m of MODELS) {
    assert.ok(['fast','balanced','frontier'].includes(m.tier), m.id);
    assert.equal(m.tools, m.format !== 'plain', m.id);
  }
  assert.equal(modelOf('claude-haiku-5-5').tier, 'fast');
  assert.equal(DEFAULT.tier, 'balanced');
  assert.equal(modelOf('claude-opus-5-5').tier, 'frontier');
  assert.equal(modelOf(FAST).tools, true);
  assert.equal(modelOf('@cf/meta/llama-3.1-8b-instruct-fp8').tools, false);
});

test('question depth follows the Mini App rules, including definitions, references and study follow-ups', () => {
  for (const q of ['John 8:32', '1 John 2:1–3?', 'Gen. 14', 'define righteousness', 'what does mercy mean?', 'meaning of “faith”']) assert.equal(api.depthOf(q), 'quick', q);
  for (const q of ['Why keep Passover?', 'Compare the accounts', 'Explain the historical evidence', 'What was said? Where can I read it?', 'Show me the relationship between the passages']) assert.equal(api.depthOf(q), 'deep', q);
  const followup = 'Can you tell me some more about that particular passage?';
  assert.equal(api.depthOf(followup, 2), 'normal');
  assert.equal(api.depthOf(followup, 4), 'deep');
  assert.equal(api.depthOf('John 8:32', 8), 'quick');
  assert.equal(api.depthOf('Can you tell me about Judah?'), 'normal');
  assert.equal(api.depthOf('word '.repeat(29)), 'deep');
});

test('asking to read a passage is quick, as in the Mini App; asking what it means is not', () => {
  for (const q of ['read John 3:16', 'Show me Genesis 1:1-3', 'what does John 8:32 say?', 'quote Isaiah 45:7', 'please pull up 1 John 4:1.', 'open Rev. 13:1-8']) assert.equal(api.depthOf(q), 'quick', q);
  for (const q of ['What does Isaiah 45:7 mean?', 'What does John 8:32 mean', 'what does John 8:32 mean.', 'John 8:32 meaning', 'what is meant by Romans 6', 'Rev 1:1 signified', 'what signifieth this', 'read John 3:16 and explain it', 'Give me a study on the feast days']) assert.notEqual(api.depthOf(q), 'quick', q);
  for (const q of ['what does mercy mean', 'define righteousness', 'mercy meaning', 'grace meaning?', 'the meaning of grace', 'meaning of the word hallelujah', 'what is the meaning of grace?']) assert.equal(api.depthOf(q), 'quick', `${q}: an explicit word definition stays quick`);
  assert.equal(api.depthOf('read John 3:16', 10), 'quick', 'a lookup stays quick deep into a conversation');
});

test('auto counts earlier exchanges, not messages, as turns', async t => {
  const { env } = setup(t, { ASK_FREE_MODELS: FAST });
  await funded(env, 200_000);
  const followup = 'and what did the prophets say after that time';
  const history = (exchanges) => Array.from({ length: exchanges }, (_, i) => [{ role: 'user', content: `Question ${i}` }, { role: 'assistant', content: `Answer ${i}` }]).flat();
  const route = async (h) => { const r = await request(env, { q: followup, model: 'auto', stream: true, history: h, consent: ['Anthropic', 'Cloudflare (Workers AI)'], caps: { [DEFAULT.id]: 200_000, [BEST.id]: 200_000, 'anthropic/claude-opus-5.5': 200_000 } }); const body = await r.text(); assert.equal(r.status, 200, body); return env.calls.at(-1).model; };
  const deep = (await api.autoModel(env, followup, 4, 77, DEFAULT, api.freeModels(env), false)).id;
  assert.notEqual(deep, DEFAULT.id);
  assert.equal(api.depthOf(followup, 2), 'normal', 'the third question has two earlier exchanges, not four');
  assert.equal(api.depthOf(followup, 4), 'deep');
  assert.equal(await route(history(2)), deep, 'ordinary follow-ups also get capable research');
  env.calls.length = 0;
  assert.equal(await route(history(4)), deep, 'the fifth question is deep');
});

test('account models publish catalog tier/tools for every available model', async t => {
  const {env} = setup(t);
  const response = await request(env, undefined, 77, '/api/ask/account');
  assert.equal(response.status, 200);
  const account = await response.json();
  assert.equal(account.model, DEFAULT.id);
  assert.equal(account.models.length, MODELS.length);
  for (const m of account.models) {
    assert.equal(m.tier, modelOf(m.id).tier);
    assert.equal(m.tools, modelOf(m.id).tools);
    assert.ok(m.typical_mc > 0 && m.max_mc > 0);
  }
});

test('quick auto chooses fast free research, even for admins; other questions prefer capable research', async t => {
  const {env} = setup(t);
  const free = api.freeModels(env);
  for (const admin of [false,true]) {
    const m = await api.autoModel(env, 'John 8:32', 0, 77, BEST, free, admin);
    assert.equal(m.tier, 'fast');
    assert.equal(m.tools, true);
    assert.ok(free.has(m.id));
  }
  await funded(env, 2_000_000);
  for (const q of ['Can you tell me about Judah?', 'What does John 3:16 mean?', 'What does that mean?', 'Go on.']) {
    assert.equal((await api.autoModel(env, q, 0, 77, DEFAULT, free, false)).id, BEST.id, q);
  }
  const plain = modelOf('@cf/meta/llama-3.1-8b-instruct-fp8');
  assert.equal((await api.autoModel(env, 'John 8:32', 0, 77, BEST, new Set([plain.id]), false)).id, plain.id, 'restricted free menu still works');
});

test('deep auto uses capability preference and current affordability, not the most expensive model', async t => {
  const {env} = setup(t);
  const owner = await funded(env, 200_000);
  assert.equal((await api.autoModel(env, 'Explain the history', 0, 77, DEFAULT, api.freeModels(env), false)).id, 'anthropic/claude-opus-5.5');
  await api.hold(env, owner, 'already-held', 200_000, 1, DEFAULT.id);
  const free = await api.autoModel(env, 'Explain the history', 0, 77, DEFAULT, api.freeModels(env), false);
  assert.ok(api.freeModels(env).has(free.id), 'held funds cannot pay for another answer');
  assert.equal(free.tools, true);
  for (const overrides of [{unlimited:true}, {billing:'off'}]) {
    env.ASK_BILLING = overrides.billing ?? 'on';
    const m = await api.autoModel(env, 'Explain the history', 0, 77, DEFAULT, api.freeModels(env), overrides.unlimited ?? false);
    assert.equal(m.id, BEST.id);
    assert.ok(m.input < modelOf('openai/gpt-5.5-pro').input, 'cost is not capability order');
  }
});

test('auto only considers configured providers, and honors empirical typical cost', async t => {
  const {env,sql} = setup(t, {ANTHROPIC_API_KEY:undefined});
  await funded(env, 100_000);
  const m = await api.autoModel(env, 'Explain the history', 0, 77, DEFAULT, api.freeModels(env), false);
  assert.equal(m.id, 'openai/gpt-5.6-sol');
  const owner = await api.ownerOfUser(env, 77);
  for (let i = 0; i < 5; i++) sql.prepare('INSERT INTO credit_usage (request_id,user_id,at,model,held_mc,charged_mc,absorbed_mc,cost_usd,status) VALUES (?, ?, ?, ?, 0, ?, 0, 0.01, ?)').run(`typical-${i}`,owner,Date.now(),'openai/gpt-6-astra',50_000,'ok');
  assert.equal((await api.autoModel(env, 'Explain the history', 0, 77, DEFAULT, api.freeModels(env), false)).id, 'openai/gpt-6-astra');
});

test('a more capable free research model wins over a lower-tier affordable paid one', async t => {
  const {env} = setup(t);
  await funded(env, 10_000);
  const free = api.freeModels(env);
  const m = await api.autoModel(env, 'What does that mean?', 0, 77, DEFAULT, free, false);
  assert.equal(m.tier, 'frontier');
  assert.ok(free.has(m.id));
});

for (const stream of [true,false]) {
  test(`${stream ? 'NDJSON' : 'JSON'} auto respects consent and exact-model cost confirmation before AI or holds`, async t => {
    const {env,sql} = setup(t);
    const owner = await funded(env, 2_000_000);
    const body = {q:'Explain the historical evidence',model:'auto',stream};
    for (const model of ['auto',BEST.id]) {
      let response = await request(env, {...body,model});
      assert.equal(response.status, 428);
      assert.equal((await response.json()).provider, 'Anthropic');
      response = await request(env, {...body,model,consent:['Anthropic']});
      assert.equal(response.status, 409);
      let error = await response.json();
      assert.equal(error.error, 'confirm');
      assert.equal(error.model, BEST.id);
      response = await request(env, {...body,model,consent:['Anthropic'],caps:{auto:1_500_000,[DEFAULT.id]:1_500_000}});
      assert.equal(response.status, 409, 'auto/default caps cannot authorize a different model');
      error = await response.json();
      assert.equal(error.model, BEST.id);
      response = await request(env, {...body,model,consent:['Anthropic'],caps:{[BEST.id]:999}});
      assert.equal(response.status, 409, 'the existing minimum cap still applies');
    }
    assert.equal(env.calls.length, 0);
    assert.equal((await api.wallet(env, owner)).total_mc, 2_000_000);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM credit_holds').get().n, 0);
  });

  test(`${stream ? 'NDJSON' : 'JSON'} auto settles once on its chosen model and keeps source excerpts`, async t => {
    const {env,sql} = setup(t);
    const owner = await funded(env, 200_000);
    const chosen = 'anthropic/claude-opus-5.5';
    const body = {q:'Explain the historical evidence',model:'auto',stream,consent:['Anthropic'],request:'auto-request',caps:{[chosen]:200_000}};
    const response = await request(env, body);
    assert.equal(response.status, 200);
    const answer = stream ? (await events(response)).find(e => e.done) : await response.json();
    assert.equal(answer.answer, 'Existing library words [1].');
    assert.equal(answer.sources[0].excerpt, 'Existing library words.');
    if (stream) assert.equal(answer.model, chosen, 'the finished line names the model Auto chose');
    assert.equal(env.calls[0].model, chosen);
    const usage = sql.prepare('SELECT model,charged_mc FROM credit_usage').get();
    assert.equal(usage.model, chosen);
    assert.ok(usage.charged_mc > 1_000, 'retrieval is included in the charge');
    assert.equal((await api.wallet(env, owner)).total_mc, 200_000 - usage.charged_mc);
    assert.equal((await request(env, body)).status, 409, 'a replay cannot hold or settle again');
    assert.equal(env.calls.length, 1);
  });

  test(`${stream ? 'NDJSON' : 'JSON'} quick auto stays free and respects free quota/budget caps`, async t => {
    const {env,sql} = setup(t, {ASK_FREE_MODELS:FAST, ASK_DAILY_LIMIT:'1'});
    const body = {q:'John 8:32',model:'auto',stream,consent:['Cloudflare (Workers AI)']};
    let response = await request(env, body);
    assert.equal(response.status, 200);
    const answer = stream ? (await events(response)).find(e => e.done) : await response.json();
    assert.ok(answer.answer);
    assert.equal(env.calls[0].model, FAST);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n, 0, 'no reader charge');
    response = await request(env, body);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'limit');
    env.ASK_DAILY_LIMIT = '100';
    env.ASK_FREE_DAILY_USD_CAP = '0.001';
    response = await request(env, body);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, 'free-paused');
    assert.equal(env.calls.length, 1);
  });

  test(`${stream ? 'NDJSON' : 'JSON'} explicit picks override auto; admin deep research charges nothing`, async t => {
    const {env,sql} = setup(t);
    let response = await request(env, {q:'Explain the historical evidence',model:FAST,stream,consent:['Cloudflare (Workers AI)']});
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(env.calls[0].model, FAST);
    response = await request(env, {q:'Explain the historical evidence',model:'auto',stream,consent:['Anthropic']}, 100000002);
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(env.calls[1].model, BEST.id);
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n, 0);
  });
}

test('JSON adapter handles split frames, drops partial answers on errors, and requires a done packet', async () => {
  const response = parts => new Response(new ReadableStream({start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); }}));
  const good = await api.askJson(response(['{"delta":"Partial"}\n{"do','ne":true,"answer":"Whole","sources":[]}\n{"usage":{"charged_mc":7}}']), ' Q ', Date.now());
  assert.deepEqual((await good.json()).usage, {charged_mc:7});
  for (const parts of [['{"delta":"Partial"}\n'], ['{"done":true,"answer":"Partial"}\n{"error":"unavailable"}\n']]) {
    const r = await api.askJson(response(parts), 'Q', Date.now());
    assert.equal(r.status, 503);
    assert.equal((await r.json()).ok, false);
  }
});

test('a pronoun is not a word to define: meaning follow-ups are never quick, at any turn', () => {
  // Each of these matched DEFINE or the short-phrase rule before; none may be quick now.
  const asks = ['what does it mean', 'what does this mean?', 'What does that mean', 'what does he mean', 'meaning of this', 'the meaning of that?', 'define it',
    "what does 'this' mean", "what does 'it' mean?", "define 'that'", 'what does “it” mean', "what does it' mean", 'what does this-mean',
    'what does them mean', 'define them', 'meaning of them', "what's there?", "what's here", "what's this", 'what is it', 'definition of this'];
  for (const turns of [0, 1, 4]) for (const q of asks) assert.notEqual(api.depthOf(q, turns), 'quick', `${q} (turns ${turns})`);
  for (const q of ['what does mercy mean', 'what does Hebrew mean?', 'meaning of theophany', 'definition of mercy', 'define heresy']) assert.equal(api.depthOf(q, 4), 'quick', `${q}: an explicit word definition`);
});

test('the one-piece JSON answer names its versions, with the model that wrote it (#600)', async t => {
  const { env } = setup(t);
  await funded(env, 1_000_000);
  const response = await request(env, { q: 'Explain the historical evidence', consent: ['Anthropic', 'Cloudflare (Workers AI)'] });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(env.calls.length, 1);
  assert.ok(body.versions && typeof body.versions === 'object', 'versions is present');
  assert.deepEqual(Object.keys(body.versions).sort(), ['corpus', 'model', 'policy', 'prompt']);
  assert.equal(body.versions.model, env.calls[0].model, 'versions names the model that wrote the answer');
  assert.equal('model' in body, false, 'the writer is sent only inside versions');
});

test('a one-piece answer no model wrote names no model in its versions (#600)', async t => {
  const { env } = setup(t, { gapAnswer: true });
  await funded(env, 1_000_000);
  const response = await request(env, { q: 'Explain the historical evidence', consent: ['Anthropic', 'Cloudflare (Workers AI)'] });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.answer, 'Fixture gap sentence.');
  assert.equal(body.versions.model, 'none', 'the agent replaced its text with a fixed sentence');
  assert.equal('model' in body, false);
});

test('a streamed answer the agent replaced with a fixed sentence names no model in its versions, and keeps its Auto label (#600)', async t => {
  const { env } = setup(t, { gapAnswer: true });
  await funded(env, 200_000);
  const response = await request(env, { q: 'Explain the historical evidence', model: 'auto', stream: true, request: 'gap-request', consent: ['Anthropic'], caps: { 'anthropic/claude-opus-5.5': 200_000 } });
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.clone().text());
  const done = (await events(response)).find(e => e.done);
  assert.equal(done.answer, 'Fixture gap sentence.');
  assert.equal(done.versions.model, 'none', 'no model wrote the fixed sentence');
  assert.equal(done.model, env.calls[0].model, 'the top-level model (the Mini App Auto label) is unchanged');
});

test('a streamed answer the agent wrote names its model in versions (#600)', async t => {
  const { env } = setup(t);
  await funded(env, 200_000);
  const response = await request(env, { q: 'Explain the historical evidence', model: 'auto', stream: true, request: 'wrote-request', consent: ['Anthropic'], caps: { 'anthropic/claude-opus-5.5': 200_000 } });
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.clone().text());
  const done = (await events(response)).find(e => e.done);
  assert.ok(done, 'the stream has a finished line');
  assert.equal(done.versions.model, env.calls[0].model);
  assert.equal(done.model, env.calls[0].model);
});

test('short subjects are studies rather than implicit dictionary lookups', () => {
  for (const q of ['What is salvation?', 'What is Passover?', 'What is faith', "what's shiloh?", 'what is ithiel', 'Who is Moses?']) {
    assert.equal(api.depthOf(q), 'deep', q);
  }
  for (const q of ['Judah', 'the sabbath day', 'by all means']) assert.equal(api.depthOf(q), 'normal', q);
  assert.equal(api.depthOf('What is salvation?', 0, 'quick'), 'quick');
  assert.equal(api.depthOf('John 8:32', 0, 'study'), 'deep');
});

for (const stream of [true, false]) {
  test(`${stream ? 'NDJSON' : 'JSON'} explicit depth routes Auto but cannot bypass consent or exact-model confirmation`, async t => {
    const {env,sql} = setup(t);
    await funded(env, 2_000_000);
    for (const depth of ['invalid', null, {}, 3]) {
      const r = await request(env, {q:'John 8:32',model:'auto',stream,depth});
      assert.equal(r.status, 400);
    }
    const body = {q:'John 8:32',model:'auto',stream,depth:'study'};
    assert.equal((await request(env, body)).status, 428);
    assert.equal((await request(env, {...body,consent:['Anthropic']})).status, 409);
    assert.equal(env.calls.length, 0);
    assert.equal(sql.prepare('SELECT COUNT(*) n FROM credit_holds').get().n, 0);
    const quick = await request(env, {q:'What is salvation?',model:'auto',stream,depth:'quick',consent:['Cloudflare (Workers AI)']});
    assert.equal(quick.status, 200, await quick.clone().text());
    await quick.text();
    assert.equal(modelOf(env.calls.at(-1).model).tier, 'fast');
    const explicit = await request(env, {...body,model:DEFAULT.id,consent:['Anthropic'],caps:{[DEFAULT.id]:2_000_000}});
    assert.equal(explicit.status, 200, await explicit.clone().text());
    await explicit.text();
    assert.equal(env.calls.at(-1).model, DEFAULT.id, 'depth never replaces a manually selected model');
  });
}
