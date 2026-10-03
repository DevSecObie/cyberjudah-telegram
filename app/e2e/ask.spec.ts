import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";
import type { ClaudeRequest } from "./claude";
import { pid } from "../../bot/src/privacy.mjs";

/**
 * Ask CyberJudah as the app's assistant, at 390×844, against the real local Worker: its own
 * sign-in check, its agent loop and tools, its storage of chats and reminders. Only the model is
 * stood in for (e2e/claude.ts, a scripted Messages API), so what the reader sees is what the
 * Worker's tools returned. Set REVIEW_SHOTS=1 to write the screenshots to e2e/review/ask.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN!;
const RUN = 300000 + crypto.randomInt(1e9);
const initData = (n: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: RUN + n, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
};
const launch = (n: number) => `#tgWebAppData=${encodeURIComponent(initData(n))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;

test.use({ viewport: { width: 390, height: 844 } });
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/ask/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/ask/${name}.png`, import.meta.url).pathname });
};
async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
}
const ask = async (page: Page, q: string) => {
  await page.getByRole("textbox", { name: "Your question" }).fill(q);
  await page.getByRole("button", { name: "Send" }).click();
};
const answer = (page: Page) => page.locator(".msg--ai").last();
/** What the Worker asked the model, newest last. */
const modelCalls = async (request: APIRequestContext, since: number) => ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= since && e.path === "/anthropic/v1/messages").map((e) => e.body as ClaudeRequest);
const reminderOf = async (request: APIRequestContext, n: number) => (await request.get("/api/reminders?tz=UTC", { headers: { authorization: `tma ${initData(n)}` } })).json();

test("an app question is answered from the app's own list of screens, with a link that opens in place", async ({ page, request }) => {
  await setup(page);
  const t0 = Date.now();
  await page.goto(`/ask${launch(1)}`);
  await ask(page, "How do I get a reminder to read?");
  const a = answer(page);
  await expect(a.getByRole("link", { name: "Reading reminders" })).toHaveAttribute("href", "/settings/reminders");
  await expect(a.locator(".research")).toContainText("Researched");
  await shot(page, "1-app-question");
  // The research loop as the Claude docs advise: cached instructions and tools, streamed tool input.
  const calls = await modelCalls(request, t0);
  expect(calls.length).toBe(2);
  for (const c of calls) {
    expect(c.system?.[0].cache_control).toEqual({ type: "ephemeral" });
    expect(c.cache_control).toEqual({ type: "ephemeral" });
    expect(c.tools?.every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(c.tools?.map((t) => t.name)).toEqual(["search_library", "app_help", "find_in_app", "my_saved_chats", "my_reminder", "propose_reminder_change", "read_scripture"]);
  }
  // The tool result the model was given is the Worker's own feature list.
  const result = JSON.stringify(calls[1].messages.at(-1));
  expect(result).toContain("Reading reminders: Turn a daily reading reminder on or off");
  await a.getByRole("link", { name: "Reading reminders" }).click();
  await expect(page).toHaveURL(/\/settings\/reminders$/);
  await expect(page.getByRole("heading", { name: "Reading reminders" })).toBeVisible();
});

test("a reminder change is only proposed: nothing changes until Confirm, which saves it with the reader's own sign-in", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/ask${launch(2)}`);
  await ask(page, "Remind me to read every morning");
  const card = answer(page).locator(".actioncard");
  await expect(card).toContainText("Turn reading reminders on, by Telegram at 6:30.");
  await expect(card).toContainText("Not done yet. It happens only if you confirm.");
  await expect(answer(page)).toContainText("It happens only when you tap Confirm.");
  await shot(page, "2-proposed");
  // Proposed is not done: the Worker's record is untouched.
  expect((await reminderOf(request, 2)).on).toBe(false);
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card).toContainText("Reminders are on, every day at 6:30 by Telegram.");
  const v = await reminderOf(request, 2);
  expect([v.on, v.hour, v.minute, v.channels.telegram]).toEqual([true, 6, 30, true]);
  await shot(page, "3-confirmed");
  // Restored after a reload, and from the saved chat on the server.
  await page.reload();
  await expect(answer(page).locator(".actioncard")).toHaveAttribute("data-state", "applied");
  await page.getByRole("button", { name: "Your chats" }).click();
  await page.locator(".chats__open").first().click();
  await expect(answer(page).locator(".actioncard")).toHaveAttribute("data-state", "applied");
});

test("Cancel leaves the reminder as it was", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/ask${launch(3)}`);
  await ask(page, "Please remind me to read");
  const card = answer(page).locator(".actioncard");
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card).toContainText("Cancelled. Nothing was changed.");
  expect((await reminderOf(request, 3)).on).toBe(false);
});

