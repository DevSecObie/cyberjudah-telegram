import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const out = new URL('./.build/app-ask.mjs', import.meta.url).pathname;
await build({ entryPoints: [new URL('../src/app-ask.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /^\.\/app-identity$/ }, () => ({ path: 'identity', namespace: 'fixture' }));
  b.onResolve({ filter: /^\.\/ai$/ }, () => ({ path: 'ai', namespace: 'fixture' }));
  b.onResolve({ filter: /^\.\/app-voice$/ }, () => ({ path: 'voice', namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'voice'
    ? `export async function listen(env, account, audio) { env.voice.push({kind:'listen', account, bytes: audio.byteLength}); return {ok:true,text:'Who was Judah'} } export async function speak(env, account, text, voice) { env.voice.push({kind:'speak', account, text, voice}); return new Response(new Uint8Array([1,2,3]), {headers:{'content-type':'audio/mpeg'}}) }`
    : args.path === 'identity'
    ? `export async function appReader(req) { return req.headers.get('authorization') === 'Bearer fixture' ? {uid:'firebase-alice'} : null }`
    : `const model = {id:'@cf/free',name:'Free',provider:'Cloudflare'}; const claudeModel = {id:'claude-haiku-4-5',name:'Haiku',provider:'Anthropic',format:'anthropic'}; export const appPaidModels = () => [claudeModel]; export async function answerAppPaid(env,q,owner,account,history,consent,opts) { env.calls.push({q,owner,account,consent,model:opts.model,paid:true}); return env.paidResult ?? {ok:true,answer:'A paid answer',sources:[],model:claudeModel.id,provider:claudeModel.provider,ms:1} } export const appAskModels = () => [model]; export const freeModel = () => model; export const takeQuotaKey = async () => true; export async function answerApp(env,q,account,history,consent,ms,opts) { env.calls.push({q,account,history,consent,model:opts.model}); opts.emit?.({delta:'An answer'}); return {ok:true,answer:'An answer',sources:[{n:1,title:'Source',url:'/classes/a',text:'private passage'}],model:model.id,provider:model.provider,ms:1} }` }));
}}] });
const { appAsk } = await import(out);
const env = { PRIVACY_KEY: 'fixture-key', calls: [], voice: [], SUBS: { put: async () => {} } };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
const request = (path, body, authorization = 'Bearer fixture') => appAsk.request(`https://example.test${path}`, { method: body ? 'POST' : 'GET', headers: { authorization, 'content-type':'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env, ctx);
test('models, reports and answers all reject an unauthenticated caller', async () => {
  for (const [path, body] of [['/models'], ['/', {q:'Hello'}], ['/report', {reason:'wrong'}]]) assert.equal((await request(path,body,'')).status,401);
});
test('paid or invented models cannot bypass free-only access', async () => {
  const before = env.calls.length;
  assert.equal((await request('/', {q:'Who is Judah?',model:'anthropic/paid',consent:['Cloudflare']})).status,400);
  assert.equal(env.calls.length,before);
  const result = await (await request('/models')).json();
  assert.equal(result.billing.purchasesEnabled,false);
  assert.equal(result.models.length,1);
});
test('provider consent comes before inference', async () => {
  const before=env.calls.length;
  const response=await request('/',{q:'Who is Judah?'});
  assert.equal(response.status,428);
  assert.equal(env.calls.length,before);
});
test('Firebase caller gets Telegram-compatible streaming without any Telegram identity', async () => {
  const response=await request('/', {q:'Who is Judah?',stream:true,consent:['Cloudflare'],uid:'victim',history:[]});
  assert.match(response.headers.get('content-type'),/ndjson/);
  const events=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events[0].delta,'An answer');
  assert.equal(events.at(-1).done,true);
  assert.equal(events.at(-1).sources[0].text,undefined);
  assert.notEqual(env.calls.at(-1).account,'victim');
  assert.notEqual(env.calls.at(-1).account,'firebase-alice');
});

test('the inference stop switch rejects new questions without calling a model', async () => {
  const before = env.calls.length;
  env.ASK_APP_ENABLED = 'off';
  try {
    assert.equal((await request('/', {q:'Who is Judah?',ui:'study-v1',consent:['Cloudflare']})).status, 503);
    assert.equal(env.calls.length, before);
  } finally { delete env.ASK_APP_ENABLED; }
});

test('trace IDs correlate requests without logging the question, token or account', async () => {
  const traceId = '9b3dc198-81d0-46a4-a019-e5985901661b';
  const logs = [], original = console.log;
  console.log = value => logs.push(value);
  try {
    const response = await appAsk.request('https://example.test/', {method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json','x-trace-id':traceId},body:JSON.stringify({q:'Private question sentinel',consent:['Cloudflare']})}, env, ctx);
    assert.equal(response.headers.get('x-trace-id'), traceId);
    assert.equal(response.headers.get('access-control-expose-headers'), 'X-Trace-ID');
    assert.ok(logs.some(line => JSON.parse(line).traceId === traceId));
    assert.ok(logs.every(line => !/Private question|firebase-alice|Bearer/.test(line)));
    const invalid = await appAsk.request('https://example.test/models', {headers:{authorization:'Bearer fixture','x-trace-id':'email@example.test'}}, env, ctx);
    assert.match(invalid.headers.get('x-trace-id'), /^[a-f0-9-]{36}$/);
  } finally { console.log = original; }
});
test('oversized request streams are rejected before inference', async () => {
  const before = env.calls.length;
  const response = await request('/', {q:'a'.repeat(40000),consent:['Cloudflare']});
  assert.equal(response.status, 413);
  assert.equal(env.calls.length, before);
});

test("voice needs a sign-in and the agreement to the free models' provider before any audio is heard or read", async () => {
  const audio = (headers) => appAsk.request('https://example.test/listen', { method: 'POST', headers: { 'content-type': 'audio/webm', ...headers }, body: new Uint8Array(40000) }, env, ctx);
  assert.equal((await audio({})).status, 401);
  assert.equal((await audio({ authorization: 'Bearer fixture' })).status, 428);
  assert.equal((await request('/speak', { text: 'An answer', voice: 'orpheus' })).status, 428);
  assert.equal(env.voice.length, 0);
  const heard = await audio({ authorization: 'Bearer fixture', 'x-ai-consent': 'Cloudflare (Workers AI)' });
  assert.equal(heard.status, 200, 'a spoken question larger than a text request is accepted');
  assert.deepEqual(await heard.json(), { text: 'Who was Judah' });
  const read = await request('/speak', { text: 'An answer', voice: 'orpheus', consent: ['Cloudflare (Workers AI)'] });
  assert.equal(read.headers.get('content-type'), 'audio/mpeg');
  assert.ok(env.voice.every((v) => v.account && v.account !== 'firebase-alice'), 'the account is a keyed hash, never the raw UID');
});

test("credit packs stay closed until ASK_PURCHASES is on: no paid models, no wallet", async () => {
  const models = await (await request('/models')).json();
  assert.equal(models.billing.purchasesEnabled, false);
  assert.ok(models.models.every(m => !m.paid));
  assert.deepEqual(await (await request('/wallet')).json(), { purchasesEnabled: false });
  const refused = await request('/', { q: 'Who was Judah?', model: 'claude-haiku-4-5', consent: ['Anthropic'] });
  assert.equal(refused.status, 400, 'a paid model is not reachable while packs are closed');
});

test("with packs open, a Claude model is paid from the account's own balance, named only by its purchase id", async () => {
  env.ASK_PURCHASES = 'on';
  try {
    const models = await (await request('/models')).json();
    assert.equal(models.billing.purchasesEnabled, true);
    assert.ok(models.models.some(m => m.id === 'claude-haiku-4-5' && m.paid));
    env.calls.length = 0;
    const res = await request('/', { q: 'Who was Judah?', model: 'claude-haiku-4-5', consent: ['Anthropic'] });
    assert.equal(res.status, 200);
    const call = env.calls.at(-1);
    assert.equal(call.paid, true);
    assert.match(call.owner, /^app:[0-9a-f]{64}$/);
    assert.ok(!call.owner.includes('firebase-alice'), 'the Firebase UID is never the balance name');
    assert.notEqual(call.owner.slice(4), call.account, 'the purchase id is not the Ask quota key');
    env.paidResult = { ok: false, reason: 'credits', available_mc: 10, need_mc: 1000 };
    const broke = await request('/', { q: 'Who was Judah?', model: 'claude-haiku-4-5', consent: ['Anthropic'] });
    assert.equal(broke.status, 402);
    assert.deepEqual(await broke.json(), { error: 'credits', available_mc: 10, need_mc: 1000 });
  } finally { delete env.ASK_PURCHASES; delete env.paidResult; }
});
