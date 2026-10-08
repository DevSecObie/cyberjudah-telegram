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
/** Launch data for an admin (ADMIN_IDS in playwright.config.ts), for the admin's own endpoints. */
const adminData = () => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 100000002, first_name: "Admin" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac("sha256", secret).update(check).digest("hex") }).toString();
};
const funded = new Set<number>();
async function setup(page: Page) {
  // Paid models are paid from the reader's balance (credits.spec.ts tests that): each reader here
  // gets $5 from the admins once, as the app first loads their account, and has accepted the
  // default paid model's limit once, so these tests exercise Ask beyond its spending prompt.
  await page.addInitScript(() => { try { if (!localStorage.getItem("cj:ai-limits")) localStorage.setItem("cj:ai-limits", JSON.stringify({ "anthropic/claude-opus-5": 2_000_000, "anthropic/claude-sonnet-5": 2_000_000 })); } catch { /* none */ } });
  await page.route("**/api/ask/account*", async (r) => {
    const data = (r.request().headers().authorization ?? "").replace(/^tma /, "");
    const id = Number(JSON.parse(new URLSearchParams(data).get("user") ?? "{}").id);
    if (id && !funded.has(id)) {
      funded.add(id);
      await page.request.post("/api/admin/adjust", { headers: { authorization: `tma ${adminData()}` }, data: { user: id, usd: 5, ref: "e2e-fund", note: "e2e" } });
    }
    await r.continue();
  });
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
    expect(c.tools?.map((t) => t.name)).toEqual(["search_library", "app_help", "find_in_app", "my_saved_chats", "my_reminder", "propose_reminder_change", "read_scripture", "look_up_word", "person", "verse_study", "law", "precepts", "outside_source", "timeline"]);
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

test("Your chats opens as a sheet over the conversation, styled before the Bible has ever been opened", async ({ page }) => {
  await setup(page);
  await page.goto(`/ask${launch(9)}`);
  await ask(page, "Why keep the Passover?");
  await expect(answer(page)).toContainText("A short answer");
  await page.getByRole("button", { name: "Your chats" }).click();
  const sheet = page.locator(".bs-sheet.chats-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".bs-sheet__titles b")).toHaveText("Your chats");
  // Laid out as a sheet (the full width, most of the height), and opaque, so the chat under it does not show through.
  const look = await sheet.evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, width: r.width, height: r.height, bg: getComputedStyle(el).backgroundColor }; });
  expect(look.left).toBeGreaterThanOrEqual(0);
  expect(look.width).toBeGreaterThan(380);
  expect(look.height).toBeGreaterThan(600);
  expect(look.bg).not.toMatch(/rgba\(0, 0, 0, 0\)|\/ 0\.\d+\)$/);
  await shot(page, "8-your-chats");
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
  // The typing indicator appears before resource pins load and the request is sent.
  // Establish that the Worker accepted this question before testing mid-answer recovery.
  const chat = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).chatId as string, `cj:ask:${RUN + 8}`);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/chats/${chat}`, { headers: { authorization: `tma ${initData(8)}` } });
    if (response.status() === 404) return null;
    expect(response.ok()).toBe(true);
    return (await response.json()).pending?.q;
  }).toBe("Answer this slowly");
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
  await expect(page.getByRole("status")).toContainText("Ask and Search will ask before sending");
  await page.goto(`/ask${launch(12)}`);
  await page.getByRole("button", { name: "New chat" }).click();
  await ask(page, "And the Sabbath?");
  await expect(answer(page).locator(".consent")).toContainText("Send your question to Anthropic?");
});

test("privacy: Delete my data removes the reader's saved chats and balance, and Download my data then shows nothing kept", async ({ page, request }) => {
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
  // The balance, its history and holds are gone from D1 too.
  const id = await pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + 13);
  for (const t of ["credit_lots", "credit_ledger", "credit_usage", "credit_holds"]) expect(JSON.parse(d1(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = '${id}'`))[0].results[0].n).toBe(0);
});

test("the model is chosen at the top: an admin starts on Claude Opus 5.5, every other reader on Claude Sonnet", async ({ page, request }) => {
  const acct = async (n: number) => (await (await request.get("/api/ask/account", { headers: { authorization: `tma ${initData(n)}` } })).json()) as { model: string };
  expect((await acct(100000002 - RUN)).model).toBe("anthropic/claude-opus-5.5");
  expect((await acct(51)).model).toBe("anthropic/claude-sonnet-5");
  await setup(page);
  await page.goto(`/ask${launch(51)}`);
  const heading = page.locator(".chat2__heading");
  await expect(heading).toHaveAccessibleName(/^Ask CyberJudah.*Sonnet 5.*Change the model$/);
  await expect(heading).toContainText("Sonnet 5");
  await heading.click();
  await expect(page.getByRole("radiogroup", { name: "Model" })).toBeVisible();
  await page.keyboard.press("Escape");
  const balance = page.locator(".composer2__model");
  await expect(balance).toHaveAccessibleName("$5.00 left");
  await balance.click();
  await expect(page.getByRole("dialog", { name: "Balance" })).toBeVisible();
});