test("the reader's own saved chats are found and reopened by link; another reader's are not reachable", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/ask${launch(4)}`);
  await ask(page, "Why keep the Passover?");
  await expect(answer(page)).toContainText("A short answer to: Why keep the Passover?");
  await page.getByRole("button", { name: "New chat" }).click();
  await ask(page, "What are my saved chats?");
  const link = answer(page).getByRole("link", { name: "Why keep the Passover?" });
  await expect(link).toHaveAttribute("href", /^\/ask\?chat=[a-z0-9]{8,40}$/);
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page.locator(".msg--me").first()).toHaveText("Why keep the Passover?");
  // The same link, signed in as someone else, finds nothing.
  const other = await request.get(`/api/chats/${href!.split("=")[1]}`, { headers: { authorization: `tma ${initData(5)}` } });
  expect(other.status()).toBe(404);
});

test("links in an answer go only inside the app; anything else is shown as text", async ({ page }) => {
  await setup(page);
  await page.goto(`/ask${launch(6)}`);
  await ask(page, "Show me something dangerous");
  const a = answer(page);
  await expect(a.getByRole("link", { name: "Reading reminders" })).toHaveAttribute("href", "/settings/reminders");
  await expect(a.locator(".msg__text")).toContainText("See this or that or Reading reminders.");
  expect(await a.locator("a[href^='javascript'], a[href*='evil.example']").count()).toBe(0);
});

test("a refusal is said plainly and is not shown as an answer", async ({ page }) => {
  await setup(page);
  await page.goto(`/ask${launch(7)}`);
  await ask(page, "Please refuse this");
  await expect(answer(page)).toContainText("CyberJudah can't answer that one. Ask about the Scripture, the teachings or the app.");
});

test("leaving mid-answer: the server finishes and saves it, and the app waits for it and shows it", async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.goto(`/ask${launch(8)}`);
  await ask(page, "Answer this slowly");
  await expect(answer(page).locator(".msg__thinking")).toBeVisible();
  // While it is answering, a typed question stays in the composer instead of being lost.
  await page.getByRole("textbox", { name: "Your question" }).fill("And then?");
  await page.getByRole("textbox", { name: "Your question" }).press("Enter");
  await expect(page.getByRole("textbox", { name: "Your question" })).toHaveValue("And then?");
  // The app is closed and opened again mid-answer.
  await page.reload();
  await expect(answer(page)).toContainText("Still answering");
  await shot(page, "4-still-answering");
  await expect(answer(page)).toContainText("A short answer to: Answer this slowly", { timeout: 30_000 });
  await expect(answer(page)).not.toContainText("interrupted");
});

test("the conversation is kept per account on this device", async ({ page }) => {
  await setup(page);
  await page.goto(`/ask${launch(9)}`);
  await ask(page, "Who are the twelve tribes?");
  await expect(answer(page)).toContainText("A short answer to");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cj:ask")));
  expect(keys).toEqual([`cj:ask:${RUN + 9}`]);
});

test("Claude overloaded: Ask turns to the backup model, and with nothing to answer from says Claude is busy, not that the library is empty", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page);
  const t0 = Date.now();
  await page.goto(`/ask${launch(10)}`);
  await ask(page, "Is the main model overloaded?");
  const a = answer(page);
  // The Worker tried Claude (with the SDK's own retries) and then went to the backup.
  await expect.poll(async () => (await modelCalls(request, t0)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  // The local Worker has no Workers AI (its binding runs only on Cloudflare) and no search index,
  // so the backup has no passages here: it must say Claude is busy, not that the library is empty.
  await expect(a.locator(".msg__error")).toContainText("main model is busy right now", { timeout: 45_000 });
  await expect(a).not.toContainText("did not find enough reliable material");
  await expect(a.getByRole("button", { name: "Try again" })).toBeVisible();
  await shot(page, "5-backup");
});

/** The local Worker's own D1 (the Ask accounts), as the Worker stores it. */
const d1 = (sql: string) => execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/e2e", "--json", "--command", sql], { cwd: new URL("../../bot/", import.meta.url).pathname, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

test("with today's free answers used, Ask does not call Claude or charge, and says when they come back", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.goto(`/ask${launch(11)}`);
  await ask(page, "Who are the twelve tribes?");
  await expect(answer(page)).toContainText("A short answer to");
  // The reader's free day is used up, as if they had asked all day.
  // Filed under the reader's pseudonymous ID, never the Telegram ID.
  const id = await pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + 11);
  expect(JSON.parse(d1(`SELECT COUNT(*) AS n FROM accounts WHERE user_id = '${RUN + 11}'`))[0].results[0].n).toBe(0);
  d1(`UPDATE accounts SET free_used = 100000000 WHERE user_id = '${id}'`);
  const before = JSON.parse(d1(`SELECT free_used, credits FROM accounts WHERE user_id = '${id}'`))[0].results[0];
  await page.reload();
  await expect(page.locator(".chat2")).toContainText("In-depth answers back at");
  const t0 = Date.now();
  await ask(page, "Why keep the Passover?");
  // Not stopped: it goes to the basic answer. The local Worker has no Workers AI or search index,
  // so there is nothing to answer from, and the plans are offered with the time answers return.
  await expect(answer(page).locator(".paywall")).toContainText(/Your free answers come back at \d{1,2}:\d{2}/);
  await shot(page, "6-allowance");
  expect(await modelCalls(request, t0)).toHaveLength(0);
  const after = JSON.parse(d1(`SELECT free_used, credits FROM accounts WHERE user_id = '${id}'`))[0].results[0];
  expect(after).toEqual(before);
});

test("privacy: nothing is sent to an AI provider until the reader agrees, and the agreement can be withdrawn", async ({ page, request }) => {
  await page.addInitScript(() => { (window as unknown as { __noConsent: boolean }).__noConsent = true; });
  await setup(page);
  const t0 = Date.now();
  await page.goto(`/ask${launch(12)}`);
  await ask(page, "Why keep the Passover?");
  const card = answer(page).locator(".consent");
  await expect(card).toContainText("Send your question to Anthropic?");
  await expect(card.locator(".consent__list li").nth(1)).toContainText("Not sent Your name and your Telegram ID.");
  // Another provider can be chosen from the card itself.
  await expect(card.getByRole("button", { name: "Choose another model" })).toBeVisible();
  await page.waitForTimeout(600); // the card's entrance
  await shot(page, "7-consent");
  expect(await modelCalls(request, t0)).toHaveLength(0);
  await card.getByRole("button", { name: "Agree and ask" }).click();
  await expect(answer(page)).toContainText("A short answer to: Why keep the Passover?");
  expect((await modelCalls(request, t0)).length).toBeGreaterThan(0);
  // The server refuses on its own too: a question naming no agreement is not answered.
  const refused = await request.post("/api/ask", { headers: { authorization: `tma ${initData(12)}` }, data: { q: "Why keep the Passover?", stream: true } });
  expect(refused.status()).toBe(428);
  expect((await refused.text())).toContain('"provider":"Anthropic"');
  // Withdrawn in Settings → Privacy: asked again.
  await page.goto(`/privacy${launch(12)}`);
  await page.getByText("Withdraw AI agreement").click();
  await expect(page.getByRole("status")).toContainText("Ask will ask before sending");
  await page.goto(`/ask${launch(12)}`);
  await page.getByRole("button", { name: "New chat" }).click();
  await ask(page, "And the Sabbath?");
  await expect(answer(page).locator(".consent")).toContainText("Send your question to Anthropic?");
});

test("privacy: Delete my data removes the reader's saved chats and allowance, and Download my data then shows nothing kept", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/ask${launch(13)}`);
  await ask(page, "Who are the twelve tribes?");
  await expect(answer(page)).toContainText("A short answer to");
  const auth = { authorization: `tma ${initData(13)}` };
  const before = await (await request.get("/api/privacy/export", { headers: auth })).json();
  expect(before.savedChats).toHaveLength(1);
  expect(JSON.stringify(before)).not.toContain(String(RUN + 13));
  await page.goto(`/privacy${launch(13)}`);
  await shot(page, "8-privacy");
  await page.getByText("Delete my data").click();
  await expect(page.getByRole("status")).toContainText("Done. Deleted: 1 saved Ask chat");
  const after = await (await request.get("/api/privacy/export", { headers: auth })).json();
  expect([after.savedChats, after.readingReminder, after.dailyVerse, after.classNoteRequests]).toEqual([[], null, null, []]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("cj:ask")))).toEqual([]);
  // The stored allowance row is gone from D1 too.
  const id = await pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + 13);
  expect(JSON.parse(d1(`SELECT COUNT(*) AS n FROM accounts WHERE user_id = '${id}'`))[0].results[0].n).toBe(0);
});
