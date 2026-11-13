import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const LAUNCH = "#tgWebAppData=query_id%3Dsearch-provider&tgWebAppVersion=9.1&tgWebAppPlatform=ios";
async function setup(page: Page, fail = false, provider = "Google") {
  await page.addInitScript(() => { (window as unknown as { __noConsent: boolean }).__noConsent = true; });
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, r => r.abort());
  await page.route("**/api/search?**", r => r.fulfill({ json: { ok: true, counts: { verse: 1 }, hits: [
    { kind: "verse", title: "Genesis 14:18", url: "/bible/genesis/14#v18", snippet: "Melchizedek king of Salem" },
  ] } }));
  await page.route("**/api/teachings?**", r => r.fulfill({ json: { ok: true, hits: [], more: false } }));
  const requests: string[] = [], answered: string[] = [];
  await page.route("**/api/search/answer?**", async r => {
    const consent = r.request().headers()["x-ai-consent"] ?? "";
    requests.push(consent);
    if (!consent.split(",").includes(provider)) return r.fulfill({ status: 428, json: { ok: false, error: "consent", provider } });
    answered.push(new URL(r.request().url()).searchParams.get("q") ?? "");
    if (fail) return r.fulfill({ status: 503, json: { ok: false, error: "unavailable" } });
    return r.fulfill({ json: { ok: true, provider, model: provider === "Google" ? "google/gemini-2.5-flash-lite" : "@cf/meta/llama-3.1-8b-instruct-fp8", answer: "Melchizedek was king of Salem [1].", sources: [
      { n: 1, kind: "verse", title: "Genesis 14:18", url: "/bible/genesis/14#v18", text: "And Melchizedek king of Salem brought forth bread and wine." },
    ] } });
  });
  return { requests, answered };
}
const navigate = (page: Page, to: string) => page.evaluate(to => {
  history.pushState({ idx: (history.state?.idx ?? 0) + 1 }, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}, to);

test("search provider: consent, a free cited answer and withdrawal apply to a previously cached question", async ({ page }) => {
  const { requests, answered } = await setup(page);
  await page.goto(`/search?q=Melchizedek${LAUNCH}`);
  await expect(page.getByRole("button", { name: "Agree and answer" })).toBeVisible();
  await expect(page.locator(".srch__hit").first()).toBeVisible();
  expect(answered).toEqual([]);
  expect(requests).toEqual([""]);
  await page.getByRole("button", { name: "Agree and answer" }).click();
  const answer = page.getByRole("region", { name: "AI answer" });
  await expect(answer.locator(".msg__text")).toContainText("king of Salem");
  await expect(answer).toContainText("Google · free");
  await expect(answer.locator("button.cite")).toHaveText("1");
  await expect(answer.locator(".srccard")).toContainText("Genesis 14:18");
  expect(answered).toEqual(["Melchizedek"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cj:ai-consent")!))).toContain("Google");
  await navigate(page, "/privacy");
  await page.getByText("Withdraw AI agreement", { exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Ask and Search will ask");
  await navigate(page, "/search?q=Melchizedek");
  await expect(page.getByRole("button", { name: "Agree and answer" })).toBeVisible();
  await expect(page.locator(".srch__ai .msg__text")).toHaveCount(0);
  expect(answered, "withdrawal must not send another model request").toEqual(["Melchizedek"]);
  await expect(page.locator(".srch__hit").first()).toBeVisible();
});

test("search provider: declining leaves ordinary results and sends no provider request", async ({ page }) => {
  const { answered } = await setup(page);
  await page.goto(`/search?q=Melchizedek${LAUNCH}`);
  await page.getByRole("button", { name: "Just show results" }).click();
  await expect(page.locator(".srch__ai")).toHaveCount(0);
  await expect(page.locator(".srch__hit").first()).toBeVisible();
  expect(answered).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("cj:ai-consent"))).toBeNull();
});

test("search provider: provider failure preserves keyword results", async ({ page }) => {
  await setup(page, true);
  await page.goto(`/search?q=Melchizedek${LAUNCH}`);
  await page.getByRole("button", { name: "Agree and answer" }).click();
  await expect(page.locator(".srch__ai")).toHaveCount(0);
  await expect(page.locator(".srch__hit").first()).toBeVisible();
});

test("search provider: a hosted Cloudflare model is asked for by name, and only that agreement is sent", async ({ page }) => {
  const provider = "Cloudflare (Workers AI)";
  const { requests, answered } = await setup(page, false, provider);
  await page.goto(`/search?q=Melchizedek${LAUNCH}`);
  await expect(page.locator("#search-consent-title")).toHaveText(`Let ${provider} answer from the library?`);
  await expect(page.locator(".srch__ai .consent")).toContainText(`will be sent to ${provider}.`);
  expect(answered).toEqual([]);
  await page.getByRole("button", { name: "Agree and answer" }).click();
  await expect(page.getByRole("region", { name: "AI answer" }).locator(".msg__text")).toContainText("king of Salem");
  expect(answered).toEqual(["Melchizedek"]);
  expect(requests.at(-1)).toBe(provider);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cj:ai-consent")!))).toEqual([provider]);
});
