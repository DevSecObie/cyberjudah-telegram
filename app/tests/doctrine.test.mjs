import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { launchPath, pathToStartParam, sitePathOf, toAppPath } from "../../shared/links.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/doctrine.json", import.meta.url), "utf8"));
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/screens/Library.tsx", import.meta.url), "utf8");
const library = {};
const wrap = tag => ({ children, title }) => createElement(tag, null, title, children);
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: library, URL,
  require: name => name === "react/jsx-runtime" || name === "react" ? require(name) : name === "react-router" ? { Link: ({ to, children, ...rest }) => createElement("a", { ...rest, href: to }, children) } : name === "@/ui/ui" ? { Section: wrap("section"), List: wrap("div"), Chips: wrap("div") } : name === "@shared/links.mjs" ? { toAppPath } : {},
});

test("doctrine renders the supplied KJV, Apocrypha and complete teacher words without rewriting data", () => {
  const before = structuredClone(fixture);
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  for (const answer of fixture.answers) {
    for (const ref of answer.refs) for (const verse of ref.text) assert.ok(html.includes(verse.text));
    for (const sense of answer.sense) { assert.ok(html.includes(sense.text)); assert.ok(html.includes(sense.teacher)); }
  }
  for (const link of ["/read/genesis/1?v=1", "/read/2-esdras/6?v=38", "/note/classes/2026/fixture?t=65", "/watch/fixture0002?t=0", "/precepts/fixture-precept", "/cases/fixture-case", "/topics/fixture-topic"]) assert.ok(html.includes(`href="${link}"`), link);
  assert.ok(html.indexOf(fixture.claim) < html.indexOf('id="doctrine-study"'));
  assert.ok(!/Answer \d+/.test(html));
  assert.ok(html.includes("Watch at 1:05")); assert.ok(html.includes("Watch at 0:00"));
  assert.deepEqual(fixture, before);
});

test("Markdown-style contents uses section and book links with unique anchors, and omits absent sections", () => {
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  assert.ok(html.includes('<nav class="doctrine-toc" aria-label="Table of contents"><h2>Contents</h2>'));
  assert.ok(!html.includes('<details class="doctrine-toc"'));
  const contents = html.match(/<nav class="doctrine-toc"[^>]*>(.*?)<\/nav>/s)[1];
  assert.ok(contents.includes('href="#doctrine-scriptures"'));
  assert.ok(contents.includes('href="#doctrine-book-0"'));
  assert.ok(!contents.includes('href="#doctrine-scripture-0"'));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(html.includes(`id="${id}"`), id);
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const entry = { ...fixture, answers: [], scriptures: [], books: [], related: { precepts: [], cases: [], topics: [] } };
  assert.ok(!renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry })).includes('class="doctrine-toc"'));
});

test("scripture rows preserve KJV and exact class bullets, read markers, times and links", () => {
  const before = structuredClone(fixture);
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  const scripture = html.slice(html.indexOf('id="doctrine-scriptures"'), html.indexOf('id="doctrine-books"'));
  assert.equal((scripture.match(/class="lawrow"/g) ?? []).length, fixture.scriptures.length);
  assert.equal((scripture.match(/<li(?: |>)/g) ?? []).length, 2);
  for (const ref of fixture.scriptures) for (const verse of ref.text) assert.ok(scripture.includes(verse.text));
  assert.ok(scripture.includes('href="/read/job/3?v=17"'));
  assert.ok(scripture.includes(fixture.scriptures[0].points[0].text));
  assert.ok(scripture.includes(">Fixture explanation class<span"));
  assert.ok(scripture.includes("Read in Fixture reading class"));
  assert.ok(scripture.includes('href="/note/classes/2026/fixture-scripture?t=821"'));
  assert.ok(scripture.includes('href="/watch/fixture0004?t=3725"'));
  assert.ok(scripture.includes("Watch at 13:41") && scripture.includes("Watch at 1:02:05"));
  assert.ok(!html.includes("undefined") && !html.includes("62:05") && !html.includes('class="hint"></p>'));
  assert.ok(html.indexOf('id="doctrine-study"') < html.indexOf('id="doctrine-scriptures"'));
  assert.deepEqual(fixture, before);
});

