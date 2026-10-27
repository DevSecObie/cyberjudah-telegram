import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { keyedHash, pid, seal } from "../../bot/src/privacy.mjs";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "local encrypted sessions and fake model only");
// Navigation cancels old-page requests. Once every account-isolation assertion has run,
// discard only pending fixture callbacks so teardown cannot fulfill an aborted route.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "ignoreErrors" }); });
const env = { PRIVACY_KEY: "e2e-privacy-key-not-secret" };
async function session(id: number) {
  const token = crypto.randomBytes(32).toString("hex"), owner = await pid(env, id), created = Math.floor(Date.now() / 1000);
  const hash = await keyedHash(env, "browser-session", token), data = await seal(env, owner, { user: { id, first_name: "Browser reader" }, created });
  const sql = `CREATE TABLE IF NOT EXISTS browser_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL); INSERT INTO browser_sessions VALUES ('${hash}', '${owner}', '${data}', ${created + 3600});`;
  execFileSync("npx", ["wrangler", "d1", "execute", "cyberjudah-telegram", "--local", "--persist-to", ".wrangler/e2e", "--command", sql], { cwd: new URL("../../bot", import.meta.url), stdio: "pipe" });
  return token;
}
function admin() {
  const p = { user: JSON.stringify({ id: 100000002, first_name: "Admin" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN!).digest();
  return new URLSearchParams({ ...p, hash: crypto.createHmac("sha256", secret).update(Object.keys(p).sort().map(k => `${k}=${p[k as keyof typeof p]}`).join("\n")).digest("hex") }).toString();
}
async function browserOnly(page: Page) {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: "" }));
  // This account test does not depend on the live Scripture CDN.
  await page.route(`${process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io"}/**`, r =>
    new URL(r.request().url()).pathname === "/api/kjv/books.json"
      ? r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, chapterIds: [1] }] })
      : r.fulfill({ status: 404, body: "" }));
  await page.addInitScript(() => {
    localStorage.setItem("cj:ai-consent", '["Anthropic"]');
    localStorage.setItem("cj:ai-limits", JSON.stringify({ "anthropic/claude-sonnet-5": 2_000_000, "anthropic/claude-opus-5": 2_000_000 }));
  });
}
test("browser sign-in enables Ask with cookie auth and keeps chats isolated after logout/account changes", async ({ page, request, baseURL }) => {
  await browserOnly(page);
  const first = crypto.randomInt(300000000, 600000000), second = first + 1;
  let token = await session(first);
  // Preserve production Secure-cookie settings: the local HTTP fixture forwards the cookie to
  // the real Worker. No Telegram launch identity is injected into the browser.
  await page.route(url => url.origin === new URL(baseURL!).origin && url.pathname.startsWith("/api/"), async r => {
    if (r.request().url().includes("/api/ask") && r.request().method() === "POST") expect(r.request().headers().authorization).toBeUndefined();
    const response = await r.fetch({ headers: { ...r.request().headers(), cookie: `__Host-cj-session=${token}`, origin: new URL(r.request().url()).origin } });
    // This fixture supplies the cookie itself; do not let a Secure __Host deletion over
    // local HTTP mutate WebKit's cookie/storage partition. Server revocation is still exercised.
    const headers = response.headers(); delete headers["set-cookie"];
    await r.fulfill({ response, headers });
  });
  const funding = await request.post("/api/admin/adjust", { headers: { authorization: `tma ${admin()}` }, data: { user: first, usd: 5, ref: "browser-fixture", note: "local fake credits" } });
  expect(funding.ok()).toBeTruthy();
  await page.goto("/ask");
  const question = page.getByRole("textbox", { name: "Your question" });
  await expect(question).toBeEnabled();
  await question.fill("How do I get a reminder to read?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Provider permission remains mandatory, including for a signed-in browser.
  const agree = page.getByRole("button", { name: /Agree.*continue|Allow.*continue|Agree and/ });
  if (await agree.isVisible().catch(() => false)) await agree.click();
  await expect(page.locator(".msg--ai").last().getByRole("link", { name: "Reading reminders" })).toBeVisible();
  await page.getByRole("button", { name: "Your chats", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your chats" })).toContainText("How do I get a reminder to read?");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(id => localStorage.getItem(`cj:ask:${id}`), first)).toContain("How do I");
  expect(await page.evaluate(() => localStorage.getItem("cj:ask:guest"))).toBeNull();
  await page.goto("/settings/account");
  expect(await page.evaluate(id => localStorage.getItem(`cj:ask:${id}`), first), "survives Account navigation").toContain("How do I");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in with Telegram" })).toBeVisible();
  expect(await page.evaluate(id => localStorage.getItem(`cj:ask:${id}`), first)).toContain("How do I");
  await page.goto("/ask");
  await expect(question).toBeDisabled();
  await expect(page.locator(".msg--me")).toHaveCount(0);
  token = await session(second);
  // A sign-in callback returns via navigation. Exercise that path for each account;
  // WebKit's reload can stall while cancelling the prior page's module preloads.
  await page.goto("/ask?signin=second");
  await expect(question).toBeEnabled();
  await expect(page.locator(".msg--me")).toHaveCount(0);
  // Re-entering the first account restores only that reader's own conversation.
  expect(await page.evaluate(id => localStorage.getItem(`cj:ask:${id}`), first)).toContain("How do I");
  token = await session(first);
  await page.goto("/ask?signin=first");
  expect(await page.evaluate(id => localStorage.getItem(`cj:ask:${id}`), first)).toContain("How do I");
  await expect(page.locator(".msg--me")).toContainText("How do I get a reminder to read?");
});

test("an anonymous browser cannot submit a prefilled question", async ({ page }) => {
  await browserOnly(page);
  let sent = 0;
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/ask" && r.method() === "POST") sent++; });
  await page.goto("/ask?q=Who%20is%20Moses");
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  expect(sent).toBe(0);
});
