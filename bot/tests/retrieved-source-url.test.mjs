import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { financialDb } from "./helpers/financial-db.mjs";

const out = new URL("./.build/retrieved-source-url.mjs", import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./src/retrieved-source-url.ts"; export { retrieve, answerSearch } from "./src/ai.ts";', resolveDir: new URL("..", import.meta.url).pathname }, bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { retrievedSourceUrl, recordedMoment, retrieve, answerSearch } = await import(out);
const video = "AbCdEf123_-";
const watch = `https://www.youtube.com/watch?v=${video}`;

test("old vectors derive a case-preserving YouTube URL only from a valid recorded ID and moment", () => {
  assert.equal(retrievedSourceUrl({ video, t: 42.75 }, []), `${watch}&t=42s`);
  assert.equal(retrievedSourceUrl({ url: " ", video, t: "0" }, []), `${watch}&t=0s`);
  for (const t of [undefined, null, "", " ", -1, Infinity, NaN, "1:02", "0x10", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(recordedMoment(t), undefined);
    assert.equal(retrievedSourceUrl({ video, t }, []), watch);
  }
  for (const bad of [undefined, "", "short", `${video}?x=1`, "https://youtu.be/AbCdEf123_-", "../AbCdEf1", 12345678901]) assert.equal(retrievedSourceUrl({ video: bad }, []), null);
});

test("recorded URLs require an approved HTTP(S) host, without credentials or an unexpected port", () => {
  for (const url of ["https://cyberjudah.io/classes/2026/recorded?t=9", "https://data.cyberjudah.io/library/item", "https://youtu.be/AbCdEf123_-?t=9", "http://www.youtube.com/watch?v=AbCdEf123_-", "https://archive.org/details/recorded"]) {
    assert.equal(retrievedSourceUrl({ url, video, t: 42 }, ["archive.org"]), url);
  }
  for (const url of ["javascript:alert(1)", "data:text/html,preview", "https://outside.invalid/x", "https://youtube.com.outside.invalid/x", "https://youtube.com@outside.invalid/x", "https://user@youtube.com/x", "https://youtube.com:8080/x", "//youtube.com/x", "relative/junk", "/bible/../x", "/bible/%2e%2e/x", "/bible/%2f%2foutside/x", "/bible/\\outside/x", "https://you\ntube.com/x"]) {
    assert.equal(retrievedSourceUrl({ url }, []), null, url);
    assert.equal(retrievedSourceUrl({ url, video, t: 7.9 }, []), `${watch}&t=7s`, url);
  }
  assert.equal(retrievedSourceUrl({ url: "https://archive.org/details/recorded" }, []), null, "retrieved text cannot add an outside host");
});

test("recorded root-relative library paths round-trip byte-identical; bare paths are never guessed", () => {
  for (const path of ["/bible/genesis/1", "/bible/genesis/1#v1", "/classes/2026/recorded?t=9", "/resources/held/release?key=recorded", "/app/resources/held/release?key=recorded"]) {
    assert.equal(retrievedSourceUrl({ url: path }, []), path);
  }
});

const text = "Preview test (not an answer). This recorded fixture has enough distinct caption words to exercise retrieval without making a teaching claim or representing a real class.";
function fixture(t, metadata) {
  const db = financialDb(t), calls = [], inputs = [];
  Object.assign(db.env, { AI_GATEWAY: "fixture", AI: { async run(id, input) {
    calls.push(id);
    inputs.push({ id, input });
    if (id.includes("bge-m3")) return { data: [[1, 0]] };
    if (id.includes("reranker")) return { response: [] };
    return { response: "Preview test (not an answer). [1]", usage: { prompt_tokens: 100, completion_tokens: 12 } };
  } }, VEC: { async query() { return { matches: [{ id: "old-caption", score: 0.95, metadata: { kind: "spoken", title: "Preview test (not an answer)", text, ...metadata } }] }; } } });
  return { ...db, calls, inputs };
}

test("real retrieval repairs an unchanged old vector and returns it as a valid Search source", async t => {
  const { env } = fixture(t, { url: "", video, t: 42.75 });
  const result = await answerSearch(env, "Preview source test", 7, ["Cloudflare (Workers AI)"]);
  assert.equal(result.ok, true);
  assert.equal(result.sources[0].url, `${watch}&t=42s`);
  assert.equal(result.sources[0].video, video);
  assert.equal(result.sources[0].t, 42.75);
  assert.equal(result.sources[0].text, text);
  assert.equal(result.sources[0].n, 1);
  assert.equal(result.citation_diagnostics.valid_ids, 1);
});

test("the release-smoke verse path stays relative through the real passageOf retrieval mapping", async t => {
  const { env } = fixture(t, { kind: "verse", title: "Genesis 1:1 (KJV)", url: "/bible/genesis/1" });
  const [passage] = await retrieve(env, "Preview source test");
  assert.equal(passage.kind, "verse");
  assert.equal(passage.title, "Genesis 1:1 (KJV)");
  assert.equal(passage.url, "/bible/genesis/1");
});

test("unsafe or missing links without a recorded valid video are omitted before citation registration", async t => {
  const { env, calls } = fixture(t, { url: "javascript:alert(1)", video: "invalid" });
  assert.deepEqual(await retrieve(env, "Preview source test"), []);
  const result = await answerSearch(env, "Preview source test", 7, ["Cloudflare (Workers AI)"]);
  assert.equal(result.state, "no-cited-answer");
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.related.passages, []);
  assert.ok(calls.every(id => id.includes("bge-m3")), "no model sees an unregistered unsafe source");
});

test("a rejected first hit cannot shift IDs or leak its unsafe link into the model's registry", async t => {
  const { env, inputs } = fixture(t, {});
  env.VEC.query = async () => ({ matches: [
    { id: "unsafe", score: 0.99, metadata: { kind: "spoken", title: "Rejected fixture", text, url: "javascript:alert(1)" } },
    { id: "recorded", score: 0.95, metadata: { kind: "spoken", title: "Preview test (not an answer)", text, video, t: 8 } },
  ] });
  const result = await answerSearch(env, "Preview source test", 7, ["Cloudflare (Workers AI)"]);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].n, 1);
  assert.equal(result.sources[0].url, `${watch}&t=8s`);
  assert.deepEqual(result.unsupported_refs, []);
  const modelInput = JSON.stringify(inputs.find(call => !call.id.includes("bge-m3"))?.input);
  assert.ok(modelInput && !modelInput.includes("javascript:") && !modelInput.includes("Rejected fixture"));
});

