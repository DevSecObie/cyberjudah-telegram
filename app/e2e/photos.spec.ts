import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Photos an admin sets in the app (ui/photo-edit.tsx, bot/src/photos.ts): an admin changes a
 * leader's portrait from the Timeline, every reader sees it, a reader cannot change it, and
 * Remove photo brings the app's own back. Against the local Worker and its R2 and KV.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN = 100000002, READER = 700000000 + crypto.randomInt(1e8);
const initData = (id: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const shotTo = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/photos/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/photos/${name}.png`, import.meta.url).pathname });
};
const launch = (id: number) => `#tgWebAppData=${encodeURIComponent(initData(id))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;

test.use({ viewport: { width: 390, height: 844 } });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
}

test("an admin changes a leader's portrait in the app; every reader sees it; Remove photo restores the app's own", async ({ page, browser, request }) => {
  await setup(page);
  await page.goto(`/timeline/event/iuic-founded-2003${launch(ADMIN)}`);
  const pic = page.locator("img.tl-event__pic");
  await expect(pic).toHaveAttribute("src", /timeline\/leaders\/bishop-nathanyel-256\.webp$/);
  // A photo to upload: any image the phone has (here, a screenshot).
  await shotTo(page, "1-button");
  const shot = await page.screenshot();
  await page.getByRole("button", { name: "Change photo" }).click();
  // The picker is the hidden file input next to the button.
  await page.locator(".photo-edit input[type=file]").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: shot });
  const sheet = page.getByRole("dialog", { name: "Leader's portrait" });
  await expect(sheet.locator(".photo-frame img")).toBeVisible();
  await sheet.getByRole("slider", { name: "Zoom" }).fill("1.5");
  await page.waitForTimeout(400);
  await shotTo(page, "2-framing");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(pic).toHaveAttribute("src", /^\/api\/photos\/file\/photos\/leader\/bishop-nathanyel\/\d{13}\.jpg$/);
  // The file is a JPEG of the frame's size, served to anyone.
  const src = (await pic.getAttribute("src"))!;
  const file = await request.get(src);
  expect(file.headers()["content-type"]).toBe("image/jpeg");
  expect((await file.body()).subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

  // A reader sees the new portrait (on the event and on the Timeline bar), with no button to change it.
  const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await setup(other);
  await other.goto(`/timeline/event/iuic-founded-2003${launch(READER)}`);
  await expect(other.locator("img.tl-event__pic")).toHaveAttribute("src", src);
  await expect(other.getByRole("button", { name: /Change photo|Add photo/ })).toHaveCount(0);
  // The server refuses a reader, and anything that is not an image.
  const refused = await other.request.put("/api/admin/photos?slot=leader:bishop-nathanyel", { headers: { authorization: `tma ${initData(READER)}`, "content-type": "image/jpeg" }, data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
  expect(refused.status()).toBe(403);
  const notImage = await request.put("/api/admin/photos?slot=leader:bishop-nathanyel", { headers: { authorization: `tma ${initData(ADMIN)}`, "content-type": "image/svg+xml" }, data: "<svg onload=alert(1)>" });
  expect(notImage.status()).toBe(415);
  await other.close();

  // Remove photo: the app's own portrait again.
  await page.getByRole("button", { name: "Change photo" }).click();
  await page.locator(".photo-edit input[type=file]").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: shot });
  await page.getByRole("dialog", { name: "Leader's portrait" }).getByRole("button", { name: "Remove photo" }).click();
  await expect(pic).toHaveAttribute("src", /timeline\/leaders\/bishop-nathanyel-256\.webp$/);
  expect((await request.get(src)).status()).toBe(404);
});
