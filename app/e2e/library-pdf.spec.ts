import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { PDFDocument, rgb } from "pdf-lib";
import { setup, LAUNCH, DATA_ORIGIN } from "./telegram-harness";

const out = new URL("../../bot/tests/.build/library-pdf-e2e.mjs", import.meta.url).pathname;
await build({ entryPoints: [new URL("../../bot/src/library-pdf.ts", import.meta.url).pathname], bundle: true, format: "esm", platform: "node", packages: "external", outfile: out, logLevel: "error" });
const { libraryPdf } = await import(out) as typeof import("../../bot/src/library-pdf");
const item = "completeworksoff05jose";
const book = { slug: "josephus", title: "The Works of Flavius Josephus", author: "Flavius Josephus", year: 1905, subtitle: "", publisher: "", license: "Public domain.", source: `https://archive.org/details/${item}`, items: [{ id: item, label: "" }], volumes: 1, figures: [], chapters: [{ k: 0, n: "", title: "The Life", vol: 1, volume: "", page: 7, end: 8, topics: "", reads: 0 }], reads: [{ video: "fixture", vol: 1, page: 7, t: 42, ts: "0:42", title: "A class reading", date: null, teacher: "", url: null }] };
const chapter = { ...book.chapters[0], item, pages: [{ vol: 1, page: 7, img: 1, text: "A synthetic public-domain page fixture.", reads: [], figure: null, foldout: null }] };
const pdf = await PDFDocument.create();
for (const [index, color] of [rgb(.8, .1, .1), rgb(.1, .6, .2), rgb(.1, .2, .8)].entries()) {
  const p = pdf.addPage([300, 450]);
  p.drawText("Public-domain Library PDF", { x: 24, y: 395, size: 18 });
  p.drawText(`Sample page ${index + 1}`, { x: 24, y: 355, size: 16 });
  p.drawText("Archive transport fixture", { x: 24, y: 320, size: 12 });
  p.drawRectangle({ x: 40, y: 185, width: 220, height: 80, color });
  p.drawText("Generated in memory for the browser test.", { x: 24, y: 100, size: 11 });
}
// Keep the fixture large enough for PDF.js to use byte ranges rather than loading it whole.
pdf.context.register(pdf.context.stream(new Uint8Array(768 * 1024)));
const bytes = Buffer.from(await pdf.save());

async function library(page: Page, license = "Public domain.", items = book.items, pdfOrigin?: string) {
  const fixtureBook = { ...book, license, items, volumes: items.length };
  await setup(page);
  await page.route(`${DATA_ORIGIN}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/library/index.json") return r.fulfill({ json: [book] });
    if (path === "/api/library/josephus/book.json") return r.fulfill({ json: fixtureBook });
    if (path === "/api/library/josephus/chapter/0.json") return r.fulfill({ json: chapter });
    return r.fulfill({ status: 404 });
  });
  let archiveFetches = 0;
  // Exercise the actual bot PDF handler, mocking its Archive transport, not pdf.js or the canvas.
  await page.route("**/api/library/pdf{,/**}", async route => {
    const req = route.request();
    const request = new Request(req.url(), { method: req.method(), headers: req.headers(), ...(req.method() === "POST" ? { body: req.postData() } : {}) });
    const response = await libraryPdf(request, "100:local-pdf-test", async <T>(path: string) => (path.endsWith("index.json") ? [{ slug: book.slug }] : path.endsWith("chapter/0.json") ? chapter : fixtureBook) as T,
      async stream => { await new Response(stream).arrayBuffer(); },
      async (input, init) => {
        archiveFetches++;
        const url = String(input);
        if (url.includes("/metadata/")) return Response.json({ files: [{ name: "original-printing.pdf", format: "Text PDF", size: String(bytes.length) }] });
        expect(items.some(i => url === `https://archive.org/download/${i.id}/original-printing.pdf`)).toBe(true);
        const range = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get("range") ?? "");
        if (range) {
          const start = Number(range[1]), end = Math.min(Number(range[2]), bytes.length - 1);
          const part = bytes.subarray(start, end + 1);
          return new Response(part, { status: 206, headers: { "content-type": "application/pdf", "content-length": String(part.length), "content-range": `bytes ${start}-${end}/${bytes.length}`, "accept-ranges": "bytes" } });
        }
        return new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(bytes.length), "accept-ranges": "bytes" } });
      });
    const headers = { ...Object.fromEntries(response.headers), "access-control-allow-origin": req.headers().origin ?? "*" };
    if (pdfOrigin && req.method() === "POST" && response.ok && !req.postDataJSON()?.send) {
      const link = await response.json() as { url: string };
      link.url = link.url.replace(new URL(req.url()).origin, pdfOrigin);
      return route.fulfill({ status: response.status, headers, json: link });
    }
    await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
  });
  return () => archiveFetches;
}

