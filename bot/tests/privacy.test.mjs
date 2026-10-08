import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { keyedHash, open, pid, seal } from "../src/privacy.mjs";

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

test("a counted address is kept under a keyed hash: stable, not the plain SHA-256, different for another key or purpose", async () => {
  const ip = "203.0.113.7";
  const h = await keyedHash(env, "remcreate", ip);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(await keyedHash(env, "remcreate", ip), h, "the same address, the same count");
  assert.notEqual(h, createHash("sha256").update(ip).digest("hex"), "not rebuildable by hashing every address");
  assert.notEqual(await keyedHash({ PRIVACY_KEY: "another-key" }, "remcreate", ip), h);
  assert.notEqual(await keyedHash(env, "other", ip), h);
  assert.notEqual(await keyedHash(env, "remcreate", "203.0.113.8"), h);
});
