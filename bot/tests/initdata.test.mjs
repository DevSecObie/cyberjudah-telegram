import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateInitData, signInitData } from "../src/initdata.mjs";

const TOKEN = "123456789:AAHfiqksKZ8WmR2zSjiQ7_v4TMAKdiHm9T0";
const user = { id: 42, first_name: "Judah", username: "judah", language_code: "en", is_premium: true };

/** Signed the way Telegram documents it, with node's crypto, independent of the module under test. */
function sign(fields) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) params.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const check = [...params].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

const now = 1_800_000_000_000;
const fresh = { auth_date: String(Math.floor(now / 1000) - 60), query_id: "AAHdF6IQAAAAAN0XohDhrOrc", user, start_param: "john_3_16", chat_type: "sender" };

test("accepts data signed with the bot token", async () => {
  const data = await validateInitData(sign(fresh), TOKEN, 86400, now);
  assert.ok(data);
  assert.deepEqual(data.user, user);
  assert.equal(data.start_param, "john_3_16");
  assert.equal(data.query_id, fresh.query_id);
  assert.equal(data.auth_date, Number(fresh.auth_date));
});

test("the module's own signer agrees with node's", async () => {
  assert.equal(await signInitData(fresh, TOKEN), sign(fresh));
});

test("rejects a wrong token, a tampered field and a bad hash", async () => {
  const good = sign(fresh);
  assert.equal(await validateInitData(good, "999:other", 86400, now), null);
  assert.equal(await validateInitData(good.replace("john_3_16", "john_3_17"), TOKEN, 86400, now), null);
  assert.equal(await validateInitData(good.replace(/hash=[0-9a-f]{64}/, "hash=" + "0".repeat(64)), TOKEN, 86400, now), null);
  assert.equal(await validateInitData(good.replace(/hash=[0-9a-f]{64}/, "hash=abc"), TOKEN, 86400, now), null);
  assert.equal(await validateInitData("", TOKEN, 86400, now), null);
  assert.equal(await validateInitData(good, "", 86400, now), null);
});

test("rejects data older than the window", async () => {
  const old = sign({ ...fresh, auth_date: String(Math.floor(now / 1000) - 86401) });
  assert.equal(await validateInitData(old, TOKEN, 86400, now), null);
  assert.ok(await validateInitData(old, TOKEN, 90000, now));
  assert.equal(await validateInitData(sign({ ...fresh, auth_date: "nope" }), TOKEN, 86400, now), null);
});


test("rejects launch data dated materially in the future", async () => {
  const future = sign({ ...fresh, auth_date: String(Math.floor(now / 1000) + 31) });
  assert.equal(await validateInitData(future, TOKEN, 86400, now), null);
  const clockSkew = sign({ ...fresh, auth_date: String(Math.floor(now / 1000) + 30) });
  assert.ok(await validateInitData(clockSkew, TOKEN, 86400, now));
});