for (const theme of ["light", "dark"]) test(`Library PDF renders, turns pages and exports (${theme})`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await library(page);
  await page.addInitScript(theme => { (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }) }; }, theme);
  const errors: string[] = [];
  const pdfRequests: string[] = [];
  page.on("request", r => { if (/BookPdf-|pdf\.worker/.test(r.url())) pdfRequests.push(r.url()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`/books/josephus${LAUNCH}`);
  await expect(page.getByRole("link", { name: "Open PDF", exact: true })).toBeVisible();
  expect(pdfRequests).toEqual([]);
  await page.getByRole("link", { name: "Open PDF", exact: true }).click();
  const canvas = page.locator(".bookpdf canvas");
  await expect(canvas).toHaveAttribute("data-page", "1");
  expect(pdfRequests.some(url => url.includes("pdf.worker"))).toBe(true);
  const pixel = () => canvas.evaluate(el => { const c = el as HTMLCanvasElement; return Array.from(c.getContext("2d")!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data); });
  expect((await pixel())[0]).toBeGreaterThan(150);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-page", "2");
  expect((await pixel())[1]).toBeGreaterThan(100);
  await expect(page.getByRole("spinbutton", { name: "PDF page", exact: true })).toHaveValue("2");
  await page.getByRole("spinbutton", { name: "PDF page", exact: true }).fill("3");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-page", "3");
  await page.getByRole("button", { name: "Previous page", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-page", "2");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("125%");
  await page.getByRole("button", { name: "Fit width", exact: true }).click();
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("100%");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(canvas).toHaveCSS("filter", theme === "dark" ? "invert(0.9) hue-rotate(180deg)" : "none");
  await page.screenshot({ path: testInfo.outputPath(`library-pdf-${theme}.png`), fullPage: true });
  await page.getByRole("button", { name: "Export as PDF", exact: true }).click();
  await page.getByText("Download the PDF", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tg.log.filter((x: string[]) => x[0] === "download"))).toEqual([["download", `${item}.pdf`]]);
  await page.getByRole("button", { name: "Export as PDF", exact: true }).click();
  await page.getByText("Send it to my Telegram chat", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tg.log.some((x: string[]) => x[0] === "alert" && x[1].startsWith("Sent.")))).toBe(true);
  await page.evaluate(() => (window as any).__tg.press("back"));
  await expect(page).toHaveURL(/\/books\/josephus(?:#.*)?$/);
  expect(errors).toEqual([]);
});

test("a Library printed-page link opens its matching PDF page rather than that page number", async ({ page }) => {
  await library(page);
  await page.goto(`/books/josephus/0${LAUNCH}`);
  await page.getByRole("link", { name: "Open at this page in the PDF", exact: true }).click();
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "2");
  await expect(page.getByRole("spinbutton", { name: "PDF page", exact: true })).toHaveValue("2");
});

test("a class reading resolves the Library's printed-page index and stays within a phone's width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await library(page);
  await page.goto(`/books/josephus${LAUNCH}`);
  await expect(page.getByRole("link", { name: "Open at this page in the PDF", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Open at this page in the PDF", exact: true }).click();
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "2");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "3");
});

test("two touch points pinch to zoom and a single touch pans the rendered PDF", async ({ page, context }) => {
  await library(page);
  await page.goto(`/books/josephus/pdf${LAUNCH}`);
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "1");
  const viewport = page.getByLabel("PDF page viewer", { exact: true });
  const box = (await viewport.boundingBox())!;
  const client = await context.newCDPSession(page);
  const touch = (x: number, y: number, id: number) => ({ x, y, id, radiusX: 2, radiusY: 2 });
  const y = box.y + 100;
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(130, y, 1), touch(230, y, 2)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(80, y, 1), touch(280, y, 2)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByLabel("Zoom", { exact: true })).toHaveText("200%");
  await expect.poll(() => page.locator(".bookpdf canvas").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(box.width * 1.5);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(250, y, 1)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(100, y - 80, 1)] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(50);
  await expect.poll(() => viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(20);
});

