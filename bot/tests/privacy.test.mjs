import { test } from "node:test";
import assert from "node:assert/strict";
import { open, pid, seal } from "../src/privacy.mjs";

const env = { PRIVACY_KEY: "test-privacy-key", BOT_TOKEN: "123:abc" };

test("records are filed under a pseudonymous ID: stable, unlinkable without the key, never the Telegram ID", async () => {
  const a = await pid(env, 123456789);
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await pid(env, 123456789), a, "the same person, the same ID");
  assert.equal(await pid(env, "123456789"), a, "a number or its text");
  assert.notEqual(await pid(env, 123456790), a);
  assert.ok(!a.includes("123456789"));
  assert.notEqual(await pid({ PRIVACY_KEY: "another-key" }, 123456789), a, "another key gives other IDs");
  assert.equal(await pid({ BOT_TOKEN: "123:abc" }, 1), await pid({ PRIVACY_KEY: "123:abc" }, 1), "without PRIVACY_KEY the bot token stands in");
});

test("a sealed conversation opens only for its owner; plain records written before sealing still read", async () => {
  const owner = await pid(env, 1), other = await pid(env, 2);
  const chat = { id: "abc12345", turns: [{ role: "user", content: "Why keep the Passover?" }] };
  const stored = await seal(env, owner, chat);
  assert.match(stored, /^s1\./);
  assert.ok(!stored.includes("Passover"), "the text is not readable in the storage");
  assert.notEqual(await seal(env, owner, chat), stored, "a fresh nonce every time");
  assert.deepEqual(await open(env, owner, stored), chat);
  assert.equal(await open(env, other, stored), null, "another person's key cannot open it");
  assert.deepEqual(await open(env, owner, JSON.stringify(chat)), chat, "legacy plain JSON");
  assert.equal(await open(env, owner, null), null);
});
