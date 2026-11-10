import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { modelOf } from '../../shared/ask-models.mjs';
import { callUsd } from '../../shared/credits.mjs';

const out = new URL('./.build/backup-answer.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/backup-answer.ts"; export {freeSpendToday} from "./src/free-budget.ts";', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const { backupOnce, backupPieces, freeSpendToday } = await import(out);
const model = modelOf('@cf/moonshotai/kimi-k2.6'); // the backup model (ai.mjs ANSWER_MODEL)
const messages = [{ role: 'system', content: 'Use only the existing provided material.' }, { role: 'user', content: 'Existing recorded source words.' }];

test('the expanded backup fits its model and sponsor reservation and settles measured usage', async t => {
  const { env } = financialDb(t), calls = [], usage = { prompt_tokens: 1000, completion_tokens: 1200 };
  Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '1', ASK_FREE_MAX_USD: '0.05', AI: { run: async (id, input) => { calls.push({ id, input }); return { response: 'An existing answer.', usage }; } } });
  assert.equal(await backupOnce(env, messages), 'An existing answer.');
  assert.equal(calls[0].id, model.id);
  assert.ok(calls[0].input.max_tokens > 900 && calls[0].input.max_tokens < 24000);
  assert.ok(calls[0].input.max_tokens * model.output / 1e6 < 0.05);
  assert.ok(Math.abs(await freeSpendToday(env) - callUsd(usage, model)) <= 1e-6);
});

test('an exhausted sponsor allowance blocks the backup before any provider call', async t => {
  const { env } = financialDb(t);
  let called = false;
  Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '0', AI: { run: async () => { called = true; } } });
  await assert.rejects(backupOnce(env, messages), /allowance is exhausted/);
  assert.equal(called, false);
});

for (const streaming of [false, true]) {
  test(`${streaming ? 'streaming' : 'one-piece'} backup still returns attributed source excerpts when its allowance is unavailable`, async t => {
    for (const brokenCounter of [false, true]) {
      const { env } = financialDb(t);
      let calls = 0;
      Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '0', AI: { run: async () => { calls++; throw new Error('must not infer'); } } });
      if (brokenCounter) env.DB = { batch: async () => { throw new Error('counter unavailable'); } };
      const sources = [{ kind: 'note', title: 'No text', url: '/empty', text: '' }, { kind: 'spoken', title: 'Recorded source', url: '/recorded', text: 'Exact existing words.\nThe next recorded line.' }];
      let answer;
      const wrote = {};
      if (streaming) { answer = ''; for await (const piece of backupPieces(env, messages, false, sources, undefined, wrote)) answer += piece; assert.equal(wrote.model, undefined, 'no model wrote the notice and excerpts'); }
      else answer = await backupOnce(env, messages, false, sources);
      assert.match(answer, /can't generate a new answer right now/);
      assert.match(answer, /\*\*Recorded source\*\* \[2\]/);
      assert.ok(answer.includes('> Exact existing words.\n> The next recorded line.'));
      assert.equal(calls, 0);
    }
  });
}

test('missing usage and failed calls keep their full reservation rather than funding another answer', async t => {
  for (const fail of [false, true]) {
    const { env } = financialDb(t);
    let calls = 0;
    Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '0.05', ASK_FREE_MAX_USD: '0.05', AI: { run: async () => { calls++; if (fail) throw new Error('fixture timeout'); return { response: 'Existing answer.' }; } } });
    if (fail) await assert.rejects(backupOnce(env, messages), /fixture timeout/);
    else assert.equal(await backupOnce(env, messages), 'Existing answer.');
    assert.equal(await freeSpendToday(env), 0.05);
    await assert.rejects(backupOnce(env, messages), /allowance is exhausted/);
    assert.equal(calls, 1);
  }
});

test('fragmented backup streams preserve text and settle the final usage frame without a trailing delimiter', async t => {
  const { env } = financialDb(t), usage = { prompt_tokens: 100, completion_tokens: 400 };
  const data = new TextEncoder().encode(`data: ${JSON.stringify({ response: 'Existing ' })}\n\ndata: ${JSON.stringify({ response: 'material.' })}\n\ndata: ${JSON.stringify({ usage })}`);
  Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '1', ASK_FREE_MAX_USD: '0.05', AI: { run: async () => new ReadableStream({ start(controller) { for (let at = 0; at < data.length; at += 7) controller.enqueue(data.slice(at, at + 7)); controller.close(); } }) } });
  let answer = '';
  const wrote = {};
  for await (const part of backupPieces(env, messages, false, [], undefined, wrote)) answer += part;
  assert.equal(answer, 'Existing material.');
  assert.equal(wrote.model, model.id, 'the model that wrote it is reported');
  assert.ok(Math.abs(await freeSpendToday(env) - callUsd(usage, model)) <= 1e-6);
});

test('an abandoned backup stream is cancelled and retains its unreported spending reservation', async t => {
  const { env } = financialDb(t);
  let cancelled = false;
  Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '1', ASK_FREE_MAX_USD: '0.05', AI: { run: async () => new ReadableStream({ pull(controller) { controller.enqueue(new TextEncoder().encode('data: {"response":"Existing text"}\n\n')); }, cancel() { cancelled = true; } }) } });
  const stream = backupPieces(env, messages);
  assert.equal((await stream.next()).value, 'Existing text');
  await stream.return();
  assert.equal(cancelled, true);
  assert.equal(await freeSpendToday(env), 0.05);
});

test('admin backup reserves a separate daily pool without using the shared reader pool', async t => {
  const { env, sql } = financialDb(t);
  Object.assign(env, { ASK_FREE_DAILY_USD_CAP: '0', AI: { run: async () => ({ response: 'Existing answer.', usage: { prompt_tokens: 100, completion_tokens: 100 } }) } });
  assert.equal(await backupOnce(env, messages, true), 'Existing answer.');
  assert.equal(sql.prepare("SELECT count(*) AS n FROM free_spend_holds WHERE day LIKE 'admin:%'").get().n, 1);
  assert.equal(await freeSpendToday(env), 0);
});
