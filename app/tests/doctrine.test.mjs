import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { launchPath, pathToStartParam, sitePathOf } from "../../shared/links.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/doctrine.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/screens/Library.tsx", import.meta.url), "utf8");
const library = {};
const wrap = tag => ({ children, title }) => createElement(tag, null, title, children);
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: library,
  require: name => name === "react/jsx-runtime" ? require(name) : name === "react-router" ? { Link: ({ to, children, ...rest }) => createElement("a", { ...rest, href: to }, children) } : name === "@/ui/ui" ? { Section: wrap("section"), List: wrap("div"), Chips: wrap("div") } : name === "@shared/links.mjs" ? { toAppPath: p => p.startsWith("/classes/") ? `/note${p}` : p } : {},
});

test("doctrine renders the supplied KJV, Apocrypha and complete teacher words without rewriting data", () => {
  const before = structuredClone(fixture);
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  for (const answer of fixture.answers) {
    for (const ref of answer.refs) for (const verse of ref.text) assert.ok(html.includes(verse.text));
    for (const sense of answer.sense) { assert.ok(html.includes(sense.text)); assert.ok(html.includes(sense.teacher)); }
  }
  for (const link of ["/read/genesis/1?v=1", "/read/2-esdras/6?v=38", "/note/classes/2026/fixture?t=65", "/watch/fixture0002?t=0", "/precepts/fixture-precept", "/cases/fixture-case", "/topics/fixture-topic"]) assert.ok(html.includes(`href="${link}"`), link);
  assert.ok(html.indexOf(fixture.claim) < html.indexOf("Answer 1"));
  assert.ok(html.includes("Watch at 1:05")); assert.ok(html.includes("Watch at 0:00"));
  assert.deepEqual(fixture, before);
});

test("Doctrine share links return to the list and the entry rather than the Bible", () => {
  for (const path of ["/doctrine", fixture.url]) {
    assert.equal(launchPath(pathToStartParam(path)), path);
    assert.equal(sitePathOf(path), path);
  }
});

test("doctrine data methods request only the published API and preserve errors for Retry", async () => {
  const result = await build({ stdin: { contents: 'export { data } from "./src/api/data.ts";', resolveDir: new URL("..", import.meta.url).pathname }, bundle: true, format: "esm", platform: "node", write: false, define: { "import.meta.env": "{}" }, plugins: [{ name: "offline-fixture", setup(b) {
    b.onResolve({ filter: /^@\// }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const cachedResponse = async () => null;" }));
  } }] });
  const { data } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
  const original = globalThis.fetch;
  const paths = [];
  try {
    globalThis.fetch = async url => { paths.push(new URL(url).pathname); return Response.json(fixture); };
    assert.deepEqual(await data.doctrineEntry(fixture.slug), fixture);
    await data.doctrine();
    assert.deepEqual(paths, ["/api/doctrine/alpha-fixture.json", "/api/doctrine/index.json"]);
    for (const status of [404, 503]) {
      globalThis.fetch = async () => new Response(null, { status });
      await assert.rejects(data.doctrine(), new RegExp(`^Error: ${status} `));
      await assert.rejects(data.doctrineEntry(fixture.slug), new RegExp(`^Error: ${status} `));
    }
  } finally { globalThis.fetch = original; }
});
