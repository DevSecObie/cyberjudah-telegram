import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';
import { modelOf } from '../../shared/ask-models.mjs';

const out = new URL('./.build/financial-integrity.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/credits"; export * from "./src/ai"; export { createBot } from "./src/bot"; export * from "./src/webhook-updates"; export { reserveFreeBudget, settleFreeBudget, sweepFreeBudget } from "./src/free-budget"; export { researchOpen } from "./src/agent-open"; export { makeSpend } from "./src/spend";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const api = await import(out);
const paidModel = modelOf('anthropic/claude-opus-5');
const ledger = (sql, owner) => Number(sql.prepare('SELECT COALESCE(SUM(amount_mc), 0) AS n FROM credit_ledger WHERE user_id = ?').get(owner).n);

test('one paid request id starts once: simultaneous duplicates, completed replay and another owner are refused', async t => {
  const { env, sql } = financialDb(t), uid = 77, owner = await api.ownerOfUser(env, uid);
  await api.grantPayment(env, owner, { charge: 'first-topup', kind: 'pack', stars: 77, mc: 1_000_000 });
  const starts = await Promise.all(Array.from({ length: 8 }, () => api.startMeter(env, uid, paidModel, { request: 'same-request', maxMc: 500_000 })));
  assert.equal(starts.filter(x => x.ok).length, 1);
  assert.ok(starts.filter(x => !x.ok).every(x => x.status === 409 && x.body.error === 'request-used'));
  const first = starts.find(x => x.ok);
  first.meter.spend.modelUsd = 0.01;
  await api.finishMeter(env, first.meter, 'ok');
  const replay = await api.startMeter(env, uid, paidModel, { request: 'same-request', maxMc: 500_000 });
  assert.equal(replay.status, 409);
  const stranger = await api.startMeter(env, 78, paidModel, { request: 'same-request', maxMc: 500_000 });
  assert.equal(stranger.status, 409);
  assert.equal(await api.settle(env, await api.ownerOfUser(env, 78), 'same-request', { actualMc: 1, costUsd: 0 }), null);
  assert.equal((await api.wallet(env, owner)).total_mc, 990_000);
  assert.equal(ledger(sql, owner), 990_000);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM credit_usage').get().n, 1);
  assert.equal((await api.startMeter(env, uid, paidModel, { request: 'fresh-request', maxMc: 500_000 })).ok, true);
});

for (const mode of ['success', 'failed', 'timeout', 'entire-lot-held']) {
  test(`a refund during a ${mode} answer never restores refunded credit and keeps the ledger balanced`, async t => {
    const { env, sql } = financialDb(t), owner = await api.ownerOfUser(env, 77), now = Date.now();
    await api.grantPayment(env, owner, { charge: 'refunded-payment', kind: 'pack', stars: 77, mc: 1_000_000 }, now);
    await api.hold(env, owner, 'held-request', mode === 'entire-lot-held' ? 1_000_000 : 600_000, 1, paidModel.id, now);
    await api.refundPayment(env, owner, 'refunded-payment', now + 1);
    if (mode === 'timeout') await api.sweepHolds(env, now + 21 * 60000);
    else await api.settle(env, owner, 'held-request', { actualMc: mode === 'failed' ? 0 : 100_000, costUsd: 0.1, status: mode }, now + 2);
    assert.equal((await api.wallet(env, owner)).total_mc, 0);
    assert.equal(ledger(sql, owner), 0);
    await api.refundPayment(env, owner, 'refunded-payment', now + 3);
    await api.settle(env, owner, 'held-request', { actualMc: 100_000, costUsd: 0.1 }, now + 4);
    assert.equal((await api.wallet(env, owner)).total_mc, 0);
    assert.equal(ledger(sql, owner), 0);
  });
}

test('refunds racing settlement cannot restore money; unrelated top-ups are preserved', async t => {
  const { env, sql } = financialDb(t), owner = await api.ownerOfUser(env, 77);
  await api.grantPayment(env, owner, { charge: 'refunded', kind: 'pack', stars: 77, mc: 1_000_000 });
  await api.hold(env, owner, 'racing-answer', 600_000, 1, paidModel.id);
  await api.grantPayment(env, owner, { charge: 'unrelated', kind: 'pack', stars: 77, mc: 1_000_000 });
  await Promise.all([api.refundPayment(env, owner, 'refunded'), api.settle(env, owner, 'racing-answer', { actualMc: 100_000, costUsd: 0.1 })]);
  assert.equal((await api.wallet(env, owner)).total_mc, 1_000_000);
  assert.equal(ledger(sql, owner), 1_000_000);
});

test('payment redelivery cannot recreate a deleted balance or assign one charge to another reader', async t => {
  const { env } = financialDb(t), owner = await api.ownerOfUser(env, 77), other = await api.ownerOfUser(env, 78);
  const pay = { charge: 'unlinked-payment', kind: 'pack', stars: 77, mc: 1_000_000 };
  assert.equal(await api.grantPayment(env, owner, pay), true);
  assert.equal(await api.grantPayment(env, other, pay), false);
  assert.equal((await api.wallet(env, other)).total_mc, 0);
  await api.deleteCredits(env, owner);
  assert.equal(await api.grantPayment(env, owner, pay), false, 'redelivery during deletion must not recreate the removed lot');
  assert.equal((await api.wallet(env, owner)).total_mc, 0);
  await env.DB.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ?").bind(owner).run();
  assert.equal(await api.grantPayment(env, owner, pay), false);
  assert.equal((await api.wallet(env, owner)).total_mc, 0);
});

test('refund and settlement batches roll back fully when a write fails, then recover on retry', async t => {
  const { env, sql, fail } = financialDb(t), owner = await api.ownerOfUser(env, 77);
  await api.grantPayment(env, owner, { charge: 'retry-refund', kind: 'pack', stars: 77, mc: 1_000_000 });
  await api.hold(env, owner, 'retry-settlement', 600_000, 1, paidModel.id);
  fail(/UPDATE credit_lots SET remaining_mc = 0/);
  await assert.rejects(api.refundPayment(env, owner, 'retry-refund'), /storage unavailable/);
  assert.equal((await api.wallet(env, owner)).total_mc, 400_000);
  await api.refundPayment(env, owner, 'retry-refund');
  fail(/INSERT OR IGNORE INTO credit_usage/);
  await assert.rejects(api.settle(env, owner, 'retry-settlement', { actualMc: 100_000, costUsd: 0.1 }), /storage unavailable/);
  await api.settle(env, owner, 'retry-settlement', { actualMc: 100_000, costUsd: 0.1 });
  assert.equal((await api.wallet(env, owner)).total_mc, 0);
  assert.equal(ledger(sql, owner), 0);
});

test('free answers reserve a shared daily budget atomically before any retrieval', async t => {
  const { env, sql } = financialDb(t), model = api.freeModel(env);
  const starts = await Promise.all(Array.from({ length: 20 }, (_, i) => api.startMeter(env, 77 + i, model)));
  const admitted = starts.filter(x => x.ok);
  assert.ok(admitted.length > 0 && admitted.length < 20);
  assert.ok(starts.filter(x => !x.ok).every(x => x.status === 429));
  const reserved = sql.prepare("SELECT SUM(reserved_micro) AS n FROM free_spend_holds WHERE state = 'held'").get().n;
  assert.ok(reserved <= 110_000);
  for (const r of admitted) { r.meter.spend.modelUsd = 0.01; await api.finishMeter(env, r.meter, 'ok'); }
  assert.equal(await api.freeSpendToday(env), admitted.length * 0.01);
  await api.finishMeter(env, admitted[0].meter, 'ok');
  assert.equal(await api.freeSpendToday(env), admitted.length * 0.01, 'settlement is idempotent');
});

test('a full free budget blocks Ask and search before calling AI, while admin testing stays separate', async t => {
  const { env } = financialDb(t);
  await api.reserveFreeBudget(env, 'all-budget', 0.11);
  let calls = 0;
  env.AI = { run: async () => { calls++; return { data: [] }; } };
  const model = api.freeModel(env);
  for (const billing of ['on', 'off']) {
    const configured = { ...env, ASK_BILLING: billing, CLAUDE_MODEL: model.id };
    const ask = await api.askStream(configured, 'a test question', 77, undefined, [], undefined, false, model.id, [model.provider]);
    assert.equal(ask.status, 429);
    assert.equal((await ask.json()).error, 'free-paused');
    assert.equal((await api.ask(configured, 'one-piece question', 77, undefined, [], [model.provider])).reason, 'free-paused');
  }
  assert.equal((await api.answerSearch(env, 'a search question', 77)).reason, 'free-paused');
  assert.equal(calls, 0);
  assert.equal((await api.answerSearch(env, 'admin search', 100000002)).ok, true);
  assert.equal(await api.freeSpendToday(env), 0);
});

test('counter errors fail closed; a failed settlement retains its reservation and can be retried', async t => {
  const { env, fail, sql } = financialDb(t);
  fail(/INSERT OR IGNORE INTO free_spend_holds/);
  const start = await api.startMeter(env, 77, api.freeModel(env));
  assert.equal(start.status, 503);
  const reservation = await api.reserveFreeBudget(env, 'settlement-failure', 0.11);
  fail(/SELECT COALESCE/);
  assert.equal(await api.freePaused(env), true);
  fail(/UPDATE free_spend_holds SET state/);
  await assert.rejects(api.settleFreeBudget(env, reservation, 0.01), /storage unavailable/);
  assert.equal(await api.freeSpendToday(env), 0, 'the counter increment rolled back too');
  assert.equal(await api.reserveFreeBudget(env, 'blocked-while-uncertain', 0.01), null);
  assert.equal(sql.prepare("SELECT state FROM free_spend_holds WHERE request_id = 'settlement-failure'").get().state, 'held');
  await api.settleFreeBudget(env, reservation, 0.01);
  assert.equal(await api.freeSpendToday(env), 0.01);
  assert.ok(await api.reserveFreeBudget(env, 'room-after-settlement', 0.10));
});

test('reservations survive process loss, settle against their original UTC day, and preserve legacy spend', async t => {
  const { env, sql } = financialDb(t), now = Date.parse('2026-10-07T23:59:59Z');
  await api.freeSpendToday(env, now);
  sql.prepare('INSERT INTO free_spend_daily VALUES (?, ?)').run('2026-10-07', 100_000);
  const held = await api.reserveFreeBudget(env, 'midnight-answer', 0.01, now);
  assert.ok(held);
  await api.sweepFreeBudget(env, now + 60_000);
  assert.equal(await api.reserveFreeBudget(env, 'same-day-overflow', 0.01, now), null);
  assert.ok(await api.reserveFreeBudget(env, 'new-day-answer', 0.11, now + 60_000));
  await api.settleFreeBudget(env, held, 0.005);
  assert.equal(await api.freeSpendToday(env, now), 0.105);
  assert.equal(await api.freeSpendToday(env, now + 60_000), 0);
});

test('failed provider work keeps the full reserved allowance instead of freeing an unknown cost', async t => {
  const { env, sql } = financialDb(t);
  const started = await api.startMeter(env, 77, api.freeModel(env));
  const reserved = sql.prepare('SELECT reserved_micro AS n FROM free_spend_holds').get().n;
  await api.finishMeter(env, started.meter, 'failed');
  assert.equal(await api.freeSpendToday(env), reserved / 1e6);
});

test('free model calls cap their output to the remaining budget and reject oversized inputs before invoking the provider', async t => {
  const { env } = financialDb(t), model = api.freeModel(env), calls = [];
  env.AI_GATEWAY = 'local';
  env.AI = { run: async (_model, input) => { calls.push(input); return { response: 'An answer.', usage: { prompt_tokens: 500, completion_tokens: 20 } }; } };
  const run = (content, spend) => api.researchOpen(env, model, 'Test', [{ role: 'user', content }], [], new Map(), async () => ({ content: '' }), () => {}, 3, spend);
  await run('a question', api.makeSpend({ budgetUsd: 0.001 }));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].max_tokens >= 64 && calls[0].max_tokens < 4096);
  await assert.rejects(run('a'.repeat(100000), api.makeSpend({ budgetUsd: 0.001 })), /reserved budget/);
  assert.equal(calls.length, 1);
});

