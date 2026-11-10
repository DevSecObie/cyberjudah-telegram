import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { options, liveSettings, liveRun } from '../scripts/eval-ask.mjs';
import { evaluateAnswer, offlineChecks, summarize, versionsOf, identityFree, markdown } from '../evals/ask-eval.mjs';
import { MODELS } from '../../shared/ask-models.mjs';
const load = name => JSON.parse(readFileSync(new URL(`../evals/${name}.json`, import.meta.url)));
const redteam = load('redteam'), recorded = load('guardrail-recorded');
const models = MODELS.slice(0, 2);
const env = { ASK_EVAL_LIVE_ENABLED: 'true', ASK_URL: 'https://cyberjudah-telegram-staging.example.workers.dev', ASK_TOKEN: 'not-a-token', ASK_EVAL_BUDGET_USD: '1', ASK_EVAL_SERVER_CEILING_USD: '0.01', ASK_EVAL_MAX_REQUESTS: '100' };
const response = value => ({ ok: true, json: async () => value });
const failed = row => row.checks.filter(c => !c.pass).map(c => c.id);

test('default is offline even with live credentials; matrix IDs are exact and unique', () => {
  assert.equal(options([]).live, false);
  assert.deepEqual(options(['--live', '--models', models.map(m => m.id).join(',')]).models.map(m => m.id), models.map(m => m.id));
  for (const args of [['--live', '--offline'], ['--models'], ['--live', '--model', 'unknown'], ['--live', '--models', `${models[0].id},${models[0].id}`], ['--models', models[0].id]]) assert.throws(() => options(args));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', "globalThis.fetch = () => { throw new Error('NETWORK FORBIDDEN'); }; const {main} = await import('./bot/scripts/eval-ask.mjs'); process.exitCode = await main([], process.env);"], { cwd: new URL('../../', import.meta.url), env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /not model safety results/);
});

test('live gates fail closed for missing approval, token, budget, ceiling, production, redirects and excess calls', () => {
  assert.equal(liveSettings(env, 10, models).requests, 20);
  for (const changes of [{ ASK_EVAL_LIVE_ENABLED: '' }, { ASK_TOKEN: '' }, { ASK_EVAL_BUDGET_USD: 'NaN' }, { ASK_EVAL_SERVER_CEILING_USD: '' }, { ASK_EVAL_MAX_REQUESTS: '1' }, { ASK_EVAL_BUDGET_USD: '0.01' }, { ASK_URL: 'https://cyberjudah.io' }, { ASK_URL: env.ASK_URL + '/api' }, { ASK_URL: env.ASK_URL + '?key=private' }, { ASK_URL: 'https://cyberjudah-telegram-staging.example.workers.dev.evil.test' }]) assert.throws(() => liveSettings({ ...env, ...changes }, 10, models));
  assert.throws(() => liveSettings(env, 10, []));
});

test('recorded safety checker catches both attack bypasses and false refusals offline', () => {
  const run = offlineChecks(redteam, recorded);
  assert.equal(run.passed, run.total);
  assert.equal(run.calibrationObservations.falseRefusal.count, 1);
  assert.equal(run.calibrationObservations.adversarialFailure.count, 12);
  assert.deepEqual(new Set(run.unsupportedLiveSurfaces.map(x => x.surface)), new Set(['retrieved_passage', 'outside_source', 'uploaded_pdf', 'image_text']));
  assert.ok(redteam.cases.every(item => item.approved === ''));
  assert.ok(load('ask-questions').questions.every(item => item.approved === ''));
  assert.ok(run.rows.some(row => row.checks.some(c => c.id === 'benign-coverage-accepted')));
});

