import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Api, InputFile } from "grammy";

const out = new URL("./.build/library-pdf.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../src/library-pdf.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { libraryPdf, TELEGRAM_PDF_LIMIT } = await import(out);
const token = "100:local-test";
const origin = "https://cyberjudah.test";
const item = "completeworksoff05jose";
const book = { title: "The Works of Flavius Josephus", license: "Public domain.", items: [{ id: item }], chapters: [{ k: 0, vol: 1, page: 7, end: 36 }] };
const pdfFile = { name: "different-name.pdf", format: "Text PDF", size: "100" };
const post = body => new Request(`${origin}/api/library/pdf`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const valid = { slug: "josephus", item };

function fixture(options = {}) {
  const reads = [], fetched = [], sent = [];
  const read = async path => {
    reads.push(path);
    if (path === "/api/library/index.json") return [{ slug: "josephus" }];
    if (path === "/api/library/josephus/book.json") return options.book ?? book;
    if (path === "/api/library/josephus/chapter/0.json") return options.chapter ?? { item, pages: [{ page: 7, img: 14 }, { page: 8, img: 15 }] };
    throw new Error(`Unexpected data request ${path}`);
  };
  const fetcher = async (url, init) => {
    fetched.push({ url, init });
    assert.equal(init.redirect, "manual");
    if (url === `https://archive.org/metadata/${item}`) return Response.json({ files: [options.pdfFile ?? pdfFile, { name: `${item}_page_numbers.json`, format: "Page Numbers JSON" }], ...options.metadata });
    if (url.endsWith("_page_numbers.json")) return Response.json({ pages: [{ leafNum: 1, pageNumber: "" }, { leafNum: 3, pageNumber: "7" }, { leafNum: 4, pageNumber: "8" }] });
    if (options.upstream) return options.upstream(url, init);
    assert.equal(url, `https://archive.org/download/${item}/different-name.pdf`);
    return new Response("%PDF-1.7\nfixture", { headers: { "content-type": "application/pdf", "accept-ranges": "bytes", "content-length": "16" } });
  };
  const send = async (stream, file, caption) => {
    sent.push({ file, caption });
    const reader = stream.getReader();
    try { while (!(await reader.read()).done) { /* consume the upload without buffering it */ } } finally { reader.releaseLock(); }
  };
  return { reads, fetched, sent, call: (request, sendFile = send) => libraryPdf(request, token, read, sendFile, fetcher) };
}

test("library PDF rejects unknown slugs, unknown items, foreign URLs and traversal before an Archive fetch", async () => {
  for (const body of [
    { ...valid, slug: "unknown" }, { ...valid, item: "unknown" }, { ...valid, item: "https://evil.test/a.pdf" },
    { ...valid, slug: "../josephus" }, { ...valid, item: `${item}/../secret` }, { ...valid, url: "http://169.254.169.254/" },
    { ...valid, send: "false" }, null,
    ...[-1, 0, 1.5, "7", null].map(printed => ({ ...valid, printed })),
  ]) {
    const f = fixture();
    assert.ok([400, 404].includes((await f.call(post(body))).status), JSON.stringify(body));
    assert.deepEqual(f.fetched, []);
    assert.deepEqual(f.sent, []);
  }
});

test("a non-public-domain or missing license never gets a PDF, even with an allowed item", async () => {
  for (const license of ["Shared with the assembly for study.", "Copyright 2014", "Not public domain", "", null]) {
    const f = fixture({ book: { ...book, license } });
    assert.equal((await f.call(post(valid))).status, 404);
    assert.deepEqual(f.fetched, []);
  }
});

test("a signed 15-minute link resolves the filename from Archive's files list, not the item ID", async () => {
  const f = fixture();
  const response = await f.call(post(valid));
  assert.equal(response.status, 200);
  const link = await response.json(), url = new URL(link.url);
  assert.equal(url.pathname, `/api/library/pdf/josephus/${item}`);
  assert.ok(Math.abs(Number(url.searchParams.get("exp")) - Date.now() / 1000 - 900) < 2);
  const download = await f.call(new Request(`${link.url}&download=1`));
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.equal(download.headers.get("access-control-expose-headers"), "Accept-Ranges, Content-Length, Content-Range");
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.equal(await download.text(), "%PDF-1.7\nfixture");
  assert.equal(f.fetched.at(-1).url, `https://archive.org/download/${item}/different-name.pdf`);
});

test("signed links reject missing, tampered and expired signatures before looking up a book", async () => {
  const f = fixture();
  const { url } = await (await f.call(post(valid))).json();
  f.reads.length = 0;
  for (const bad of [url.split("?")[0], url.replace("sig=", "sig=0"), url.replace(/exp=\d+/, "exp=1"), url.replace("/josephus/", "/other/")]) assert.equal((await f.call(new Request(bad))).status, 403);
  assert.deepEqual(f.reads, []);
});

test("a previously issued link cannot serve a book after its public-domain license is removed", async () => {
  const f = fixture();
  const { url } = await (await f.call(post(valid))).json();
  const blocked = fixture({ book: { ...book, license: "Copyright" } });
  assert.equal((await blocked.call(new Request(url))).status, 404);
  assert.deepEqual(blocked.fetched, []);
});

test("PDF proxy streams byte ranges and preserves partial response headers", async () => {
  const f = fixture({ upstream: (_url, init) => {
    assert.equal(init.headers.range, "bytes=0-4");
    return new Response("%PDF-", { status: 206, headers: { "content-type": "application/pdf", "content-range": "bytes 0-4/100", "content-length": "5", "accept-ranges": "bytes" } });
  } });
  const { url } = await (await f.call(post(valid))).json();
  const res = await f.call(new Request(url, { headers: { range: "bytes=0-4" } }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 0-4/100");
  assert.equal(res.headers.get("content-length"), "5");
  assert.equal(await res.text(), "%PDF-");
});

test("private, restricted, missing, or unsafe PDF files are never served", async () => {
  for (const options of [
    { pdfFile: { ...pdfFile, private: "true" } }, { pdfFile: { ...pdfFile, name: "../secret.pdf" } },
    { pdfFile: { ...pdfFile, name: "https://evil.test/a.pdf" } }, { metadata: { files: [] } },
    { metadata: { is_dark: true } }, { metadata: { metadata: { "access-restricted-item": "true" } } },
  ]) assert.equal((await fixture(options).call(post(valid))).status, 404);
});

test("foreign and non-HTTPS redirects are refused without fetching their targets", async () => {
  for (const location of ["https://evil.test/a.pdf", "http://archive.org/a.pdf", "http://127.0.0.1/a.pdf", "https://archive.org.evil.test/a.pdf", "https://user@archive.org/a.pdf"]) {
    const f = fixture({ upstream: () => new Response(null, { status: 302, headers: { location } }) });
    const { url } = await (await f.call(post(valid))).json();
    assert.equal((await f.call(new Request(url))).status, 404);
    assert.ok(f.fetched.every(v => v.url.startsWith("https://archive.org/")));
  }
});

test("Archive-owned HTTPS download redirects are followed", async () => {
  const f = fixture({ upstream: url => url.startsWith("https://archive.org/")
    ? new Response(null, { status: 302, headers: { location: "https://dn1.us.archive.org/items/book/file.pdf" } })
    : new Response("PDF", { headers: { "content-type": "application/pdf" } }) });
  const { url } = await (await f.call(post(valid))).json();
  assert.equal(await (await f.call(new Request(url))).text(), "PDF");
});

test("chat delivery streams an allowed PDF with its filename and book title", async () => {
  const f = fixture();
  assert.deepEqual(await (await f.call(post({ ...valid, send: true }))).json(), { ok: true, sent: true });
  assert.deepEqual(f.sent, [{ file: `${item}.pdf`, caption: book.title }]);
});

test("grammy InputFile uploads the PDF stream as a Telegram document without a PDF buffer", async () => {
  let uploaded = false;
  const api = new Api(token, { fetch: async (_url, init) => {
    const upload = await new Response(init.body).text();
    assert.match(upload, /name="chat_id"\r\n\r\n1/);
    assert.ok(upload.includes(`filename=${item}.pdf`));
    assert.ok(upload.includes("%PDF-1.7\nfixture"));
    uploaded = true;
    return Response.json({ ok: true, result: { message_id: 1 } });
  } });
  const f = fixture();
  const res = await f.call(post({ ...valid, send: true }), (stream, file, caption) => api.sendDocument(1, new InputFile(stream, file), { caption }));
  assert.equal(res.status, 200);
  assert.equal(uploaded, true);
});

test("oversize metadata refuses chat delivery before fetching a PDF, but allows Download", async () => {
  const f = fixture({ pdfFile: { ...pdfFile, size: String(TELEGRAM_PDF_LIMIT + 1) } });
  const res = await f.call(post({ ...valid, send: true }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /Download the PDF/);
  assert.ok(f.fetched.every(v => v.url.includes("/metadata/")));
  assert.equal((await f.call(post(valid))).status, 200);
  assert.deepEqual(f.sent, []);
});

test("the actual content length also enforces the 50 MB chat limit", async () => {
  const f = fixture({ upstream: () => new Response("body", { headers: { "content-type": "application/pdf", "content-length": String(TELEGRAM_PDF_LIMIT + 1) } }) });
  assert.equal((await f.call(post({ ...valid, send: true }))).status, 413);
  assert.deepEqual(f.sent, []);
});

test("a chunked upload exceeding the limit is cancelled without reporting success", async () => {
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const f = fixture({ upstream: () => new Response(new ReadableStream({ pull(c) { c.enqueue(chunk); }, cancel() { cancelled = true; } }), { headers: { "content-type": "application/pdf" } }) });
  const response = await f.call(post({ ...valid, send: true }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).reason, "too-large");
  assert.equal(cancelled, true);
});

test("failed chat delivery tells the reader to start a chat with the bot", async () => {
  const f = fixture();
  const res = await f.call(post({ ...valid, send: true }), async () => { throw new Error("chat not found"); });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /press Start/);
});

test("printed pages use Library's access-page index, not missing or incorrect Archive OCR page labels", async () => {
  const f = fixture();
  assert.equal((await (await f.call(post({ ...valid, printed: 7 }))).json()).page, 15);
  assert.equal((await (await f.call(post({ ...valid, printed: 8 }))).json()).page, 16);
  assert.ok(f.fetched.every(v => !v.url.endsWith("_page_numbers.json")));
  assert.equal((await fixture().call(post({ ...valid, printed: 999 }))).status, 404);
  assert.equal((await fixture({ chapter: { item: "different-item", pages: [{ page: 7, img: 14 }] } }).call(post({ ...valid, printed: 7 }))).status, 404);
});
