import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRelease } from "../scripts/verify-release.mjs";
import { validateInitData } from "../src/initdata.mjs";
import { MODELS } from "../../shared/ask-models.mjs";

function fixture({ answerStatus = 200, sources = [{}], model = "google/test", expectedModel = "google/test", cachedConsent = false } = {}) {
  let answered = false, calls = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
  return { count: () => calls, options: { url: "https://app.invalid", token: "test-token", expectedModel, log() {}, async fetcher(url, { headers }) {
    const path = new URL(url).pathname;
    if (path === "/api/health") return json({ ok: true });
    if (!path.startsWith("/api/")) return new Response(path === "/app/" ? '<div id="root"></div>' : '/app/strong/_expo/static/js/web/entry-abc.js', { headers: { "content-type": "text/html" } });
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
