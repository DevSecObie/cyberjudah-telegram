import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { SYSTEM, RESEARCH, APP, buildPrompt } from "../src/ai.mjs";
import { DATA_POLICY } from "../src/grounding.mjs";
import { indexMark, libraryMark, writeCorpusMark } from "../scripts/corpus-mark.mjs";

const out = new URL("./.build/ask-versions.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/ask-versions.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { PROMPT_IDS, PROMPT_VERSION, ANSWER_POLICY, UNKNOWN_CORPUS, UNAVAILABLE_CORPUS, promptVersion, corpusRelease, answerVersions } = await import(out);
const toolsOut = new URL("./.build/ask-versions-tools.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export { TOOL_DEFS } from "./src/agent.ts";', resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: toolsOut, logLevel: "error" });
const { TOOL_DEFS } = await import(toolsOut);
// The one-shot answer prompt as built, for placeholder inputs (no library or Scripture text).
const placeholder = [{ n: 1, kind: "note", title: "Placeholder title", url: "/placeholder", text: "Placeholder text." }];
const answerPrompt = JSON.stringify([buildPrompt("Placeholder question?", placeholder, [], { plain: true }), buildPrompt("Placeholder question?", [], [], { plain: true }), buildPrompt("Placeholder question?", placeholder)]);
const toolText = JSON.stringify(TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })));

const sha = (s) => createHash("sha256").update(s).digest("hex");
const changelog = readFileSync(new URL("../../docs/ASK-PROMPT-CHANGELOG.md", import.meta.url), "utf8");

test("each prompt's text matches the hash pinned with its id: a prompt change must bump its id", () => {
  const texts = { system: SYSTEM, research: RESEARCH, app: APP, dataPolicy: DATA_POLICY, answer: answerPrompt, tools: toolText };
  assert.deepEqual(Object.keys(PROMPT_IDS).sort(), Object.keys(texts).sort());
  for (const [key, text] of Object.entries(texts)) {
    assert.equal(sha(text), PROMPT_IDS[key].sha256, `${key} changed: bump PROMPT_IDS.${key}.id, update its sha256 in src/ask-versions.ts and add a line to docs/ASK-PROMPT-CHANGELOG.md`);
  }
});

test("every prompt id is unique, well formed and in the changelog, and the version joins them", () => {
  const ids = Object.values(PROMPT_IDS).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[a-z-]+-v\d+$/);
    assert.ok(changelog.includes(`\`${id}\``), `docs/ASK-PROMPT-CHANGELOG.md names ${id}`);
  }
  assert.equal(PROMPT_VERSION, ids.join("."));
  assert.equal(promptVersion("app"), PROMPT_VERSION);
  assert.match(promptVersion("study"), new RegExp(`^${PROMPT_VERSION.replace(/\./g, "\\.")}\\+teacher-grounded-study-`));
  assert.equal(ANSWER_POLICY, "policy-v1");
});

const d1 = () => {
  const db = new DatabaseSync(":memory:");
  let reads = 0;
  let fail = false;
  return { db, get reads() { return reads; }, set fail(v) { fail = v; }, prepare: (q) => ({ all: async () => { reads++; if (fail) throw new Error("D1_ERROR: overloaded"); return { results: db.prepare(q).all() }; } }) };
};