test("privacy: a storage failure reports incomplete deletion and a retry finishes it", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setup(page);
  await page.goto(`/ask${launch(14)}`);
  await ask(page, "Who are the twelve tribes?");
  await expect(answer(page)).toContainText("A short answer to");
  const id = await pid({ PRIVACY_KEY: "e2e-privacy-key-not-secret" }, RUN + 14);
  const trigger = `privacy_failure_${RUN}`;
  const charge = `privacy_test_${RUN}`;
  // Fail payment anonymization in the real Worker after the credit records were removed.
  d1(`CREATE TABLE IF NOT EXISTS payments (charge_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, stars INTEGER NOT NULL, created_at INTEGER NOT NULL);
    INSERT INTO payments (charge_id, user_id, kind, stars, created_at) VALUES ('${charge}', '${id}', 'pack', 100, 1);
    CREATE TRIGGER ${trigger} BEFORE UPDATE OF user_id ON payments WHEN OLD.user_id = '${id}' BEGIN SELECT RAISE(ABORT, 'privacy-test-failure'); END;`);
  await page.goto(`/privacy${launch(14)}`);
  try {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/privacy/delete");
    await page.getByText("Delete my data", { exact: true }).click();
    const failed = await response;
    expect(failed.status()).toBe(503);
    expect(await failed.json()).toMatchObject({ ok: false });
    await expect(page.getByRole("status")).toContainText("Some data may already have been removed");
    expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("cj:ask")))).not.toEqual([]);
    expect(JSON.parse(d1(`SELECT COUNT(*) AS n FROM credit_lots WHERE user_id = '${id}'`))[0].results[0].n).toBe(0);
    expect(JSON.parse(d1(`SELECT user_id FROM payments WHERE charge_id = '${charge}'`))[0].results[0].user_id).toBe(id);
    const partial = await (await request.get("/api/privacy/export", { headers: { authorization: `tma ${initData(14)}` } })).json();
    expect(partial.savedChats).toEqual([]);
  } finally { d1(`DROP TRIGGER IF EXISTS ${trigger}`); }
  await page.getByText("Delete my data", { exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Done. Deleted:");
  expect(JSON.parse(d1(`SELECT COUNT(*) AS n FROM credit_lots WHERE user_id = '${id}'`))[0].results[0].n).toBe(0);
  expect(JSON.parse(d1(`SELECT user_id FROM payments WHERE charge_id = '${charge}'`))[0].results[0].user_id).toBe("deleted");
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("cj:ask")))).toEqual([]);
});

test("Ask answers from the whole app: People, the Timeline, the dictionaries, the law, the precepts and a verse's study, with a picture from the app", async ({ page, request }) => {
  await setup(page);
  await page.goto(`/ask${launch(61)}`);
  const since = Date.now();
  await ask(page, "Everything about Abraham");
  const a = answer(page);
  await expect(a.locator('a[href^="/person/abraham"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(a.locator('a[href^="/timeline/event/"]').first()).toBeVisible();
  await expect(a.locator('a[href^="/dictionary/"]').first()).toBeVisible();
  await expect(a.locator('a[href^="/law/"]').first()).toBeVisible();
  await expect(a.locator('a[href^="/precepts/"]').first()).toBeVisible();
  // The picture the tools named, from the app itself.
  const pic = a.locator("img.msg__pic").first();
  await expect(pic).toHaveAttribute("src", /\/people\/abraham-gen-11-26-256\.webp$/);
  await expect.poll(() => pic.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // Every tool ran on the server and returned real data.
  const results = (await modelCalls(request, since)).flatMap((c) => c.messages).flatMap((m) => (typeof m.content === "string" ? [] : m.content)).filter((b: { type: string }) => b.type === "tool_result");
  const said = results.map((r: { content?: unknown }) => String(typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
  expect(said).toMatch(/Abraham: .*Father: Terah/);
  expect(said).toMatch(/Easton's Bible Dictionary: Abraham/);
  expect(said).toMatch(/The Law, .*Sabbath/i);
  expect(said).toMatch(/Precepts: Adultery/);
});

test("outside sources: only approved sites; an admin proposes a whitelist review", async ({ page, request }) => {
  const auth = (n: number) => ({ authorization: `tma ${initData(n)}` });
  const admin = 100000002 - RUN;
  // The whitelist: an admin sees and sets it; a reader cannot; nonsense is refused.
  expect((await request.get("/api/admin/ask-sources", { headers: auth(71) })).status()).toBe(403);
  const start = await (await request.get("/api/admin/ask-sources", { headers: auth(admin) })).json();
  expect(start.hosts).toContain("wikipedia.org");
  expect(start.hosts).toContain("israelunite.org");
  expect((await request.put("/api/admin/ask-sources", { headers: auth(71), data: { hosts: ["wikipedia.org"] } })).status()).toBe(403);
  expect((await request.put("/api/admin/ask-sources", { headers: auth(admin), data: { hosts: ["not a host"] } })).status()).toBe(400);
  const set = await (await request.put("/api/admin/ask-sources", { headers: auth(admin), data: { sha: start.sha, hosts: ["wikipedia.org", "israelunite.org"], reason: "Limit outside sources for review" } })).json();
  expect(set.state).toBe("Checking");
  expect(set.url).toMatch(/github\.com\/DevSecObie\/cyberjudah-telegram\/pull\//);
  expect((await (await request.get("/api/admin/ask-sources", { headers: auth(admin) })).json()).hosts).toEqual(start.hosts);
  // A site off the list is never read.
  await setup(page);
  await page.goto(`/ask${launch(72)}`);
  const since = Date.now();
  await ask(page, "Read outside https://evil.example/page");
  await expect(answer(page)).toContainText(/not an approved source/, { timeout: 30_000 });
  const said = JSON.stringify((await modelCalls(request, since)).at(-1)?.messages.at(-1));
  expect(said).toContain("evil.example is not an approved source");
});
