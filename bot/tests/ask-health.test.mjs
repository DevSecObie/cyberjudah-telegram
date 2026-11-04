import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const out = new URL("./.build/ask-health.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/ask-health.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error", external: ["@anthropic-ai/sdk", "grammy"] });
const { summarise } = await import(out);

const row = (o) => ({ at: 0, trace_id: null, surface: "study", model: "m1", outcome: "complete", detail: null, elapsed_ms: null, sources: null, ...o });

test("each model's answers are counted by how they turned out, and refusals are left out", () => {
  const now = 10 * 60_000;
  const { models, problems } = summarise([
    row({ trace_id: "a", outcome: "started" }), row({ trace_id: "a", outcome: "complete", elapsed_ms: 4000, sources: 6 }),
    row({ trace_id: "b", outcome: "started" }), row({ trace_id: "b", outcome: "retry" }), row({ trace_id: "b", outcome: "fallback", elapsed_ms: 9000, sources: 4 }),
    row({ trace_id: "c", outcome: "started", at: 60_000 }),
    row({ trace_id: "d", outcome: "started", at: now - 1000 }),
    row({ trace_id: "e", outcome: "unavailable", model: "m2", detail: "failed: AI_STREAM_FAILED" }),
    row({ trace_id: "f", outcome: "limit" }),
  ], now);
  const m1 = models.find((m) => m.model === "m1");
  assert.deepEqual({ ...m1 }, { model: "m1", answers: 3, complete: 1, fallback: 1, failed: 0, cutOff: 1, medianMs: 9000, avgSources: 5 });
  assert.equal(models.find((m) => m.model === "m2").failed, 1);
  assert.deepEqual(problems.map((p) => p.outcome).sort(), ["cut-off", "fallback", "unavailable"]);
  assert.equal(problems.find((p) => p.outcome === "unavailable").detail, "failed: AI_STREAM_FAILED");
});