test("the corpus release names the library and index marks, and says unknown before any is written", async () => {
  const DB = d1();
  assert.equal(await corpusRelease({ DB }, 0), UNKNOWN_CORPUS, "no table yet");
  assert.equal(await corpusRelease({}, 0), UNKNOWN_CORPUS, "no database binding");
  const run = async (q) => DB.db.exec(q);
  assert.ok(await writeCorpusMark(run, "library", "lib-3226601ac088", 1, () => {}));
  const fresh = d1(); fresh.db.exec("CREATE TABLE corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
  fresh.db.exec("INSERT INTO corpus_marks VALUES ('library','lib-3226601ac088',1),('index','idx-20261110T0412Z',2)");
  assert.equal(await corpusRelease({ DB: fresh }, 0), "lib-3226601ac088/idx-20261110T0412Z");
  const half = d1(); half.db.exec("CREATE TABLE corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
  half.db.exec("INSERT INTO corpus_marks VALUES ('library','lib-3226601ac088',1)");
  assert.equal(await corpusRelease({ DB: half }, 0), "lib-3226601ac088/idx-unknown");
});

test("a malformed mark, or one of the wrong kind, is never stamped, and the marks are read at most once a minute", async () => {
  const DB = d1(); DB.db.exec("CREATE TABLE corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
  DB.db.exec("INSERT INTO corpus_marks VALUES ('library','lib-x/../<b>',1),('index','idx-20261110T0412Z',2)");
  assert.equal(await corpusRelease({ DB }, 0), "lib-unknown/idx-20261110T0412Z");
  const reads = DB.reads;
  DB.db.exec("UPDATE corpus_marks SET id='idx-20261111T0000Z' WHERE kind='index'");
  assert.equal(await corpusRelease({ DB }, 30_000), "lib-unknown/idx-20261110T0412Z");
  assert.equal(DB.reads, reads);
  assert.equal(await corpusRelease({ DB }, 60_001), "lib-unknown/idx-20261111T0000Z");
  const swapped = d1(); swapped.db.exec("CREATE TABLE corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
  swapped.db.exec("INSERT INTO corpus_marks VALUES ('library','idx-20261110T0412Z',1),('index','abc-123',2)");
  assert.equal(await corpusRelease({ DB: swapped }, 0), UNKNOWN_CORPUS);
});

test("marks that cannot be read make the corpus unavailable, and that is never kept for the minute", async () => {
  const DB = d1(); DB.db.exec("CREATE TABLE corpus_marks (kind TEXT PRIMARY KEY, id TEXT NOT NULL, at INTEGER NOT NULL)");
  DB.db.exec("INSERT INTO corpus_marks VALUES ('library','lib-3226601ac088',1),('index','idx-20261110T0412Z',2)");
  DB.fail = true;
  assert.equal(await corpusRelease({ DB }, 0), UNAVAILABLE_CORPUS);
  DB.fail = false;
  assert.equal(await corpusRelease({ DB }, 1), "lib-3226601ac088/idx-20261110T0412Z", "the next answer reads again");
});

test("an answer's versions name its prompts, policy, corpus and the model that wrote it", async () => {
  assert.deepEqual(await answerVersions({}, "@cf/free"), { prompt: PROMPT_VERSION, policy: "policy-v1", corpus: UNKNOWN_CORPUS, model: "@cf/free" });
  assert.equal((await answerVersions({}, "approved", "study")).prompt, promptVersion("study"));
});

test("the load and embed scripts write well-formed marks, and a failed write only warns", async () => {
  assert.match(libraryMark(Buffer.from("INSERT INTO search_docs VALUES (1);")), /^lib-[0-9a-f]{12}$/);
  assert.equal(indexMark(new Date("2026-11-10T04:12:59Z")), "idx-20261110T0412Z");
  const sql = [];
  assert.ok(await writeCorpusMark(async (q) => { sql.push(q); }, "index", "idx-20261110T0412Z", 5, () => {}));
  assert.match(sql[1], /^INSERT OR REPLACE INTO corpus_marks \(kind, id, at\) VALUES \('index', 'idx-20261110T0412Z', 5\)$/);
  const logs = [];
  assert.equal(await writeCorpusMark(async () => { throw new Error("D1 down"); }, "library", "lib-3226601ac088", 1, (m) => logs.push(m)), false);
  assert.match(logs[0], /::warning::/);
  await assert.rejects(writeCorpusMark(async () => {}, "library", "lib-'); DROP TABLE x;--"), /bad corpus mark/);
  await assert.rejects(writeCorpusMark(async () => {}, "reader", "lib-3226601ac088"), /bad corpus mark/);
});