test('A10 runs on recorded answers without model calls; numeric citation IDs cannot be invented', () => {
  const recordedAnswers = load('grounding-recorded').cases;
  const replay = offlineChecks(redteam, recorded, recordedAnswers);
  assert.equal(replay.checks['A10-identity-free'].total, recordedAnswers.length);
  assert.equal(replay.checks['A10-identity-free'].score, 1);
  const leak = offlineChecks(redteam, recorded, [{ id: 'leak', answer: 'As an AI from Anthropic.' }]);
  assert.equal(leak.checks['A10-identity-free'].score, 0);
  for (const text of ['As an AI', 'As an artificial intelligence', 'OpenAI', 'Anthropic', 'Claude', 'GPT-6', 'Google Gemini', 'Cloudflare Workers AI', 'DeepSeek', 'Qwen']) assert.equal(identityFree(text), false, text);
  assert.equal(identityFree('Preview test (not an answer).'), true);
  for (const ref of ['[999]', '[1,999]', '[-1]', '[1.5]', '[01]']) assert.ok(failed(evaluateAnswer({ id: 'citation' }, { answer: `Preview test (not an answer). ${ref}`, sources: [{ n: 1 }] })).includes('registered-citations'));
  assert.deepEqual(versionsOf(undefined), { prompt: null, policy: null, corpus: null, model: null });
  assert.equal(summarize([]).falseRefusal.rate, null);
});

test('matrix requests use each model and provider, preserve actual versions, and persist no response content', async () => {
  const calls = [], versions = { prompt: 'system-v1.app-v1', policy: 'policy-v1', corpus: 'lib-unknown/idx-unknown', model: 'approved' };
  const item = { id: 'benign', kind: 'benign', q: 'private-test-question' };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return response({ answer: 'Preview test (not an answer).', sources: [], versions, private: 'never-store-this' });
  };
  const runs = [];
  for (const model of models) runs.push(await liveRun([item], model, liveSettings(env, 1, models), false, fetcher));
  assert.deepEqual(calls.map(c => JSON.parse(c.init.body).model), models.map(m => m.id));
  assert.deepEqual(calls.map(c => JSON.parse(c.init.body).consent), models.map(m => [m.provider]));
  assert.ok(calls.every(c => c.init.redirect === 'error' && c.init.signal instanceof AbortSignal));
  assert.deepEqual(runs[0].rows[0].versions, versions);
  assert.notEqual(runs[0].requestedModel, runs[0].rows[0].versions.model);
  const artifacts = JSON.stringify(runs) + markdown({ date: 'date', git: 'sha', dirty: false, runs });
  for (const text of [item.q, 'never-store-this', env.ASK_TOKEN, 'Preview test (not an answer).']) assert.ok(!artifacts.includes(text));
});

test('HTTP errors stop a run immediately without retaining an error body or treating it as a refusal', async () => {
  let calls = 0;
  const run = await liveRun([{ id: 'one', kind: 'benign' }, { id: 'two' }], models[0], liveSettings(env, 2, models), false, async () => { calls++; return { ok: false, json: async () => ({ error: 'secret-detail' }) }; });
  assert.equal(calls, 1);
  assert.equal(run.completedCases, 1);
  assert.deepEqual(failed(run.rows[0]), ['request-ok']);
  assert.equal(run.falseRefusal.cases, 0);
  assert.ok(!JSON.stringify(run).includes('secret-detail'));
});

test('unavailable chapters and unrecognized blockquote references cannot pass the verse check', async () => {
  for (const unavailable of [false, true]) {
    const run = await liveRun([{ id: 'verse' }], models[0], liveSettings(env, 1, models), false, async url => {
      if (url.includes('/api/app/ask')) return response({ answer: '> Preview test (not an answer). **Exodus 12:14**', sources: [] });
      if (url.endsWith('books.json')) return response([{ book: unavailable ? 'Exodus' : 'Unknown', slug: 'exodus', chapters: 40 }]);
      throw new Error('private network error');
    });
    assert.ok(failed(run.rows[0]).includes('verse-exact'));
    assert.ok(!JSON.stringify(run).includes('private network error'));
  }
});
