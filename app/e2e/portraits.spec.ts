import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * People show their approved portraits (ui/avatar.tsx): the same set and files as the Timeline,
 * app/scripts/timeline-portraits.json and public/people/<id>-<size>.webp. A person without one, or
 * whose file does not arrive, keeps the letter. The person data comes from the data origin, as in
 * telegram.spec.ts; only the Telegram script is stood in for.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const BOT_TOKEN = process.env.BOT_TOKEN ?? "123456:ABC-DEF";
const signed = () => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
};
const LAUNCH = signed();

const approved = JSON.parse(fs.readFileSync(new URL("../scripts/timeline-portraits.json", import.meta.url), "utf8")) as { ids: string[] };
/** The style anchor of the set, approved on 2026-10-01 (docs/AVATARS.md §4) and reused wherever he appears (§9). */
const ABRAHAM = "abraham-gen-11-26";

async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
}

test.beforeEach(async ({ page }) => setup(page));

test("every approved portrait id has its 128 and 256px file", () => {
  expect(approved.ids).toContain(ABRAHAM);
  for (const id of approved.ids) for (const size of [128, 256]) expect(fs.existsSync(new URL(`../public/people/${id}-${size}.webp`, import.meta.url)), `${id}-${size}.webp`).toBe(true);
});

test("a person's page shows the approved portrait, at the 128px size for a 48px avatar, and it loads", async ({ page }) => {
  await page.goto(`/person/${ABRAHAM}${LAUNCH}`);
  await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
  const img = page.locator(".entity__id .avatar img");
  await expect(img).toHaveAttribute("src", new RegExp(`/people/${ABRAHAM}-128\\.webp$`));
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth)).toBe(128);
  // Decorative: the name beside it is the accessible name (docs/AVATARS.md §8).
  await expect(img).toHaveAttribute("alt", "");
});

test("the People list shows the portrait on the row and the letter for everyone without one", async ({ page }) => {
  await page.goto(`/people${LAUNCH}`);
  await page.fill("#people-q", "abraham");
  const row = page.locator(`a[href="/person/${ABRAHAM}"]`).first();
  await expect(row.locator(".avatar img")).toHaveAttribute("src", new RegExp(`/people/${ABRAHAM}-128\\.webp$`));
  // Anyone on the list without an approved portrait keeps the first letter of the name.
  // Read them in one snapshot: the filtered list can still re-render, so a count and then a separate
  // wait on the first one can race (the row it counted is gone by the time it is awaited).
  const letters = await page.locator(".row .avatar:not(:has(img))").allTextContents();
  for (const l of letters) expect(l.trim()).toMatch(/^[A-Z?]$/);
});

test("a portrait file that does not arrive falls back to the letter, not a broken image", async ({ page }) => {
  await page.route(`**/people/${ABRAHAM}-128.webp`, (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto(`/person/${ABRAHAM}${LAUNCH}`);
  await expect(page.getByRole("heading", { level: 1, name: "Abraham" })).toBeVisible();
  const avatar = page.locator(".entity__id .avatar");
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar).toHaveText("A");
});
