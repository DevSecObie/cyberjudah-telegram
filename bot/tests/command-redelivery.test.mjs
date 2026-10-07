import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';

const out = new URL('./.build/command-redelivery.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { createBot } from "./src/bot"; export { pid, seal } from "./src/privacy.mjs";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const api = await import(out);

async function setup(t, id = 97123) {
  const fixture = financialDb(t), { env } = fixture;
  const telegram = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: { id: 100000001, is_bot: true, first_name: 'Local', username: 'local_test_bot' } })); });
  await new Promise(resolve => telegram.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => telegram.close(resolve)));
  env.TELEGRAM_API_ROOT = `http://127.0.0.1:${telegram.address().port}`;
  const bot = await api.createBot(env, 'http://127.0.0.1');
  const update = { update_id: id, message: { message_id: 1, date: 1, from: { id: 77, first_name: 'Local', is_bot: false }, chat: { id: 77, type: 'private' }, text: '/daily', entities: [{ type: 'bot_command', offset: 0, length: 6 }] } };
  const key = `sub:${await api.pid(env, 77)}`;
  return { ...fixture, bot, update, key };
}

for (const wasOn of [false, true]) {
  test(`a failed reply and redelivery preserve the daily subscription turning ${wasOn ? 'off' : 'on'}`, async t => {
    const { env, bot, update, key } = await setup(t);
    if (wasOn) await env.SUBS.put(key, await api.seal(env, key, { chatId: 77, hour: 8, tz: 0 }));
    let replies = 0;
    bot.api.config.use(async (_prev, method) => {
      if (method === 'sendMessage' && ++replies === 1) throw new Error('temporary reply failure');
      return { ok: true, result: true };
    });
    await assert.rejects(bot.handleUpdate(update), /temporary reply failure/);
    assert.equal(Boolean(await env.SUBS.get(key)), !wasOn);
    await bot.handleUpdate(update);
    assert.equal(Boolean(await env.SUBS.get(key)), !wasOn, 'redelivery must not reverse the completed choice');
    assert.equal(replies, 1, 'redelivery does not execute the command again');
    await bot.handleUpdate({ ...update, update_id: update.update_id + 1 });
    assert.equal(Boolean(await env.SUBS.get(key)), wasOn, 'a new command can intentionally change the choice');
  });
}

test('existing command markers remain respected after deployment', async t => {
  const { env, bot, update, key } = await setup(t);
  await env.SUBS.put(`webhook:${update.update_id}`, '1');
  bot.api.config.use(async () => assert.fail('an already handled command must not reply again'));
  await bot.handleUpdate(update);
  assert.equal(await env.SUBS.get(key), null);
});

test('a failed command marker is retried before any effect; payment completion storage is not used', async t => {
  const { env, bot, update, key, fail } = await setup(t);
  const put = env.SUBS.put;
  let rejectMarker = true;
  env.SUBS.put = async (k, ...args) => {
    if (k.startsWith('webhook:') && rejectMarker) { rejectMarker = false; throw new Error('marker unavailable'); }
    return put(k, ...args);
  };
  bot.api.config.use(async () => ({ ok: true, result: true }));
  await assert.rejects(bot.handleUpdate(update), /marker unavailable/);
  assert.equal(await env.SUBS.get(key), null, 'failed dedup storage must not toggle the subscription');
  // The payment completion write must not run after a non-idempotent command effect.
  fail(/UPDATE webhook_updates SET state/);
  await bot.handleUpdate(update);
  await bot.handleUpdate(update);
  assert.ok(await env.SUBS.get(key), 'no later completion failure can release this command for replay');
});
