import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRelease } from "../scripts/verify-release.mjs";
import { validateInitData } from "../src/initdata.mjs";
import { MODELS } from "../../shared/ask-models.mjs";

function fixture({ answerStatus = 200, sources = [{}], model = "google/test", expectedModel = "google/test", cachedConsent = false } = {}) {
  let answered = false, calls = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  return { count: () => calls, options: { url: "https://app.invalid", token: "test-token", expectedModel, retryMs: 0, log() {}, async fetcher(url, { headers }) {
    const path = new URL(url).pathname;
    if (path === "/api/health") return json({ ok: true });
    if (["/app/", "/app/read/genesis/1"].includes(path)) return new Response('<div id="root"></div>', { headers: { "content-type": "text/html" } });
    if (!headers.authorization) return json({}, 401);
    assert.equal((await validateInitData(headers.authorization.slice(4), "test-token")).user.id, 1);
    if (path === "/api/resources/catalog") return json({ resources: [] });
    if (path === "/api/recordings/catalog") return json({ chapters: [{}] });
    if (!expectedModel.startsWith("@cf/") && !headers["x-ai-consent"] && !(cachedConsent && answered)) return json({ provider: "Google" }, 428);
    calls++; answered = true;
    return json({ ok: true, answer: "A cited answer [1]", sources, model, provider: MODELS.find(m => m.id === expectedModel)?.provider ?? "Google", error: "free-paused" }, answerStatus);
  } } };
}
test("release verification signs a synthetic reader and makes only one consented provider request", async () => {
  const f = fixture(); await verifyRelease(f.options); assert.equal(f.count(), 1);
});
test("release verification fails on provider failure, empty citations or a different model", async () => {
  for (const options of [{ answerStatus: 429 }, { sources: [] }, { model: "other" }]) await assert.rejects(verifyRelease(fixture(options).options), /Search answer:/);
});
test("release verification fails if cached answers bypass withdrawn consent", async () => {
  await assert.rejects(verifyRelease(fixture({ cachedConsent: true }).options), /Withdrawn consent/);
});
test("the existing hosted provider is verified with one call and no external consent probe", async () => {
  const id = "@cf/meta/llama-3.1-8b-instruct-fp8";
  const f = fixture({ model: id, expectedModel: id });
  await verifyRelease(f.options); assert.equal(f.count(), 1);
});
test("staging may report a spent free answer budget; production and other failures still fail", async () => {
  await verifyRelease({ ...fixture({ answerStatus: 429 }).options, allowPaused: true });
  await assert.rejects(verifyRelease(fixture({ answerStatus: 429 }).options), /free-paused/);
  await assert.rejects(verifyRelease({ ...fixture({ answerStatus: 503 }).options, allowPaused: true }), /Search answer:/);
});
test("a single slow or unavailable answer is tried once more; two in a row fail", async () => {
  const id = "@cf/meta/llama-3.1-8b-instruct-fp8";
  const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  // Each answer request, in turn: throw (timeout), a status to return, or pass through to the fixture.
  const flaky = (plan) => {
    const f = fixture({ model: id, expectedModel: id });
    let n = 0;
    const inner = f.options.fetcher;
    f.options.fetcher = async (url, init) => {
      if (new URL(url).pathname !== "/api/search/answer" || !init.headers.authorization) return inner(url, init);
      const step = plan[n++] ?? "pass";
      if (step === "timeout") throw timeout();
      if (typeof step === "number") return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: step });
      return inner(url, init);
    };
    return { ...f, asked: () => n };
  };
  for (const plan of [["timeout"], [503]]) { const f = flaky(plan); await verifyRelease(f.options); assert.equal(f.asked(), 2); }
  await assert.rejects(verifyRelease(flaky(["timeout", "timeout"]).options), /no reply within 60 s, twice/);
  await assert.rejects(verifyRelease(flaky([503, 503]).options), /HTTP 503 \(unavailable\)/);
  // Any other failure is not retried.
  const f = flaky([500]); await assert.rejects(verifyRelease(f.options), /HTTP 500/); assert.equal(f.asked(), 1);
});
