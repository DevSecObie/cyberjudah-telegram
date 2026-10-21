import { expect, test, type Page } from "@playwright/test";

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const results = (offset = 0, limit = 20, word = "light") => Array.from({ length: Math.min(limit, 45 - offset) }, (_, i) => ({ book: 1, chapter: 1, verse: offset + i + 1, text: `And God said, Let there be ${word}: and there was ${word}.` }));

async function setup(page: Page, theme = "light") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme === "dark" ? "dark" : "light" });
  await page.addInitScript(theme => {
    localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }));
  }, theme);
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", testament: "Old Testament", chapters: 2, verses: 62, chapterIds: [1, 2] }] });
    if (path.includes("/api/kjv/genesis/")) return r.fulfill({ json: { book: "genesis", chapter: 1, translation: "KJV", verses: results(0, 31).map(v => ({ verse: v.verse, text: v.text })) } });
    if (path.includes("people")) return r.fulfill({ json: [] });
    return r.fulfill({ status: 404, body: "" });
  });
  const requests: URL[] = [];
  await page.route("**/bs/v1/bibles/KJV/search?**", r => {
    const url = new URL(r.request().url()); requests.push(url);
    return r.fulfill({ json: { results: results(Number(url.searchParams.get("offset")), Number(url.searchParams.get("limit")), url.searchParams.get("q") || "light"), count: 45 } });
  });
  return requests;
}

for (const theme of ["light", "dark"]) test(`reader search screenshot: ${theme}`, async ({ page }) => {
  await setup(page, theme);
  await page.goto("/read/genesis/1?search=light");
  await expect(page.locator(".bs-search__hit").first()).toBeVisible();
  await page.locator(".bs-search__hit").first().focus();
  await page.screenshot({ path: `e2e/review/reader-search/${process.env.REVIEW_PHASE || "after"}/${theme}-390.png` });
});

test("reader search waits 800 ms, keeps previous verses, and Search submits without opening a verse", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/read/genesis/1?search=light");
  await expect(page.locator(".bs-search__hit")).toHaveCount(20);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/bs/v1/bibles/KJV/search?**", async r => {
    const url = new URL(r.request().url());
    if (url.searchParams.get("q") !== "mercy") return r.fallback();
    requests.push(url);
    await held;
    await r.fulfill({ json: { results: results(0, 20, "mercy"), count: 45 } });
  });
  const input = page.getByRole("searchbox", { name: "Search", exact: true });
  await input.fill("mercy");
  await page.clock.runFor(799);
  expect(requests.map(u => u.searchParams.get("q"))).toEqual(["light"]);
  await page.clock.runFor(1);
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.locator(".bs-search__hit").first()).toContainText("light");
  release();
  await page.clock.resume();
  await expect(page.locator(".bs-search__hit").first()).toContainText("mercy");
  await input.fill("peace");
  await input.press("Enter");
  await expect.poll(() => requests.map(u => u.searchParams.get("q"))).toEqual(["light", "mercy", "peace"]);
  await expect(page.getByRole("dialog", { name: "Search the Scriptures", exact: true })).toBeVisible();
  await expect(input).not.toBeFocused();
  await page.clock.runFor(1000);
  expect(requests).toHaveLength(3);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.locator(".bs-search__hit")).toHaveCount(0);
});

test("reader search appends pages of 20 near the end and stops at the count", async ({ page }) => {
  const requests = await setup(page);
  await page.goto("/read/genesis/1?search=light");
  await expect(page.locator(".bs-search__hit")).toHaveCount(20);
  await expect(page.getByRole("button", { name: "More verses", exact: true })).toHaveCount(0);
  const scroll = page.locator(".bs-versesearch .bs-sheet__body");
  const nearEnd = () => scroll.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight * 1.3; });
  await nearEnd();
  await expect(page.locator(".bs-search__hit")).toHaveCount(40);
  await expect(page.locator(".bs-search__hit").first()).toContainText("Genesis 1:1");
  await nearEnd();
  await expect(page.locator(".bs-search__hit")).toHaveCount(45);
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(requests.map(u => [u.searchParams.get("limit"), u.searchParams.get("offset")])).toEqual([["20", "0"], ["20", "20"], ["20", "40"]]);
  await page.locator(".bs-search__hit").nth(22).click();
  await expect(page).toHaveURL(/\/read\/genesis\/1\?v=23/);
});

test("reader search retries 429 once after Retry-After and reports the limit", async ({ page }) => {
  await setup(page);
  const calls: number[] = [];
  await page.route("**/bs/v1/bibles/KJV/search?**", r => { calls.push(Date.now()); return r.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: {} }); });
  await page.goto("/read/genesis/1?search=light");
  await expect(page.getByRole("status").filter({ hasText: "Retrying automatically after 2 seconds" })).toBeVisible();
  expect(calls).toHaveLength(1);
  await expect(page.getByRole("status").filter({ hasText: "Wait 2 seconds before trying again" })).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1900);
  await page.clock.install();
  await page.clock.fastForward(120_000);
  expect(calls).toHaveLength(2);
});

test("reader search clears a throttled request before its default 60-second retry", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/bs/v1/bibles/KJV/search?**", r => { calls++; return r.fulfill({ status: 429, json: {} }); });
  await page.goto("/read/genesis/1?search=light");
  await expect(page.getByRole("status").filter({ hasText: "after 60 seconds" })).toBeVisible();
  await page.clock.install();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("Too many searches", { exact: false })).toHaveCount(0);
  await page.clock.fastForward(120_000);
  expect(calls).toBe(1);
  await expect(page.locator(".bs-search__hit")).toHaveCount(0);
});

test("reader search distinguishes an empty result from an ordinary failure and retries manually", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/bs/v1/bibles/KJV/search?**", r => { calls++; return calls === 1 ? r.fulfill({ status: 503, json: {} }) : r.fulfill({ json: { results: [], count: 0 } }); });
  await page.goto("/read/genesis/1?search=light");
  await expect(page.getByRole("alert")).toContainText("Bible search could not be opened.");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText('No results found for "light"')).toBeVisible();
  expect(calls).toBe(2);
});

test("an empty previous search does not report the next query empty before it finishes", async ({ page }) => {
  await setup(page);
  await page.goto("/read/genesis/1?search=light");
  await expect(page.locator(".bs-search__hit")).toHaveCount(20);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/bs/v1/bibles/KJV/search?**", async r => {
    if (new URL(r.request().url()).searchParams.get("q") === "mercy") await held;
    await r.fulfill({ json: { results: [], count: 0 } });
  });
  const input = page.getByRole("searchbox", { name: "Search", exact: true });
  await input.fill("empty");
  await input.press("Enter");
  await expect(page.getByText('No results found for "empty"')).toBeVisible();
  await input.fill("mercy");
  await input.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Searching" })).toBeVisible();
  await expect(page.getByText('No results found for "mercy"')).toHaveCount(0);
  release();
  await expect(page.getByText('No results found for "mercy"')).toBeVisible();
});
