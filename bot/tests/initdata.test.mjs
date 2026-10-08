import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { LAUNCH_DATA_MAX_AGE, launchMaxAge, sameHex, SENSITIVE_MAX_AGE, validateInitData, signInitData } from "../src/initdata.mjs";

// Build a structurally useful value without committing anything secret scanners can mistake
// for a live Telegram credential.
const TOKEN = ["test-bot", "token", "not-a-credential"].join("-");
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

// Regression (ed9ac6d): the API refused launch data older than three days, so a Mini App left
// open past that lost Search and Ask together. A reader's session must last at least 30 days.
test("the API's window keeps a Mini App left open for weeks signed in", async () => {
  assert.ok(LAUNCH_DATA_MAX_AGE >= 30 * 86400);
  const daysOld = (d) => sign({ ...fresh, auth_date: String(Math.floor(now / 1000) - d * 86400) });
  assert.ok(await validateInitData(daysOld(4), TOKEN, LAUNCH_DATA_MAX_AGE, now));
  assert.ok(await validateInitData(daysOld(29), TOKEN, LAUNCH_DATA_MAX_AGE, now));
  assert.equal(await validateInitData(daysOld(31), TOKEN, LAUNCH_DATA_MAX_AGE, now), null);
});

test("privacy and the Stars invoices take launch data a day old at most; every other route keeps the long window", async () => {
  assert.equal(SENSITIVE_MAX_AGE, 86400);
  for (const p of ["/api/privacy/export", "/api/privacy/export/send", "/api/privacy/delete", "/api/ask/buy", "/api/invoice"]) assert.equal(launchMaxAge(p), SENSITIVE_MAX_AGE, p);
  for (const p of ["/api/ask", "/api/search", "/api/ask/account", "/api/share", "/api/invoices", "/api/privacy"]) assert.equal(launchMaxAge(p), LAUNCH_DATA_MAX_AGE, p);
  const twoDays = sign({ ...fresh, auth_date: String(Math.floor(now / 1000) - 2 * 86400) });
  assert.equal(await validateInitData(twoDays, TOKEN, launchMaxAge("/api/privacy/delete"), now), null);
  assert.ok(await validateInitData(twoDays, TOKEN, launchMaxAge("/api/ask"), now));
});

test("secrets are compared whole: equal only when every character is", () => {
  assert.equal(sameHex("s3cret-value", "s3cret-value"), true);
  assert.equal(sameHex("s3cret-value", "s3cret-valuf"), false);
  assert.equal(sameHex("s3cret-value", "s3cret"), false);
  assert.equal(sameHex("", "s3cret"), false);
  assert.equal(sameHex("", ""), false, "an unconfigured webhook cannot authenticate an empty header");
});
