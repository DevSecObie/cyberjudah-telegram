import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dsearch-field&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
async function setup(page: Page) {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}

for (const theme of ["light", "dark"]) test(`search empty: upstream layout and existing examples in ${theme}`, async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(theme => {
    (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: theme, preferredLightTheme: "default", preferredDarkTheme: "dark" }), recent: "[]" };
  }, theme);
  await page.route("**/api/search?**", r => r.fulfill({ json: { ok: true, counts: {}, hits: [] } }));
  await page.route("**/api/teachings?**", r => r.fulfill({ json: { ok: true, hits: [], more: false } }));
  await page.route("**/api/search/answer?**", r => r.fulfill({ status: 503, json: { ok: false } }));
  await page.goto(`/search${LAUNCH}`);
  const empty = page.locator(".srch__empty"), examples = empty.locator(".srch__try");
  await expect(empty).toBeVisible();
  expect((await empty.boundingBox())!.height).toBeCloseTo(844 * .6, 0);
  await expect(empty).toHaveCSS("justify-content", "center");
  await expect(empty.locator("svg")).toHaveAttribute("width", "80");
  await expect(empty.locator("svg")).toHaveAttribute("height", "80");
  await expect(empty.locator("svg")).toHaveCSS("opacity", "0.6");
  await expect(empty.locator("p")).toHaveCSS("font-size", "16px");
  const color = await empty.evaluate(el => getComputedStyle(el).color);
  await expect(empty.locator("p")).toHaveCSS("color", color);
  await expect(empty.locator("svg")).toHaveCSS("color", color);
  await expect(examples).toHaveCSS("max-width", "320px");
  const queries = ["Passover", "Melchizedek", "Matthew 15:24", '"most high"', "twelve tribes", "usury"];
  await expect(examples.getByRole("button")).toHaveText(queries);
  for (const query of queries) {
    await expect(examples.getByRole("button", { name: query, exact: true })).toHaveCSS("height", "27px");
    await examples.getByRole("button", { name: query, exact: true }).click();
    await expect(page).toHaveURL(url => url.searchParams.get("q") === query);
    await expect(page.getByRole("searchbox", { name: "Search CyberJudah" })).toHaveValue(query);
    await page.getByRole("button", { name: "Clear the search", exact: true }).click();
    await expect(examples).toBeVisible();
  }
});

test("search field: Bible Strong's 36 px grey pill, 15 px text, a ✕ in 36 px while there is text", async ({ page }) => {
  await setup(page);
  await page.goto(`/people${LAUNCH}`);
  const field = page.getByRole("searchbox", { name: "A name: Abraham, Jezebel, Onesimus" });
  await expect(field).toBeVisible();
  const pill = page.locator("form.bs-searchinput");
  await expect(pill).toHaveCSS("height", "36px");
  await expect(pill).toHaveCSS("background-color", "rgba(0, 0, 0, 0.1)");
  await expect(pill).toHaveCSS("padding-left", "8px");
  await expect(pill).toHaveCSS("margin-bottom", "5px");
  expect(await pill.evaluate(el => parseFloat(getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(18);
  await expect(field).toHaveCSS("font-size", "15px");
  await expect(pill.locator("svg").first()).toHaveAttribute("width", "20");
  const clear = page.getByRole("button", { name: "Clear", exact: true });
  await expect(clear).toHaveCount(0);
  await field.fill("Abraham");
  await expect(clear).toBeVisible();
  const box = (await clear.boundingBox())!;
  expect(box.width).toBe(36); expect(box.height).toBe(36);
  await clear.click();
  await expect(field).toHaveValue("");
  await expect(clear).toHaveCount(0);
});

for (const theme of ["default", "dark"]) {
  test(`list search headers: ${theme} places the pill above the border with the focus ring around it`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(theme => {
      (window as any).__cloud = { bs: JSON.stringify({ preferredColorScheme: theme === "dark" ? "dark" : "light", preferredLightTheme: "default", preferredDarkTheme: "dark" }) };
    }, theme);
    for (const path of ["/lexicon", "/dictionary", "/topics"]) {
      await page.goto(`${path}${LAUNCH}`);
      const head = page.locator(".screen > header");
      const pill = head.locator(".bs-searchinput");
      await expect(pill).toBeVisible();
      const box = (await pill.boundingBox())!;
      expect(box.y).toBe(54);
      expect(box.height).toBe(36);
      expect(box.x).toBe(20);
      expect(box.width).toBe(350);
      await expect(head).toHaveCSS("border-bottom-width", "1px");
      expect((await head.boundingBox())!.height).toBe(106);
      const input = pill.getByRole("searchbox");
      await input.focus();
      await expect(input).toBeFocused();
      await expect(input).toHaveCSS("outline-style", "none");
      const primary = await pill.evaluate(el => getComputedStyle(el).getPropertyValue("--bs-primary").trim());
      const hex = primary.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
      const color = hex ? `rgb(${hex.slice(1).map(n => parseInt(n, 16)).join(", ")})` : primary;
      await expect(pill).toHaveCSS("box-shadow", `${color} 0px 0px 0px 2px`);
      await input.fill("Abraham");
      const clear = pill.getByRole("button", { name: "Clear", exact: true });
      await clear.focus();
      await expect(pill).toHaveCSS("box-shadow", "none");
      await clear.click();
      await expect(input).toHaveValue("");
      await expect(clear).toHaveCount(0);
    }
  });
}

test("list search headers: forced-colors retains the outer focus outline", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ forcedColors: "active" });
  for (const path of ["/lexicon", "/dictionary", "/topics"]) {
    await page.goto(`${path}${LAUNCH}`);
    const pill = page.locator(".screen > header .bs-searchinput");
    const input = pill.getByRole("searchbox");
    await input.focus();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(pill).toHaveCSS("box-shadow", "none");
    await expect(pill).toHaveCSS("outline-style", "solid");
    await expect(pill).toHaveCSS("outline-width", "2px");
    await expect(pill).toHaveCSS("outline-offset", "2px");
  }
});

