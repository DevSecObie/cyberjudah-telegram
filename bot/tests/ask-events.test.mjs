import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { DatabaseSync } from "node:sqlite";

const out = new URL("./.build/ask-events.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/ask-events.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" });
const { recordAskEvent, sweepAskEvents } = await import(out);

const d1 = () => {
  const db = new DatabaseSync(":memory:");
  const bound = (q, args) => ({ run: async () => { db.prepare(q).run(...args); return { meta: {} }; }, all: async () => ({ results: db.prepare(q).all(...args) }) });
  return { db, prepare: (q) => ({ bind: (...a) => bound(q, a), ...bound(q, []) }), batch: async (s) => { for (const x of s) await x.run(); } };
};

test("an Ask outcome is kept with its model, time and source count, and never the question", async () => {
  const DB = d1();
  await recordAskEvent({ DB }, { traceId: "t-1", surface: "study", model: "@cf/m", outcome: "fallback", elapsedMs: 4200.4, sources: 9, detail: "teaching 3" }, 1000);
  const rows = DB.db.prepare("SELECT * FROM ask_events").all();
  assert.equal(rows.length, 1);
  const row = { ...rows[0] };
  assert.match(row.prompt_version, /^system-v\d+\..*\+teacher-grounded-study-/, "a study event names the study prompts too");
  assert.equal(row.corpus_release, "lib-unknown/idx-unknown");
  delete row.prompt_version; delete row.corpus_release;
  assert.deepEqual(row, { id: 1, at: 1000, trace_id: "t-1", surface: "study", model: "@cf/m", outcome: "fallback", detail: "teaching 3", elapsed_ms: 4200, sources: 9 });
  assert.deepEqual(Object.keys(rows[0]).filter((k) => /question|answer|account|text/.test(k)), []);
});

test("events older than 14 days are swept, and a broken database never throws", async () => {
  const DB = d1();
  const day = 86400_000;
  await recordAskEvent({ DB }, { surface: "app", outcome: "complete" }, 1);
  await recordAskEvent({ DB }, { surface: "app", outcome: "complete" }, 20 * day);
  await sweepAskEvents({ DB }, 20 * day);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM ask_events").get().n, 1);
  await recordAskEvent({ DB: { batch: async () => { throw new Error("down"); }, prepare: () => { throw new Error("down"); } } }, { surface: "app", outcome: "x" });
});

test("an events table made before the version stamps gets its two columns, and keeps its rows", async () => {
  const DB = d1();
  DB.db.exec(`CREATE TABLE ask_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, trace_id TEXT,
    surface TEXT NOT NULL, model TEXT, outcome TEXT NOT NULL, detail TEXT, elapsed_ms INTEGER, sources INTEGER)`);
  DB.db.exec("INSERT INTO ask_events (at, surface, outcome) VALUES (1, 'app', 'complete')");
  await recordAskEvent({ DB }, { surface: "app", model: "@cf/m", outcome: "complete" }, 2);
  const rows = DB.db.prepare("SELECT at, prompt_version, corpus_release FROM ask_events ORDER BY at").all().map((r) => ({ ...r }));
  assert.deepEqual(rows[0], { at: 1, prompt_version: null, corpus_release: null });
  assert.match(rows[1].prompt_version, /^system-v\d+\.research-v\d+\.app-v\d+\.data-policy-v\d+\.answer-v\d+\.tools-v\d+$/);
  assert.equal(rows[1].corpus_release, "lib-unknown/idx-unknown");
});
