import { test, expect, type Page } from "@playwright/test";
import { LAUNCH, setup } from "./telegram-harness";

const hide = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
});

test("a visit sends its speed once it is hidden, with its screen area and no launch data or ID", async ({ page }) => {
  await setup(page);
  const beacons: { body: string; auth?: string }[] = [];
  await page.route("**/api/vitals", async (r) => {
    beacons.push({ body: r.request().postData() ?? "", auth: r.request().headers()["authorization"] });
    await r.fulfill({ status: 204 });
  });
  await page.goto("/app/read/genesis/1" + LAUNCH);
  await expect(page.locator("#verset-1")).toContainText("In the beginning");
  await page.locator("#verset-1").click();
  await hide(page);
  await expect.poll(() => beacons.length).toBe(1);
  const report = JSON.parse(beacons[0].body);
  expect(report).toMatchObject({ area: "read", platform: "telegram", nav: "navigate" });
  expect(Object.keys(report.metrics)).toEqual(expect.arrayContaining(["TTFB", "FCP", "LCP"]));
  expect(beacons[0].auth).toBeUndefined();
  expect(beacons[0].body).not.toMatch(/genesis|query_id|auth_date|hash|first_name/);
  // Hidden again: nothing already sent goes twice.
  await hide(page);
  await page.waitForTimeout(500);
  const names = beacons.flatMap((b) => Object.keys(JSON.parse(b.body).metrics));
  expect(new Set(names).size).toBe(names.length);
});

test("the Worker takes a speed report and refuses anything else", async ({ request }) => {
  const post = (data: string) => request.post("/api/vitals", { data, headers: { "content-type": "text/plain" } });
  const report = { area: "home", platform: "web", nav: "reload", metrics: { LCP: 1200, CLS: 0.01 } };
  expect((await post(JSON.stringify(report))).status()).toBe(204);
  expect((await post(JSON.stringify({ ...report, area: "read/genesis/1" }))).status()).toBe(400);
  expect((await post("not json")).status()).toBe(400);
  expect((await post(JSON.stringify({ ...report, pad: "x".repeat(3000) }))).status()).toBe(400);
});