test("Search header: the shared pill preserves class, note and scripture queries and results", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: URL[] = [];
  await page.route("**/api/search?**", r => {
    requests.push(new URL(r.request().url()));
    return r.fulfill({ json: { ok: true, counts: { class: 1, study: 1, verse: 1 }, hits: [
      { kind: "class", title: "Passover class", url: "/notes/passover", snippet: "Passover was taught in class." },
      { kind: "study", title: "Passover study note", url: "/study/passover", snippet: "A note about Passover." },
      { kind: "verse", title: "Exodus 12:11", url: "/bible/exodus/12#v11", snippet: "It is the LORD's passover." },
    ] } });
  });
  await page.route("**/api/teachings?**", r => r.fulfill({ json: { ok: true, hits: [], more: false } }));
  await page.route("**/api/search/answer?**", r => r.fulfill({ status: 503, json: { ok: false } }));
  await page.goto(`/search${LAUNCH}`);
  const header = page.locator(".screen > header"), pill = header.locator(".bs-searchinput");
  const field = pill.getByRole("searchbox", { name: "Search CyberJudah" });
  await expect(field).toBeFocused();
  await expect(pill).toHaveCSS("height", "36px");
  expect((await pill.boundingBox())!.y).toBe(54);
  await expect(header).toHaveCSS("border-bottom-width", "1px");
  await expect(page.locator(".srch__bar--dock")).toHaveCount(0);
  await field.fill("Passover");
  const classResult = page.locator(".srch__hit").filter({ hasText: "Passover class" });
  await expect(classResult).toBeVisible();
  await expect.poll(() => requests.some(u => u.searchParams.get("q") === "Passover" && u.searchParams.get("limit") === "40" && u.searchParams.get("live") === "1")).toBe(true);
  await field.press("Enter");
  await expect(page).toHaveURL(u => u.searchParams.get("q") === "Passover");
  await expect.poll(() => requests.some(u => u.searchParams.get("q") === "Passover" && u.searchParams.get("limit") === "40" && !u.searchParams.has("live"))).toBe(true);
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await field.press("ArrowDown");
  await expect(classResult).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(field).toBeFocused();
  await page.getByRole("tab", { name: /^Notes/ }).click();
  await expect(classResult).toBeVisible();
  await expect(page.locator(".srch__hit").filter({ hasText: "Passover study note" })).toBeVisible();
  await expect(page.locator(".srch__hit").filter({ hasText: "Exodus 12:11" })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Scripture/ }).click();
  await expect(page.locator(".srch__hit").filter({ hasText: "Exodus 12:11" })).toBeVisible();
  await expect(classResult).toHaveCount(0);
  await pill.getByRole("button", { name: "Clear the search", exact: true }).click();
  await expect(field).toHaveValue("");
  await expect(field).toBeFocused();
});
