import { expect, test, type Page } from "@playwright/test";
import fixture from "../tests/fixtures/doctrine.json" with { type: "json" };

async function setup(page: Page, status = 200) {
  let responseStatus = status;
  let requests = 0;
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route(`${process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io"}/**`, r => {
    const path = new URL(r.request().url()).pathname;
    if (!path.startsWith("/api/doctrine/")) return r.fulfill({ status: 404 });
    requests++;
    if (responseStatus !== 200) return r.fulfill({ status: responseStatus });
    return r.fulfill({ json: path.endsWith("/index.json") ? [
      { slug: "zulu-fixture", name: "Zulu fixture", claim: "", refs: 0, scriptures: 0, books: 0, url: "/doctrine/zulu-fixture" },
      { slug: fixture.slug, name: fixture.name, claim: fixture.claim, refs: 2, scriptures: fixture.scriptures.length, books: fixture.books.length, url: fixture.url },
    ] : fixture });
  });
  return { publish: () => { responseStatus = 200; }, requests: () => requests };
}

test("False Doctrines opens from More, searches A–Z and renders the fixture with scripture, moments, related chips and share", async ({ page }) => {
  await setup(page);
  await page.goto("/more");
  await page.getByRole("link", { name: /False Doctrines False doctrines answered from scripture and the classes/ }).click();
  await expect(page.getByRole("heading", { name: "False Doctrines", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: fixture.name, exact: true })).toBeVisible();
  const search = page.getByPlaceholder("Search by word");
  await search.fill("zulu");
  await expect(page.getByRole("link", { name: "Zulu fixture", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: fixture.name, exact: true })).toHaveCount(0);
  await search.fill("fixture");
  await expect(page.locator(".bs-dictitem")).toHaveText([fixture.name, "Zulu fixture"]);
  await page.getByRole("link", { name: fixture.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
  await expect(page.getByText(fixture.claim, { exact: true })).toBeVisible();
  for (const ref of fixture.answers[0].refs) {
    await expect(page.getByRole("link", { name: ref.label, exact: true }).first()).toHaveAttribute("href", `/read/${ref.slug}/${ref.chapter}?v=${ref.verses}`);
    await expect(page.locator(".verse-quote").filter({ hasText: ref.text[0].text }).first()).toBeVisible();
  }
  for (const s of fixture.answers[0].sense) await expect(page.locator("blockquote").filter({ hasText: s.text })).toHaveText(s.text);
  await expect(page.getByRole("link", { name: "Watch at 1:05", exact: true })).toHaveAttribute("href", "/note/classes/2026/fixture?t=65");
  await expect(page.getByRole("link", { name: "Watch at 0:00", exact: true })).toHaveAttribute("href", "/watch/fixture0002?t=0");
  const scriptures = page.locator("section").filter({ has: page.getByRole("heading", { name: "Scriptures against it", exact: true }) }).last();
  await expect(scriptures.locator(".lawrow")).toHaveCount(fixture.scriptures.length);
  await expect(scriptures.locator("li")).toHaveCount(2);
  await expect(scriptures.getByRole("link", { name: "Job 3:17", exact: true })).toHaveAttribute("href", "/read/job/3?v=17");
  await expect(scriptures.locator("li p")).toHaveJSProperty("textContent", fixture.scriptures[0].points[0].text);
  await expect(scriptures.locator("li .hint")).toHaveText("Fixture explanation class Watch at 13:41");
  await expect(scriptures.getByText("Read in Fixture reading class", { exact: false })).toBeVisible();
  await expect(scriptures.getByRole("link", { name: "Watch at 13:41", exact: true })).toHaveAttribute("href", "/note/classes/2026/fixture-scripture?t=821");
  await expect(scriptures.getByRole("link", { name: "Watch at 1:02:05", exact: true })).toHaveAttribute("href", "/watch/fixture0004?t=3725");
  const books = page.locator("section").filter({ has: page.getByRole("heading", { name: "Books against it", exact: true }) }).last();
  await expect(books.locator(".lawrow")).toHaveCount(2);
  await expect(books.getByRole("link", { name: "Fixture library book", exact: true })).toHaveAttribute("href", "/books/fixture-book");
  await expect(books.getByText("Fixture book author · 1871", { exact: true })).toBeVisible();
  await expect(books.getByRole("link", { name: "p. 93", exact: true })).toHaveAttribute("href", "/books/fixture-book/p/1-93");
  await expect(books.getByRole("link", { name: "vol. 2, p. 140", exact: true })).toHaveAttribute("href", "/books/fixture-book/p/2-140");
  await expect(books.getByText("· read in 8 classes", { exact: true })).toBeVisible();
  await expect(books.getByRole("link", { name: "Watch at 47:42", exact: true })).toHaveAttribute("href", "/note/classes/2026/fixture-book?t=2862");
  await expect(books.getByRole("heading", { name: "Fixture cited book", exact: true })).toBeVisible();
  await expect(books.getByRole("link", { name: "Fixture cited book", exact: true })).toHaveCount(0);
  await expect(books.locator("blockquote").filter({ hasText: fixture.books[1].said!.text })).toHaveJSProperty("textContent", fixture.books[1].said!.text);
  await expect(books.getByRole("link", { name: "Watch at 1:15:20", exact: true })).toHaveAttribute("href", "/watch/fixture0006?t=4520");
  await expect(books.getByRole("link", { name: "Job 3:17", exact: true })).toHaveAttribute("href", "/read/job/3#v17");
  for (const kind of ["precepts", "cases", "topics"] as const) await expect(page.locator(`a.chip[href="${fixture.related[kind][0].url}"]`)).toBeVisible();
  await page.getByRole("button", { name: "More options", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share the link", exact: true })).toBeVisible();
});

for (const path of ["/doctrine", fixture.url]) test(`unpublished Doctrine has Empty and Retry at ${path}`, async ({ page }) => {
  const feed = await setup(page, 404);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "False Doctrines", exact: true })).toBeVisible();
  await expect(page.getByText("The false doctrines section is not published yet", { exact: true })).toBeVisible();
  const before = feed.requests(); feed.publish();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(feed.requests).toBeGreaterThan(before);
  if (path === "/doctrine") await expect(page.getByRole("link", { name: fixture.name, exact: true })).toBeVisible();
  else await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
});

test("a connection failure is not described as unpublished Doctrine", async ({ page }) => {
  await setup(page, 503); await page.goto("/doctrine");
  await expect(page.getByText(/^The false doctrines did not load/)).toBeVisible();
  await expect(page.getByText("The false doctrines section is not published yet", { exact: true })).toHaveCount(0);
});
