import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { financialDb } from './helpers/financial-db.mjs';

// /takedown through the real bot (grammY handleUpdate), on real SQLite: admin-only (ADMIN_IDS), private chat only.
const out = new URL('./.build/takedown-command.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export { createBot } from "./src/bot"; export { studyIdIn } from "./src/published-studies";', resolveDir: new URL('..', import.meta.url).pathname, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, logLevel: 'error' });
const api = await import(out);
const ADMIN = 100000002, READER = 77;

async function setup(t) {
  const fixture = financialDb(t), { env, sql } = fixture;
  const telegram = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, result: true })); });
  await new Promise(resolve => telegram.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => telegram.close(resolve)));
  env.TELEGRAM_API_ROOT = `http://127.0.0.1:${telegram.address().port}`;
  const bot = await api.createBot(env, 'http://127.0.0.1');
  const replies = [];
  bot.api.config.use(async (_prev, method, payload) => { if (method === 'sendMessage') replies.push(payload.text); return { ok: true, result: { message_id: 1, date: 1, chat: { id: payload.chat_id, type: 'private' } } }; });
  sql.exec('CREATE TABLE published_studies (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, updated TEXT NOT NULL)');
  for (const id of ['study-down01', 'study-keep01']) sql.prepare('INSERT INTO published_studies VALUES (?,?,?,?,?,?)').run(id, 'owner-hash', id, '', 'text', '2026-11-10T00:00:00Z');
  let n = 1;
  const send = (from, text, chat = 'private') => bot.handleUpdate({ update_id: n++, message: { message_id: n, date: 1, from: { id: from, first_name: 'Local', is_bot: false }, chat: { id: chat === 'private' ? from : -100, type: chat }, text, entities: [{ type: 'bot_command', offset: 0, length: 9 }] } });
  const live = () => sql.prepare('SELECT id FROM published_studies ORDER BY id').all().map(r => r.id);
  return { send, replies, live, sql };
}

test('a reader who is not an admin gets no answer and nothing is removed', async t => {
  const { send, replies, live } = await setup(t);
  await send(READER, '/takedown study-down01');
  assert.deepEqual(replies, []);
  assert.deepEqual(live(), ['study-down01', 'study-keep01']);
});

test('an admin in a group chat is ignored too', async t => {
  const { send, replies, live } = await setup(t);
  await send(ADMIN, '/takedown study-down01', 'group');
  assert.deepEqual(replies, []);
  assert.deepEqual(live(), ['study-down01', 'study-keep01']);
});

test('an admin takes down one study by its link (trailing slash), and only that study', async t => {
  const { send, replies, live, sql } = await setup(t);
  await send(ADMIN, '/takedown https://cyberjudah.io/app/published/study-down01/');
  assert.deepEqual(live(), ['study-keep01']);
  assert.match(replies[0], /^Taken down\./);
  assert.deepEqual(sql.prepare('SELECT id FROM published_takedowns').all().map(r => r.id), ['study-down01']);
  await send(ADMIN, '/takedown study-down01');
  assert.equal(replies[1], 'No published study has that id.');
  await send(ADMIN, '/takedown');
  assert.match(replies[2], /followed by the study's id or its link/);
});

test('the id is read from the id itself or its link, nothing else', () => {
  for (const [text, id] of [['study-abc123', 'study-abc123'], ['https://cyberjudah.io/app/published/study-abc123', 'study-abc123'], ['https://cyberjudah.io/app/published/study-abc123/?x=1#top', 'study-abc123'], ['  study-abc123  please', 'study-abc123'],
    ['https://cyberjudah.io/app/other/study-abc123', null], ['bad id!', null], ['abc', null], ['', null]]) assert.equal(api.studyIdIn(text), id, text);
});

test('/takedown is not in the public command menu', () => {
  assert.doesNotMatch(readFileSync(new URL('../scripts/setup.mjs', import.meta.url), 'utf8'), /command: "takedown"/);
});