test('missing or incomplete provider usage keeps the full reservation even when the answer succeeds', async t => {
  const { env, sql } = financialDb(t);
  env.ASK_FREE_DAILY_USD_CAP = '1';
  for (const usage of [undefined, { prompt_tokens: 100 }, { input_tokens: 100, output_tokens: NaN }]) {
    const start = await api.startMeter(env, 77, api.freeModel(env));
    start.meter.spend.call(usage, api.freeModel(env));
    if (Number.isNaN(start.meter.spend.total())) {
      await assert.rejects(api.finishMeter(env, start.meter, 'ok'), /Invalid free answer cost/);
      assert.equal(sql.prepare('SELECT state FROM free_spend_holds WHERE request_id = ?').get(start.meter.reservation.request).state, 'held');
    } else {
      await api.finishMeter(env, start.meter, 'ok');
      const reserved = sql.prepare("SELECT SUM(reserved_micro) AS n FROM free_spend_holds WHERE state = 'settled'").get().n;
      assert.equal(await api.freeSpendToday(env), reserved / 1e6);
    }
  }
});

test('failed successful-payment delivery is retried, even with an old KV marker; completed duplicates credit once', async t => {
  const { env, sql, fail } = financialDb(t);
  const telegram = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: { id: 100000001, is_bot: true, first_name: 'Local', username: 'local_test_bot' } })); });
  await new Promise(resolve => telegram.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => telegram.close(resolve)));
  env.TELEGRAM_API_ROOT = `http://127.0.0.1:${telegram.address().port}`;
  const bot = await api.createBot(env, 'http://127.0.0.1');
  bot.api.config.use(async () => ({ ok: true, result: true }));
  const update = { update_id: 123, message: { message_id: 1, date: 1, from: { id: 77, first_name: 'Local', is_bot: false }, chat: { id: 77, type: 'private' }, successful_payment: { invoice_payload: 'ask:pack:77:77', currency: 'XTR', total_amount: 77, telegram_payment_charge_id: 'retry-payment', provider_payment_charge_id: '' } } };
  await env.SUBS.put('webhook:123', '1');
  fail(/INSERT OR IGNORE INTO payments/);
  await assert.rejects(bot.handleUpdate(update), /storage unavailable/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM webhook_updates').get().n, 0);
  await bot.handleUpdate(update);
  await bot.handleUpdate(update);
  assert.equal((await api.wallet(env, await api.ownerOfUser(env, 77))).total_mc, 1_001_000);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 1);
  // The payment succeeds but its completion marker fails: replay must not credit it twice.
  const second = { ...update, update_id: 124, message: { ...update.message, successful_payment: { ...update.message.successful_payment, telegram_payment_charge_id: 'marker-failure' } } };
  fail(/UPDATE webhook_updates SET state/);
  await assert.rejects(bot.handleUpdate(second), /storage unavailable/);
  await bot.handleUpdate(second);
  assert.equal((await api.wallet(env, await api.ownerOfUser(env, 77))).total_mc, 2_002_000);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 2);
});

test('overlapping webhook deliveries do not run twice; crashed claims recover and stale owners cannot remove a new claim', async t => {
  const { env, sql } = financialDb(t), now = Date.now();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const first = api.handleWebhookUpdate(env, 1, async () => { entered(); await waiting; throw new Error('old handler failed'); }, now);
  await started;
  await assert.rejects(api.handleWebhookUpdate(env, 1, async () => assert.fail('duplicate executed'), now), /still processing/);
  await api.handleWebhookUpdate(env, 1, async () => {}, now + 21 * 60000);
  release();
  await assert.rejects(first, /old handler failed/);
  assert.equal(sql.prepare('SELECT state FROM webhook_updates WHERE update_id = 1').get().state, 'done');
  await api.handleWebhookUpdate(env, 1, async () => assert.fail('completed update executed'));
  await api.sweepWebhookUpdates(env, Date.now() + 8 * 86400_000);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM webhook_updates').get().n, 0);
});
