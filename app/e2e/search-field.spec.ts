import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dsearch-field&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
async function setup(page: Page) {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
}

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
