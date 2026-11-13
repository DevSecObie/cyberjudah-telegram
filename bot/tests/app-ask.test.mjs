import { test } from 'node:test';
import { createHmac } from 'node:crypto';
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
    ? `export async function appReader(req) { const a = req.headers.get('authorization') ?? ''; return a === 'Bearer fixture' ? {uid:'firebase-alice'} : a.startsWith('Bearer reader-') ? {uid:a.slice(7)} : null }`
    : `const model = {id:'@cf/free',name:'Free',provider:'Cloudflare'}; export const appAskModels = () => [model]; export const freeModel = () => model; export const takeQuotaKey = async (env, key, limit) => { if (!env.quota) return true; const n = (env.quota.get(key) ?? 0) + 1; env.quota.set(key, n); return n <= limit; }; export const takeAskIpQuota = async () => true; export async function answerApp(env,q,account,history,consent,ms,opts) { env.calls.push({q,account,history,consent,model:opts.model}); env.capturedSignal=opts.signal; if(env.waitForSignal) { env.started?.(); await new Promise((_resolve,reject)=>opts.signal.addEventListener("abort",()=>reject(opts.signal.reason),{once:true})); } opts.emit?.({delta:'An answer'}); return {ok:true,answer:'An answer',sources:[{n:1,title:'Source',url:'/classes/a',text:'private passage'}],model:model.id,provider:model.provider,ms:1,...env.study} } export async function answerAppAgent(env,q,account,history,consent,opts) { return answerApp(env,q,account,history,consent,0,opts) }` }));
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
  assert.deepEqual(events.at(-1).unsupported_refs,[]);
  assert.deepEqual(Object.keys(events.at(-1).versions).sort(),['corpus','model','policy','prompt']);
  assert.equal(events.at(-1).versions.model,'@cf/free','the model that wrote the answer');
  assert.equal(events.at(-1).versions.policy,'policy-v1');
  assert.equal(events.at(-1).sources[0].text,undefined);
  assert.notEqual(env.calls.at(-1).account,'victim');
  assert.notEqual(env.calls.at(-1).account,'firebase-alice');
});

test('native JSON and streaming preserve research status without exposing passage text', async () => {
  const study = { plan: { parts: [{ id: 'p1', ask: 'The question' }] }, coverage: { complete: false, stopped: 'deadline', parts: [{ id: 'p1', status: 'partial', sources: [1] }] }, partial: true, unfinished: [{ id: 'p1', ask: 'The question' }], cut: true };
  const local = { ...env, study };
  for (const stream of [false, true]) {
    const response = await appAsk.request('https://example.test/', { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify({ q: 'Explain the question', consent: ['Cloudflare'], stream }) }, local, ctx);
    const result = stream ? (await response.text()).trim().split('\n').map(JSON.parse).find(event => event.done) : await response.json();
    for (const [key, value] of Object.entries(study)) assert.deepEqual(result[key], value, key);
    assert.equal(result.sources[0].text, undefined);
  }
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


test('native non-stream Ask forwards its incoming request signal without a network call', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const local = { ...env, calls: [], waitForSignal: true, started };
  const controller = new AbortController();
  const pending = appAsk.fetch(new Request('https://example.test/', { method: 'POST', headers: { authorization: 'Bearer fixture', 'content-type': 'application/json' }, body: JSON.stringify({ q: 'Read recorded material', consent: ['Cloudflare'] }), signal: controller.signal }), local, ctx);
  await ready; controller.abort();
  await pending;
  assert.equal(local.capturedSignal.aborted, true);
  assert.equal(local.calls.length, 1);
});

// OWASP LLM10: many new accounts from one address cannot flood answer reports (each may drop a
// cached answer). Only a keyed hash of the address is counted.
test('answer reports are limited per address as well as per account, keyed by a hash of the address', async () => {
  const quota = new Map(), stored = [];
  const e = { ...env, quota, SUBS: { put: async (k) => { stored.push(k); }, get: async () => null, delete: async () => {} } };
  const report = (reader, ip) => appAsk.request('https://example.test/report', { method: 'POST', headers: { authorization: `Bearer reader-${reader}`, 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ reason: 'wrong' }) }, e, ctx);
  const now = Date.now; Date.now = () => 1794052800000;
  try {
    // An unsigned (connecting) address may be the relay, shared by every reader: 60 a minute, each from a different account.
    for (let i = 0; i < 60; i++) assert.equal((await report(`r${i}`, '203.0.113.9')).status, 200, `report ${i}`);
    const over = await report('r-next', '203.0.113.9');
    assert.equal(over.status, 429);
    assert.deepEqual(await over.json(), { error: 'limit' });
    assert.equal(over.headers.get('retry-after'), '60', 'an unsigned address is shut for the rest of the minute only');
    assert.equal((await report('r-other', '198.51.100.4')).status, 200, 'another address is counted on its own');
    // The next minute the shared address answers again: it is never shut for the day.
    Date.now = () => 1794052800000 + 60_000;
    assert.equal((await report('r-later', '203.0.113.9')).status, 200);
    assert.equal(stored.length, 62, 'a refused report is not stored');
    const keys = [...quota.keys()].filter((k) => k.startsWith('app_report_ip:'));
    assert.ok(keys.length >= 2);
    assert.ok(keys.every((k) => !k.includes('203.0.113') && !k.includes('198.51.100')), 'no address is kept, only its keyed hash');
    // The per-account limit still applies.
    for (let i = 0; i < 10; i++) assert.equal((await report('same', '192.0.2.1')).status, 200);
    assert.equal((await report('same', '192.0.2.1')).status, 429);
    // The account is counted first, so an account already refused spends none of its address's allowance.
    assert.ok([...quota.entries()].some(([k, n]) => k.startsWith('app_report_ip:') && n === 10), 'the refused 11th report took no address slot');
  } finally { Date.now = now; }
});

test("a reader's own signed address is limited to 30 reports a day, apart from the relay", async () => {
  const quota = new Map();
  const e = { ...env, quota, MINIAPP_CLIENT_IP_KEY: 'relay-key', SUBS: { put: async () => {}, get: async () => null, delete: async () => {} } };
  const signed = (ip) => { const ts = Math.floor(Date.now() / 1000); return { 'cf-connecting-ip': '203.0.113.9', 'x-cj-client-ip': ip, 'x-cj-client-ts': String(ts), 'x-cj-client-sig': createHmac('sha256', 'relay-key').update(`${ip}|${ts}|POST|/report`).digest('hex') }; };
  const report = (reader, headers) => appAsk.request('https://example.test/report', { method: 'POST', headers: { authorization: `Bearer reader-${reader}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify({ reason: 'wrong' }) }, e, ctx);
  for (let i = 0; i < 30; i++) assert.equal((await report(`s${i}`, signed('198.51.100.7'))).status, 200, `report ${i}`);
  assert.equal((await report('s-next', signed('198.51.100.7'))).status, 429, 'the day is spent for that reader address');
  assert.equal((await report('s-other', signed('198.51.100.8'))).status, 200, 'another reader behind the same relay is not affected');
  assert.ok(![...quota.keys()].some((k) => k.includes('198.51.100') || k.includes('203.0.113')));
});
