import { expect, test, type Page } from "@playwright/test";
import aaronSnapshot from "./nave-aaron-snapshot.json" with { type: "json" };

const DATA = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const resource = { kind: "nave", language: "en", revision: "nave-test" };
const summary = (normalizedName: string, name: string) => ({ normalizedName, name, initial: normalizedName[0] });
const aaron = summary("aaron", "Aaron");
const adam = summary("adam", "Adam");
const babylon = summary("babylon", "Babylon");
const description = '<p><bold>Brother of Moses.</bold> See <a href="w=adam">Adam</a> and <a href="v=1-1-1,2">Genesis 1:1–2</a>.</p><p>Editorial &amp;nbsp; words.</p>';

async function setup(page: Page, theme: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route(`${DATA}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (path === "/api/kjv/books.json") return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, verses: 2, chapterIds: [1] }] });
    if (path === "/api/kjv/genesis/1.json") return r.fulfill({ json: { book: "Genesis", chapter: 1, translation: "KJV", verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void." }] } });
    return r.fulfill({ status: 404 });
  });
  await page.route("**/api/nave/**", r => {
    const url = new URL(r.request().url());
    const path = url.pathname;
    if (path.endsWith("/random")) return r.fulfill({ json: { resource, topic: { ...aaron, description } } });
    if (path.includes("/verses/")) {
      const verseKey = path.split("/").at(-2)!;
      return r.fulfill({ json: { resource, verseKey, verseTopics: verseKey.endsWith("-1") ? [aaron] : [], chapterTopics: verseKey.endsWith("-1") ? [adam] : [] } });
    }
    if (path.endsWith("/topics")) {
      const search = url.searchParams.get("search");
      const topics = search ? search === "absent" ? [] : [aaron] : url.searchParams.get("initial") === "b" ? [babylon] : url.searchParams.has("cursor") ? [adam] : [aaron, ...Array.from({ length: 30 }, (_, i) => summary(`a-test-${i}`, `A test ${i}`))];
      return r.fulfill({ json: { resource, topics, limit: 50, ...(!search && url.searchParams.get("initial") === "a" && !url.searchParams.has("cursor") ? { nextCursor: "opaque%20cursor" } : {}) } });
    }
    const name = decodeURIComponent(path.split("/").at(-1)!);
    if (name === "missing") return r.fulfill({ status: 404 });
    const topic = name === "adam" ? { ...adam, description: '<p>The first man. See <a href="w=aaron">Aaron</a>.</p>' } : { ...aaron, description };
    return r.fulfill({ json: { resource, topic } });
  });
  await page.addInitScript(theme => {
    if (!localStorage.getItem("cj:bs")) localStorage.setItem("cj:bs", JSON.stringify({ press: "longPress", preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark", fontFamily: "Georgia" }));
    if (!localStorage.getItem("cj:bs_tags")) localStorage.setItem("cj:bs_tags", JSON.stringify({ study: { id: "study", name: "My study", date: 1 } }));
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; }, readText: async () => copied } });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  }, theme);
}

async function action(page: Page, name: string) {
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await page.getByRole("dialog", { name: "Options", exact: true }).getByRole("button", { name, exact: true }).click();
}

for (const theme of ["light", "dark"]) {
  test(`Nave displays the full Aaron article (${theme})`, async ({ page }) => {
    await setup(page, theme);
    // Full public English article from api.bible-strong.app/v1/naves/en/topics/aaron, revision nave-en-a3ca283196d0eb084276.
    await page.route("**/api/nave/en/topics/aaron", route => route.fulfill({ json: aaronSnapshot }));
    await page.goto("/nave/en/aaron");
    const article = page.locator(".bs-nave-html");
    await expect(article.locator('a[href^="v="]')).toHaveCount(77);
    await expect(article).toContainText("Lineage of");
    await expect(article).toContainText("Age of, at death");
    await expect(article).toContainText("Death and burial of");
    const lastLink = article.getByRole("link", { name: "PRIEST, HIGH", exact: true });
    await expect(lastLink).toHaveAttribute("href", "w=priest");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: test.info().outputPath(`nave-aaron-top-${theme}.png`) });
    await lastLink.scrollIntoViewIfNeeded();
    await expect(lastLink).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath(`nave-aaron-bottom-${theme}.png`) });
  });

  test(`Nave renders and copies English Bible-reference labels without changing their destinations (${theme})`, async ({ page }) => {
    await setup(page, theme);
    const html = '<p><ul><li>Lineage of <br><a href="v=2-6-16,17,18,19,20">Exode 6:16-20</a>; <a href="v=13-6-2,3">1 Chroniques 6:2–3</a><p><li>Descendants of <br><a href="v=13-24">1 Chroniques 24</a><p><li>See <a href="w=adam">Adam</a> and <a href="v=1-1-1,2">Genesis 1:1–2</a></ul></p>';
    await page.route("**/api/nave/en/topics/aaron", r => r.fulfill({ json: { resource, topic: { ...aaron, description: html } } }));
    await page.goto("/nave/en/aaron");
    const article = page.locator(".bs-nave-html");
    await expect(article).toContainText("Lineage of");
    await expect(article).not.toContainText("Exode");
    await expect(article).not.toContainText("Chroniques");
    await expect(article.getByRole("link", { name: "Exodus 6:16-20", exact: true })).toHaveAttribute("href", "v=2-6-16,17,18,19,20");
    await expect(article.getByRole("link", { name: "1 Chronicles 6:2–3", exact: true })).toHaveAttribute("href", "v=13-6-2,3");
    await expect(article.getByRole("link", { name: "1 Chronicles 24", exact: true })).toHaveAttribute("href", "v=13-24");
    await expect(article.getByRole("link", { name: "Adam", exact: true })).toHaveAttribute("href", "w=adam");
    await expect(article.getByRole("link", { name: "Genesis 1:1–2", exact: true })).toHaveAttribute("href", "v=1-1-1,2");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: test.info().outputPath(`nave-english-references-${theme}.png`) });
    await action(page, "Copy the text");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Exodus 6:16-20");
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toMatch(/Exode|Chroniques/);
    await article.getByRole("link", { name: "Adam", exact: true }).click();
    const preview = page.locator(".refpreview");
    await preview.getByRole("link", { name: "Aaron", exact: true }).click();
    await expect(preview.getByRole("link", { name: "Exodus 6:16-20", exact: true })).toHaveAttribute("href", "v=2-6-16,17,18,19,20");
  });

  test(`English Nave list keeps letters, cursor pages and word search (${theme})`, async ({ page }) => {
    await setup(page, theme);
    await page.goto("/nave");
    await expect(page.getByRole("heading", { name: "Nave thematic", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Aaron", exact: true })).toHaveAttribute("href", /\/nave\/en\/aaron$/);
    await expect(page.getByRole("radiogroup", { name: "Letters" })).toBeVisible();
    await expect.poll(() => page.locator(".bs-nave-item").first().boundingBox().then(box => box?.x)).toBe(20);
    await expect(page.locator(".bs-nave-item").first()).toHaveCSS("height", "60px");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: test.info().outputPath(`nave-list-${theme}.png`) });
    await page.locator(".list-more").scrollIntoViewIfNeeded();
    await expect(page.getByRole("link", { name: "Adam", exact: true })).toBeVisible();
    await page.getByRole("radio", { name: "B", exact: true }).click();
    await expect(page.getByRole("link", { name: "Babylon", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Aaron", exact: true })).toHaveCount(0);
    const search = page.getByRole("searchbox", { name: "Search by word" });
    await search.fill("Aaron");
    await expect(page.getByRole("radiogroup", { name: "Letters" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Aaron", exact: true })).toBeVisible();
    await search.fill("absent");
    await expect(page.getByText("No word found...", { exact: true })).toBeVisible();
    await search.fill("");
    await expect(page.getByRole("radio", { name: "B", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("link", { name: "Babylon", exact: true })).toBeVisible();
  });

  test(`Nave articles retain tags, copy/share, history and new-tab actions (${theme})`, async ({ page }) => {
    await setup(page, theme);
    await page.goto("/nave/en/aaron");
    await expect(page.getByRole("heading", { name: "Aaron", exact: true })).toBeVisible();
    await expect(page.locator(".bs-nave-html bold")).toHaveText("Brother of Moses.");
    await expect(page.locator(".bs-nave-html").getByRole("link", { name: "Adam", exact: true })).toHaveCSS("text-decoration-line", "underline");
    await expect(page.locator(".bs-nave-html")).toHaveCSS("font-size", "19px");
    await expect(page.locator(".bs-nave-html")).toHaveCSS("line-height", "35px");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: test.info().outputPath(`nave-article-${theme}.png`) });
    await action(page, "Copy the text");
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("Aaron\n\nBrother of Moses.");
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("/nave/en/aaron");
    await action(page, "Share the link");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/app\/nave\/en\/aaron$/);
    await action(page, "Tags");
    const tags = page.getByRole("dialog", { name: "Tags for Aaron", exact: true });
    await tags.getByRole("checkbox", { name: "My study", exact: true }).click();
    await expect(tags.getByRole("checkbox", { name: "My study", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(tags).toBeHidden();
    await expect(page.locator(".bs-nave-chips")).toContainText("My study");
    await page.reload();
    await expect(page.locator(".bs-nave-chips")).toContainText("My study");
    await action(page, "Open in new tab");
    await expect(page.locator(".toast__text")).toContainText("New tab created");
    await expect(page.getByRole("button", { name: "Go to tab", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/nave\/en\/aaron$/);
    await expect.poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("cj:tabgroups") ?? "{}")))).toContain("/nave/en/aaron");
    await page.goto("/tags/study");
    await page.getByRole("button", { name: "Nave 1", exact: true }).click();
    await expect(page.getByRole("link", { name: "Aaron", exact: false })).toHaveAttribute("href", /\/nave\/en\/aaron$/);
    await page.goto("/history");
    await expect(page.getByRole("link", { name: "Aaron Nave", exact: false })).toHaveAttribute("href", /\/nave\/en\/aaron$/);
  });

  test(`Nave and Scripture links open nested previews without losing the article (${theme})`, async ({ page }) => {
    await setup(page, theme);
    await page.goto("/nave/en/aaron");
    await page.locator(".bs-nave-html").getByRole("link", { name: "Adam", exact: true }).click();
    const preview = page.locator(".refpreview");
    await expect(preview).toContainText("The first man.");
    await expect(page).toHaveURL(/\/nave\/en\/aaron$/);
    await preview.getByRole("link", { name: "Aaron", exact: true }).click();
    await expect(preview).toContainText("Brother of Moses.");
    await preview.getByRole("button", { name: "Back", exact: true }).click();
    await expect(preview).toContainText("The first man.");
    await preview.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/nave\/en\/adam$/);
    await expect(page.getByRole("heading", { name: "Adam", exact: true })).toBeVisible();
    await page.goto("/nave/en/aaron");
    await page.locator(".bs-nave-html").getByRole("link", { name: "Genesis 1:1–2", exact: true }).click();
    await expect(preview).toContainText("In the beginning God created");
    await expect(preview).toContainText("And the earth was without form");
    await preview.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page).toHaveURL(/\/read\/genesis\/1\?v=1-2$/);
  });

  test(`Nave verse topics separate the verse and chapter, then show the empty state (${theme})`, async ({ page }) => {
    await setup(page, theme);
    await page.goto("/read/genesis/1");
    await page.locator("#verset-1 .bs-num").click({ delay: 600 });
    const sheet = page.locator(".bs-resources-sheet");
    await sheet.getByRole("tab", { name: "Themes", exact: true }).click();
    await expect(sheet.getByText("Regarding the verse", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Regarding the entire chapter", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Aaron", exact: true })).toHaveAttribute("href", /\/nave\/en\/aaron$/);
    await sheet.getByRole("button", { name: "Next verse", exact: true }).click();
    await expect(sheet.getByText("No topic is associated with this verse or chapter.", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Previous verse", exact: true }).click();
    await sheet.getByRole("link", { name: "Aaron", exact: true }).click();
    await expect(page).toHaveURL(/\/nave\/en\/aaron$/);
    await expect(page.getByRole("heading", { name: "Aaron", exact: true })).toBeVisible();
  });

  test(`Nave relations use the topic identity and tags can be removed without losing it (${theme})`, async ({ page }) => {
    await setup(page, theme);
    await page.addInitScript(() => localStorage.setItem("cj:rel_other", JSON.stringify([{ id: "nave-relation", type: "linked", direction: "none", endpoints: [{ type: "entry", url: "/nave/en/aaron", kind: "nave", label: "Aaron" }, { type: "dictionary", slug: "babylon", label: "Babylon" }], createdAt: 1, updatedAt: 1 }])));
    await page.goto("/nave/en/aaron");
    const relations = page.locator(".bs-nave-chips").getByRole("button", { name: "1", exact: true });
    await expect(relations).toBeVisible();
    await relations.click();
    await expect(page).toHaveURL(/\/relations\?endpoint=entry%3A%2Fnave%2Fen%2Faaron&label=Aaron$/);
    await expect(page.getByText("Babylon", { exact: true })).toBeVisible();
    await page.goto("/nave/en/aaron");
    await action(page, "Edit relations");
    await expect(page).toHaveURL(/\/relations\?endpoint=entry%3A%2Fnave%2Fen%2Faaron&label=Aaron$/);
    await page.goto("/nave/en/aaron");
    await action(page, "Tags");
    const tags = page.getByRole("dialog", { name: "Tags for Aaron", exact: true });
    await tags.getByRole("checkbox", { name: "My study", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-nave-chips")).toContainText("My study");
    await action(page, "Tags");
    await tags.getByRole("checkbox", { name: "My study", exact: true }).click();
    await expect(tags.getByRole("checkbox", { name: "My study", exact: true })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator(".bs-nave-chips")).not.toContainText("My study");
    await expect(relations).toBeVisible();
    await page.goto("/tags/study");
    await expect(page.getByText("You have not recorded anything with this label ...", { exact: true })).toBeVisible();
  });
}

test("Nave fails closed on invalid articles, retries failures, and distinguishes missing entries", async ({ page }) => {
  await setup(page, "light");
  let broken = true;
  await page.route("**/api/nave/en/topics/aaron", r => r.fulfill({ json: broken ? { resource: { ...resource, language: "fr" }, topic: { ...aaron, description } } : { resource, topic: { ...aaron, description } } }));
  await page.goto("/nave/en/aaron");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.locator(".bs-nave-html")).toHaveCount(0);
  broken = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".bs-nave-html")).toContainText("Brother of Moses.");
  await page.goto("/nave/en/missing");
  await expect(page.getByText("Unable to load Nave...", { exact: true })).toBeVisible();
});

test("Home's Nave discovery shuffles real topics and opens both the topic and its separate list", async ({ page }) => {
  await setup(page, "light");
  let loads = 0;
  await page.route("**/api/nave/en/random", r => r.fulfill({ json: { resource, topic: { ...(loads++ ? adam : aaron), description } } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  const widget = page.locator(".widget").filter({ has: page.getByRole("button", { name: "Nave Topics", exact: true }) });
  await expect(widget.getByRole("link", { name: "Nave Aaron", exact: true })).toHaveAttribute("href", /\/nave\/en\/aaron$/);
  await widget.getByRole("button", { name: "Another one", exact: true }).click();
  await expect(widget.getByRole("link", { name: "Nave Adam", exact: true })).toHaveAttribute("href", /\/nave\/en\/adam$/);
  expect(loads).toBe(2);
  await widget.getByRole("link", { name: "Nave Adam", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Adam", exact: true })).toBeVisible();
  await page.goBack();
  await widget.getByRole("button", { name: "Nave Topics", exact: true }).click();
  await expect(page).toHaveURL(/\/nave$/);
  await expect(page.getByRole("heading", { name: "Nave thematic", exact: true })).toBeVisible();
});

test("Nave editorial HTML preserves safe text and typography while discarding active content", async ({ page }) => {
  await setup(page, "dark");
  const html = '<p id="unsafe-id" style="color:red" onclick="window.naveUnsafe=true">Safe &amp;nbsp; words.</p><script>window.naveUnsafe=true</script><iframe srcdoc="unsafe"></iframe><form>unsafe form</form><a href="javascript:window.naveUnsafe=true">Unsafe link</a><p><a href="w=adam">Adam</a></p>';
  await page.route("**/api/nave/en/topics/aaron", r => r.fulfill({ json: { resource, topic: { ...aaron, description: html } } }));
  await page.addInitScript(() => localStorage.setItem("cj:bs", JSON.stringify({ preferredColorScheme: "dark", preferredDarkTheme: "dark", fontFamily: "Georgia", fontSizeScale: 2, lineHeight: "large" })));
  await page.goto("/nave/en/aaron");
  const article = page.locator(".bs-nave-html");
  await expect(article).toContainText("Safe \u00a0 words.");
  await expect(article.locator("script, iframe, form, [onclick], [id], [style]")).toHaveCount(0);
  await expect(article.getByRole("link", { name: "Unsafe link", exact: true })).toHaveCount(0);
  await expect.poll(() => article.evaluate(el => Number.parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(22.8, 1);
  await expect(article).toHaveCSS("line-height", "54px");
  await expect(article).toHaveCSS("font-family", /Georgia/);
  await article.getByRole("link", { name: "Adam", exact: true }).click();
  await expect(page.locator(".refpreview")).toContainText("The first man.");
});
