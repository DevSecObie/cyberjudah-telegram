import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { signInitData } from '../src/initdata.mjs';
import { ANSWER_MODEL } from '../src/ai.mjs';
import { MODELS, FRONTIER_ORDER, FAST, modelOf } from '../../shared/ask-models.mjs';
import { ALLOWLIST_IDS, ALLOWLIST_MODELS, checkModelAllowlist, isAllowlistedModel, modelAllowlistMode, allowlistedModels } from '../../shared/ask-allowlist.mjs';

const out = new URL('./.build/model-allowlist.mjs', import.meta.url).pathname;
await build({
  stdin: { contents: 'export { default as worker } from "./src/index"; export * from "./src/ai"; export * from "./src/ask-routing"; export * from "./src/credits";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error',
  plugins: [{ name: 'offline-fixtures', setup(b) {
    b.onResolve({ filter: /^\.\/agent$/ }, () => ({ path: 'agent', namespace: 'fixture' }));
    b.onResolve({ filter: /^\.\/app-identity$/ }, (args) => args.importer.endsWith('/app-ask.ts') ? { path: 'identity', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ loader: 'js', contents: path === 'identity'
      ? `export async function appReader(req) { return req.headers.get('authorization') === 'Bearer fixture' ? {uid:'preview-fixture'} : null }`
      : `export async function runAgent(env,q,history,first,retrieve,emit,ctx,uid,model) {
          env.calls.push(model.id); emit({delta:'Preview test (not an answer) [1].'});
          return {text:'Preview test (not an answer) [1].',passages:[{kind:'spoken',title:'Preview test (not an answer)',url:'/classes/preview',text:'Preview test (not an answer).'}],actions:[],cut:false};
        }` }));
  } }],
});
const api = await import(out);
const excluded = 'openai/gpt-5.1';
const excludedFree = '@cf/openai/gpt-oss-120b';
const listed = modelOf('claude-sonnet-5-5');
const q = 'Preview test (not an answer)';
const configuredModel = (id) => {
  const model = MODELS.find((m) => m.id === id) ?? MODELS.find((m) => m.native === id);
  assert.ok(model, `Configured model is not in the catalog: ${id}`);
  return model.id;
};

