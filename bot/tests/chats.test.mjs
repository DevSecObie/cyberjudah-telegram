import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_TTL, deleteAllChats, deleteChat, getChat, listChats, saveExchange } from "../src/chats.ts";
import { normalizeHistory } from "../src/ai.mjs";

/** KV as Workers has it, in memory. */
const kv = () => {
  const m = new Map(), ttl = new Map();
  return { get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v, o) => { m.set(k, v); if (o?.expirationTtl) ttl.set(k, o.expirationTtl); }, delete: async (k) => { m.delete(k); }, m, ttl };
};
const answer = (content) => ({ content, sources: [{ n: 1, kind: "class", title: "A class", url: "/classes/x", text: "long passage text" }], followups: ["More?"] });

test("a chat is saved, listed and reopened with its whole history, the passage text dropped", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 7, "chat00001", "Why keep the Passover?", answer("Because it is commanded."));
  await saveExchange(env, 7, "chat00001", "When?", answer("The fourteenth day."));
  const list = await listChats(env, 7);
  assert.deepEqual(list.map((c) => [c.id, c.title, c.count]), [["chat00001", "Why keep the Passover?", 2]]);
  const chat = await getChat(env, 7, "chat00001");
  assert.deepEqual(chat.turns.map((t) => [t.role, t.content]), [["user", "Why keep the Passover?"], ["assistant", "Because it is commanded."], ["user", "When?"], ["assistant", "The fourteenth day."]]);
  assert.equal(chat.turns[1].sources[0].text, undefined);
  // Another person's chats are not reachable.
  assert.equal(await getChat(env, 8, "chat00001"), null);
});

test("a retry replaces the exchange it retries instead of repeating it", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 1, "chat00002", "Who was Melchizedek?", answer("First try."));
  await saveExchange(env, 1, "chat00002", "Who was Melchizedek?", answer("Second try."), true);
  const chat = await getChat(env, 1, "chat00002");
  assert.deepEqual(chat.turns.map((t) => t.content), ["Who was Melchizedek?", "Second try."]);
  assert.equal((await listChats(env, 1))[0].count, 1);
});

test("the list has one entry per chat, newest first", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 1, "chataaaaa", "First", answer("a"));
  await saveExchange(env, 1, "chatbbbbb", "Second", answer("b"));
  await saveExchange(env, 1, "chataaaaa", "Again", answer("c"));
  assert.deepEqual((await listChats(env, 1)).map((c) => c.id), ["chataaaaa", "chatbbbbb"]);
});

test("a deleted chat stays deleted, even when an answer still being written finishes after", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 1, "chat00003", "Question", answer("Answer"));
  assert.equal(await deleteChat(env, 1, "chat00003"), true);
  await saveExchange(env, 1, "chat00003", "Question 2", answer("Late answer"));
  assert.equal(await getChat(env, 1, "chat00003"), null);
  assert.deepEqual(await listChats(env, 1), []);
});

test("an empty answer or a bad id is not saved", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 1, "chat00004", "Q", answer("  "));
  await saveExchange(env, 1, "../other", "Q", answer("A"));
  assert.deepEqual(await listChats(env, 1), []);
  assert.equal(await deleteChat(env, 1, "../other"), false);
});

test("the history the model gets opens with a question, alternates and ends on an answer", () => {
  const u = (c) => ({ role: "user", content: c }), a = (c) => ({ role: "assistant", content: c });
  // A window that would start on an answer.
  assert.deepEqual(normalizeHistory([u("1"), a("1"), u("2"), a("2"), u("3"), a("3"), u("4"), a("4")], 6).map((t) => t.content), ["2", "2", "3", "3", "4", "4"]);
  assert.equal(normalizeHistory([a("x"), u("1"), a("1")], 6)[0].role, "user");
  // An answer lost (the person left): two questions in a row keep the last; a trailing question is dropped.
  assert.deepEqual(normalizeHistory([u("1"), a("1"), u("2"), u("3"), a("3"), u("4")], 6).map((t) => `${t.role}:${t.content}`), ["user:1", "assistant:1", "user:3", "assistant:3"]);
  // Empty and malformed turns are ignored.
  assert.deepEqual(normalizeHistory([null, { role: "system", content: "x" }, u(""), u("q"), a("")], 6), []);
});

test("privacy: saved chats are filed under a pseudonymous ID, sealed, and expire without use", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 987654321, "abc12345", "Why keep the Passover?", answer("Because it is a memorial."));
  const keys = [...env.SUBS.m.keys()];
  assert.ok(keys.length >= 2);
  for (const k of keys) {
    assert.ok(!k.includes("987654321"), `no Telegram ID in ${k}`);
    assert.ok(!env.SUBS.m.get(k).includes("Passover") && !env.SUBS.m.get(k).includes("memorial"), `nothing readable in ${k}`);
    assert.equal(env.SUBS.ttl.get(k), CHAT_TTL, `${k} expires after 180 days without use`);
  }
  assert.equal(CHAT_TTL, 180 * 86400);
  assert.equal((await getChat(env, 987654321, "abc12345")).turns[1].content, "Because it is a memorial.");
  assert.equal(await getChat(env, 111, "abc12345"), null, "another person cannot reach it");
});

test("privacy: chats saved before pseudonymous IDs move over when first read, and the old records go", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  env.SUBS.m.set("chats:42", JSON.stringify([{ id: "old12345", title: "Old", updated: "2026-09-01T00:00:00Z", count: 1 }]));
  env.SUBS.m.set("chat:42:old12345", JSON.stringify({ id: "old12345", title: "Old", created: "x", updated: "x", turns: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }] }));
  assert.equal((await listChats(env, 42))[0].id, "old12345");
  assert.equal((await getChat(env, 42, "old12345")).turns[1].content, "a");
  assert.ok(![...env.SUBS.m.keys()].some((k) => k.includes(":42")), "no record under the Telegram ID remains");
});

test("privacy: Delete my data removes every saved chat", async () => {
  const env = { SUBS: kv(), PRIVACY_KEY: "test-key" };
  await saveExchange(env, 5, "aaa11111", "One?", answer("One."));
  await saveExchange(env, 5, "bbb22222", "Two?", answer("Two."));
  assert.equal(await deleteAllChats(env, 5), 2);
  assert.deepEqual(await listChats(env, 5), []);
  assert.equal(await getChat(env, 5, "aaa11111"), null);
  assert.ok(![...env.SUBS.m.keys()].some((k) => k.startsWith("chat:") || k.startsWith("chats:")));
});