test("doctrine guards empty arrays and formats teachers and query-bearing note links", () => {
  const entry = structuredClone(fixture);
  entry.related.cases = []; entry.related.topics = [];
  entry.answers[0].sense[1].t = 4520; entry.answers[0].sense[1].ts = "1:15:20";
  const point = entry.scriptures[0].points[0];
  point.teacher = "Fixture teacher";
  point.note = "/classes/2026/fixture-scripture?source=fixture&t=1#moment";
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry }));
  assert.ok(html.includes("Fixture teacher · Fixture explanation class"));
  assert.ok(html.includes('href="/note/classes/2026/fixture-scripture?source=fixture&amp;t=821#moment"'));
  assert.ok(html.includes('href="/watch/fixture0002?t=4520"') && html.includes("Watch at 1:15:20"));
  assert.ok(!html.includes("Related cases") && !html.includes("Related topics"));
  entry.scriptures = [];
  assert.ok(!renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry })).includes("Scriptures against it"));
});

test("doctrine books show library pages, class reads and exact cited paragraphs before Related", () => {
  const before = structuredClone(fixture);
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  const books = html.slice(html.indexOf('id="doctrine-books"'), html.indexOf('id="doctrine-related-precepts"'));
  assert.equal((books.match(/class="lawrow"/g) ?? []).length, 2);
  for (const href of ["/books/fixture-book", "/books/fixture-book/p/1-93", "/books/fixture-book/p/2-140", "/read/job/3#v17", "/note/classes/2026/fixture-book?t=2862", "/watch/fixture0006?t=4520"]) assert.ok(books.includes(`href="${href}"`), href);
  for (const text of ["Fixture book author", "1871", "p. 93", "vol. 2, p. 140", "read in 8 classes", "read in 1 class", "Fixture book-reading class", "Fixture citation teacher · Fixture citing class", "Watch at 47:42", "Watch at 1:15:20", fixture.books[1].said.text]) assert.ok(books.includes(text), text);
  assert.match(books, /<h3[^>]*>Fixture cited book<\/h3>/);
  assert.ok(!books.includes("null") && !books.includes("undefined") && !books.includes('class="hint"> · Fixture'));
  assert.ok(html.indexOf('id="doctrine-scriptures"') < html.indexOf('id="doctrine-books"'));
  assert.deepEqual(fixture, before);
});

test("book lists cap class reads at three, hide empty books, and allow linked citations without teachers", () => {
  const entry = structuredClone(fixture);
  const page = entry.books[0].pages[0];
  page.reads = Array.from({ length: 4 }, (_, i) => ({ ...page.reads[0], title: `Fixture book class ${i + 1}`, teacher: i === 0 ? "Fixture reader" : "" }));
  entry.books[1].url = "/books/fixture-citation";
  entry.books[1].author = "Fixture citation author";
  entry.books[1].said.teacher = "";
  entry.books[1].said.note = "/classes/2026/fixture-citation?source=fixture&t=1#moment";
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry }));
  assert.ok(html.includes("Fixture reader · Fixture book class 1") && html.includes("Fixture book class 3") && !html.includes("Fixture book class 4"));
  assert.ok(html.includes('href="/books/fixture-citation">Fixture cited book</a>'));
  assert.ok(html.includes("Fixture citation author"));
  assert.ok(html.includes('>Fixture citing class<span aria-hidden="true"> · </span>'));
  assert.ok(html.includes('href="/note/classes/2026/fixture-citation?source=fixture&amp;t=4520#moment"'));
  entry.books = [];
  assert.ok(!renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry })).includes("Books against it"));
});

test("book OCR quotes preserve whitespace and misreadings as escaped text, with lazy page viewers", () => {
  const html = renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: fixture }));
  const page = fixture.books[0].pages[0];
  for (const quote of page.quotes) assert.ok(html.includes(renderToStaticMarkup(createElement("span", null, quote.text)).slice(6, -7)));
  assert.equal((html.match(/See it on the page/g) ?? []).length, 2);
  assert.ok(!html.includes(page.scan) && !html.includes("<not markup>"));
  const legacy = structuredClone(fixture);
  delete legacy.books[0].pages[0].quotes;
  assert.ok(!renderToStaticMarkup(createElement(library.DoctrineAnswers, { entry: legacy })).includes("See it on the page"));
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