function setup(t, mode, extra = {}) {
  const fixture = financialDb(t);
  Object.assign(fixture.env, { ASK_MODEL_ALLOWLIST_MODE: mode, AI_GATEWAY: 'fixture', ANTHROPIC_API_KEY: 'fixture', CLAUDE_MODEL: listed.id, ASK_FREE_MODEL: '@cf/google/gemma-4-26b-a4b-it', ASK_FREE_DAILY_USD_CAP: '2', calls: [], aiCalls: [], AI: { run: async (...args) => { fixture.env.aiCalls.push(args[0]); return { data: [] }; } } }, extra);
  return fixture;
}
async function request(env, body, path = '/api/ask') {
  const auth = path.startsWith('/api/app/') ? 'Bearer fixture' : `tma ${await signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: { id: 77, first_name: 'Fixture' } }, env.BOT_TOKEN)}`;
  return api.worker.fetch(new Request(`https://cyberjudah.io${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, { waitUntil: () => {}, passThroughOnException: () => {} });
}
async function capture(work) {
  const messages = [], previous = console.log;
  console.log = (...args) => messages.push(args);
  try { return { value: await work(), misses: messages.flatMap(([value]) => { try { const event = JSON.parse(value); return event.event === 'ask_model_allowlist_miss' ? [event] : []; } catch { return []; } }) }; }
  finally { console.log = previous; }
}

test('seed is exactly the existing frontier/fast routes, configured model vars and backup', async () => {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const pins = [...config.matchAll(/"(?:CLAUDE_MODEL(?:_[A-Z_]+)?|ASK_FREE(?:_DEEP)?_MODEL|ASK_FREE_MODELS)"\s*:\s*"([^"]*)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  const expected = new Set([...FRONTIER_ORDER, ...FAST, ...pins.map(configuredModel), configuredModel(ANSWER_MODEL)]);
  assert.deepEqual([...ALLOWLIST_IDS].sort(), [...expected].sort());
  assert.equal(new Set(ALLOWLIST_IDS).size, ALLOWLIST_IDS.length);
  assert.ok(ALLOWLIST_IDS.length < MODELS.length, 'catalog refreshes do not silently allow every candidate');
  for (const id of ALLOWLIST_IDS) assert.ok(MODELS.some((m) => m.id === id), id);
  assert.equal((config.match(/"ASK_MODEL_ALLOWLIST_MODE": "shadow"/g) ?? []).length, 2, 'production and staging observe only');
  for (const [, id] of config.matchAll(/"SEARCH_AI_MODEL"\s*:\s*"([^"]+)"/g)) assert.ok(expected.has(configuredModel(id)), 'configured search model is already in the exact routing seed');
});

test('catalog aliases cannot collide with another model id or native alias', () => {
  const aliases = new Map();
  for (const model of MODELS) for (const alias of [model.id, model.native].filter(Boolean)) {
    assert.ok(!aliases.has(alias) || aliases.get(alias) === model.id, `Ambiguous catalog alias: ${alias}`);
    aliases.set(alias, model.id);
    assert.equal(isAllowlistedModel(alias), ALLOWLIST_IDS.includes(modelOf(alias).id));
  }
});

test('seed validation rejects an unknown configured id instead of accepting modelOf fallback', () => {
  assert.throws(() => configuredModel('@cf/preview/not-catalogued'), /Configured model is not in the catalog/);
  assert.equal(configuredModel('claude-sonnet-5-5'), listed.id);
});

test('each allowlisted id records snapshot/alias status without guessing pins from a suffix', () => {
  for (const entry of ALLOWLIST_MODELS) {
    assert.ok(['moving-alias', 'pinned-snapshot'].includes(entry.idKind));
    assert.equal(entry.idKind, 'moving-alias', 'initial catalog has no verified immutable snapshot contract');
    assert.ok(Object.isFrozen(entry));
  }
  assert.ok(Object.isFrozen(ALLOWLIST_MODELS));
  assert.ok(Object.isFrozen(ALLOWLIST_IDS));
});

test('default/invalid mode is shadow; native aliases resolve only to catalog ids', async () => {
  for (const value of [undefined, '', 'invalid', 'ENFORCE']) assert.equal(modelAllowlistMode({ ASK_MODEL_ALLOWLIST_MODE: value }), 'shadow');
  assert.equal(isAllowlistedModel('claude-sonnet-5-5'), true);
  assert.equal(isAllowlistedModel('claude-sonnet-5'), false);
  const { misses } = await capture(() => {
    assert.equal(checkModelAllowlist({}, 'claude-sonnet-5'), true);
    assert.equal(checkModelAllowlist({}, 'Private request input\nnot-a-catalog-id'), true);
  });
  assert.deepEqual(misses, [{ event: 'ask_model_allowlist_miss', model: modelOf('claude-sonnet-5').id }, { event: 'ask_model_allowlist_miss', model: null }]);
});

for (const mode of ['off', 'shadow', 'enforce']) {
  test(`${mode}: helper gates only in enforce and logs only a canonical model id in shadow`, async () => {
    const env = { ASK_MODEL_ALLOWLIST_MODE: mode };
    const { misses } = await capture(() => {
      assert.equal(checkModelAllowlist(env, excluded), mode !== 'enforce');
      assert.equal(checkModelAllowlist(env, listed.id), true);
      assert.equal(checkModelAllowlist(env, 'not-a-model'), mode !== 'enforce');
    });
    assert.deepEqual(misses, mode === 'shadow' ? [{ event: 'ask_model_allowlist_miss', model: excluded }, { event: 'ask_model_allowlist_miss', model: null }] : []);
    const offered = allowlistedModels(env, MODELS);
    if (mode !== 'enforce') assert.equal(offered, MODELS);
    else assert.deepEqual(offered.map((m) => m.id).sort(), [...ALLOWLIST_IDS].sort());
  });

  test(`${mode}: Telegram and native picker filter only in enforce`, async (t) => {
    const { env } = setup(t, mode);
    const telegram = await (await request(env, undefined, '/api/ask/account')).json();
    assert.equal(telegram.models.some((m) => m.id === excluded), mode !== 'enforce');
    assert.equal(telegram.models.length, mode === 'enforce' ? ALLOWLIST_IDS.length : MODELS.length);
    const native = await (await request(env, undefined, '/api/app/ask/models')).json();
    assert.equal(native.models.some((m) => m.id === excludedFree), mode !== 'enforce');
    if (mode === 'enforce') for (const m of [...telegram.models, ...native.models]) assert.ok(isAllowlistedModel(m.id));
  });

  for (const stream of [false, true]) test(`${mode}: ${stream ? 'NDJSON' : 'JSON'} Telegram choice is served/blocked before consent and billing`, async (t) => {
    const { env, sql } = setup(t, mode);
    const { value: response, misses } = await capture(() => request(env, { q, model: excluded, stream }));
    assert.equal(response.status, mode === 'enforce' ? 403 : 428);
    const failure = await response.json();
    assert.equal(failure.error, mode === 'enforce' ? 'model-not-allowed' : 'consent');
    if (mode === 'enforce') assert.ok(failure.message);
    assert.deepEqual(misses, mode === 'shadow' ? [{ event: 'ask_model_allowlist_miss', model: excluded }] : []);
    assert.deepEqual(env.calls, []); assert.deepEqual(env.aiCalls, []);
    const tables = sql.prepare("SELECT name FROM sqlite_master WHERE name IN ('credit_holds','free_budget_reservations')").all();
    assert.deepEqual(tables, [], 'no reservation/hold work before rejection or consent');
  });

  test(`${mode}: a consented unlisted model is still served outside enforce`, async (t) => {
    const { env } = setup(t, mode, { ASK_BILLING: 'off' });
    const { value: response, misses } = await capture(async () => {
      const r = await request(env, { q, model: excluded, stream: true, consent: ['OpenAI'] });
      await r.text(); return r;
    });
    assert.equal(response.status, mode === 'enforce' ? 403 : 200);
    assert.deepEqual(env.calls, mode === 'enforce' ? [] : [excluded]);
    assert.deepEqual(misses, mode === 'shadow' ? [{ event: 'ask_model_allowlist_miss', model: excluded }] : []);
  });

  test(`${mode}: unknown Telegram ids keep the fallback in shadow without logging raw input`, async (t) => {
    const { env } = setup(t, mode, { ASK_BILLING: 'off' });
    const unknown = 'Private untrusted model input\nnot-a-catalog-id';
    const { value: response, misses } = await capture(async () => {
      const r = await request(env, { q, model: unknown, stream: true, consent: ['Anthropic'] });
      await r.text(); return r;
    });
    assert.equal(response.status, mode === 'enforce' ? 403 : 200);
    assert.deepEqual(env.calls, mode === 'enforce' ? [] : [listed.id]);
    assert.deepEqual(misses, mode === 'shadow' ? [{ event: 'ask_model_allowlist_miss', model: null }] : []);
    assert.equal(JSON.stringify(misses).includes(unknown), false);
  });

  test(`${mode}: native request cannot bypass the picker; shadow still answers`, async (t) => {
    const { env } = setup(t, mode);
    const { value: response, misses } = await capture(async () => {
      const r = await request(env, { q, model: excludedFree, consent: ['Cloudflare (Workers AI)'] }, '/api/app/ask');
      await r.text(); return r;
    });
    assert.equal(response.status, mode === 'enforce' ? 403 : 200);
    assert.deepEqual(env.calls, mode === 'enforce' ? [] : [excludedFree]);
    assert.deepEqual(misses, mode === 'shadow' ? [{ event: 'ask_model_allowlist_miss', model: excludedFree }] : []);
  });
}

test('enforce: listed picks still require provider consent and exact-model cost confirmation', async (t) => {
  const { env } = setup(t, 'enforce');
  let response = await request(env, { q, model: 'claude-sonnet-5-5', stream: true });
  assert.equal(response.status, 428);
  response = await request(env, { q, model: listed.id, stream: true, consent: ['Anthropic'] });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'confirm');
  assert.deepEqual(env.calls, []);
});

for (const model of [undefined, 'auto']) test(`shadow: ${model ?? 'default'} miss logs exactly once without changing its served model`, async (t) => {
  const { env } = setup(t, 'shadow', { CLAUDE_MODEL: excluded, ASK_BILLING: 'off' });
  const { value: response, misses } = await capture(async () => {
    const r = await request(env, { q: 'Can I return to the existing preview fixture?', model, stream: true, consent: ['OpenAI'] });
    await r.text(); return r;
  });
  assert.equal(response.status, 200); assert.deepEqual(env.calls, [excluded]);
  assert.deepEqual(misses, [{ event: 'ask_model_allowlist_miss', model: excluded }]);
});

test('enforce: unknown picks and unlisted defaults cannot fall through modelOf or Auto', async (t) => {
  const { env } = setup(t, 'enforce', { CLAUDE_MODEL: excluded });
  for (const model of ['not-a-model', 'auto']) {
    const response = await request(env, { q: 'Can I return to the existing preview fixture?', model, stream: true, consent: ['OpenAI'] });
    assert.equal(response.status, 403); assert.equal((await response.json()).error, 'model-not-allowed');
  }
  const legacy = await request(env, { q, consent: ['OpenAI'] });
  assert.equal(legacy.status, 403); assert.equal((await legacy.json()).error, 'model-not-allowed');
  assert.deepEqual(env.calls, []); assert.deepEqual(env.aiCalls, []);
});

test('enforce: native study and agent entry points reject before cache or budget access', async (t) => {
  const { env } = setup(t, 'enforce');
  for (const answer of [api.answerApp, api.answerAppAgent]) {
    const result = await answer(env, q, 'preview-account', [], [], ...(answer === api.answerApp ? [1000, { model: excludedFree }] : [{ model: excludedFree }]));
    assert.deepEqual(result, { ok: false, reason: 'model-not-allowed' });
  }
  env.ASK_FREE_MODELS = excludedFree;
  const offered = await (await request(env, undefined, '/api/app/ask/models')).json();
  assert.deepEqual(offered.models, []); assert.equal(offered.default, null, 'never advertise a hidden default');
  assert.deepEqual(env.calls, []); assert.deepEqual(env.aiCalls, []);
});

test('enforce: automatic quick/deep routes select only allowlisted candidates', async (t) => {
  const { env } = setup(t, 'enforce', { ASK_BILLING: 'off' });
  for (const question of ['Preview', 'Compare preview fixtures']) {
    const model = await api.autoModel(env, question, 0, 77, listed, api.freeModels(env), false);
    assert.ok(isAllowlistedModel(model.id));
  }
});

test('enforce: an unlisted configured search model is refused before work begins', async (t) => {
  const { env } = setup(t, 'enforce', { SEARCH_AI_MODEL: excludedFree });
  assert.equal(api.searchModel(env), null);
  const result = await api.answerSearch(env, q, 77, ['Cloudflare (Workers AI)']);
  assert.equal(result.ok, false); assert.deepEqual(env.calls, []); assert.deepEqual(env.aiCalls, []);
});

for (const [index, backup] of [excludedFree, '@cf/preview/not-catalogued'].entries()) test(`enforce: ${index ? 'unknown' : 'unlisted'} backup cannot reserve money or reach a provider`, async () => {
  const output = new URL(`./.build/model-allowlist-backup-${index}.mjs`, import.meta.url).pathname;
  await build({ entryPoints: [new URL('../src/backup-answer.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: output, logLevel: 'error', plugins: [{ name: 'unlisted-backup', setup(b) {
    b.onResolve({ filter: /^\.\/ai\.mjs$/ }, (args) => args.importer.endsWith('/backup-answer.ts') ? { path: 'backup-model', namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `export const ANSWER_MODEL = '${backup}';` }));
  } }] });
  const { backupOnce, backupPieces } = await import(output);
  const noCall = () => { throw new Error('must not access budget/provider'); };
  const env = { ASK_MODEL_ALLOWLIST_MODE: 'enforce', DB: { prepare: noCall, batch: noCall }, AI: { run: noCall } };
  await assert.rejects(backupOnce(env, []), /This model is not available for Ask/);
  await assert.rejects(async () => { for await (const _piece of backupPieces(env, [])) assert.fail('blocked backup emitted text'); }, /This model is not available for Ask/);
});