test("keyword hits use the same URL policy before source numbering", async t => {
  const { env, sql } = fixture(t, {});
  sql.exec("CREATE VIRTUAL TABLE search_docs USING fts5(kind, title, url, sub, text, book, chapter)");
  const insert = sql.prepare("INSERT INTO search_docs(kind,title,url,sub,text,book,chapter) VALUES (?,?,?,?,?,?,?)");
  insert.run("class", "Preview test", "javascript:alert(1)", "", text, "", "");
  insert.run("class", "Preview test", "/classes/2026/recorded", "", text, "", "");
  env.DB.batch = async stmts => Promise.all(stmts.map(stmt => stmt.all()));
  env.VEC.query = async () => ({ matches: [] });
  const result = await retrieve(env, "Preview test");
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "/classes/2026/recorded");
  assert.equal(result[0].text, text);
});

test("the existing server-reviewed outside-host list controls retrieval URLs", async t => {
  const { env } = fixture(t, { url: "https://recorded.example/source" });
  await env.SUBS.put("ask:sources", JSON.stringify({ revision: 1, hosts: ["recorded.example"] }));
  assert.equal((await retrieve(env, "Preview source test"))[0].url, "https://recorded.example/source");
  await env.SUBS.put("ask:sources", JSON.stringify({ revision: 2, hosts: [] }));
  assert.deepEqual(await retrieve(env, "Preview source test"), []);
});