test("a direct PDF page link starts at the requested page", async ({ page }) => {
  await library(page);
  await page.goto(`/books/josephus/pdf?vol=1&page=3${LAUNCH}`);
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "3");
});

test("a cross-origin PDF exposes range headers and renders through partial requests", async ({ page }) => {
  const origin = "https://pdf-proxy.example.test";
  await library(page, "Public domain.", book.items, origin);
  const ranges: string[] = [];
  let pdfUrl = "";
  page.on("request", req => {
    if (!req.url().startsWith(origin)) return;
    pdfUrl = req.url();
    if (req.headers().range) ranges.push(req.headers().range);
  });
  await page.goto(`/books/josephus/pdf${LAUNCH}`);
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "1");
  expect(ranges.length).toBeGreaterThan(0);
  const headers = await page.evaluate(async url => {
    const res = await fetch(url, { headers: { range: "bytes=0-31" } });
    const result = { status: res.status, ranges: res.headers.get("accept-ranges"), length: res.headers.get("content-length"), range: res.headers.get("content-range") };
    await res.body?.cancel();
    return result;
  }, pdfUrl);
  expect(headers).toEqual({ status: 206, ranges: "bytes", length: "32", range: `bytes 0-31/${bytes.length}` });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "2");
});

test("the requested volume opens and the volume selector resets to its first page", async ({ page }) => {
  await library(page, "Public domain.", [{ id: item, label: "First volume" }, { id: "second-public-domain-volume", label: "Second volume" }]);
  await page.goto(`/books/josephus/pdf?vol=2&page=3${LAUNCH}`);
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "3");
  await expect(page.getByLabel("PDF volume", { exact: true })).toHaveValue("2");
  await page.getByLabel("PDF volume", { exact: true }).selectOption("1");
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "1");
  await expect(page).toHaveURL(/vol=1&page=1/);
});

test("oversize chat refusal points to Download without reporting a successful send", async ({ page }) => {
  await library(page);
  await page.route("**/api/library/pdf", async route => {
    if (route.request().postDataJSON()?.send) return route.fulfill({ status: 413, json: { ok: false, reason: "too-large", error: "Use Download the PDF instead." } });
    return route.fallback();
  });
  await page.goto(`/books/josephus/pdf${LAUNCH}`);
  await expect(page.locator(".bookpdf canvas")).toHaveAttribute("data-page", "1");
  await page.getByRole("button", { name: "Export as PDF", exact: true }).click();
  await page.getByText("Send it to my Telegram chat", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__tg.log.filter((x: string[]) => x[0] === "alert").map((x: string[]) => x[1]))).toEqual(["This PDF is over Telegram’s 50 MB limit. Use Download the PDF instead."]);
  await page.getByRole("button", { name: "Export as PDF", exact: true }).click();
  await expect(page.getByText("Download the PDF", { exact: true })).toBeVisible();
});

test("a non-public-domain book has no PDF entry or viewer access", async ({ page }) => {
  const fetches = await library(page, "Shared with the assembly for study.");
  await page.goto(`/books/josephus${LAUNCH}`);
  await expect(page.getByRole("heading", { name: book.title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open PDF", exact: true })).toHaveCount(0);
  await page.goto(`/books/josephus/pdf${LAUNCH}`);
  await expect(page.getByText("This book does not have a public-domain PDF", { exact: true })).toBeVisible();
  expect(fetches()).toBe(0);
});
