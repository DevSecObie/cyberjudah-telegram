import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { STAND_IN, type Logged } from "./stand-ins";
import { open, pid, seal } from "../../bot/src/privacy.mjs";
const KEYS = { PRIVACY_KEY: "e2e-privacy-key-not-secret" };

/**
 * Reading reminders at 390×844, against the real local Worker: its own initData check
 * (launch data signed with the test bot token it was started with), its own storage, its
 * own cron (GET /__scheduled), and real browser permission states set through the
 * DevTools protocol. In each place a reader can be (inside Telegram, a browser that can
 * take push, an iPhone browser not on the Home Screen, a browser where notifications are
 * blocked) each choice must say what it means there, in the words given.
 *
 * Two things outside the app are stood in for, and nothing else:
 * - the far side of the Worker's network calls, the Bot API and a push service (stand-ins.ts);
 * - the browser's own push service registration (PushManager.subscribe), which needs a
 *   push service headless Chromium does not have; it hands back a subscription to the
 *   stand-in push service, which the Worker then really posts to.
 * Set REVIEW_SHOTS=1 to write the screenshots to e2e/review/reminders.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN!;
const BOT_DIR = new URL("../../bot/", import.meta.url).pathname;
/** A fresh reader each run (crypto.randomInt: the id is signed into launch data). */
const RUN = 100000 + crypto.randomInt(1e9);
const initData = (n: number) => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: RUN + n, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
};
const launch = (n: number) => `#tgWebAppData=${encodeURIComponent(initData(n))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
const TELEGRAM = "Sent by @CyberJudah_bot in your Telegram chat. Works on every device.";
const BOTH = "You'll get one reminder in each place. Marking it Done in either one clears both.";
const BLOCKED = "Notifications are blocked for this site. You can allow them in your browser settings.";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.use({ viewport: { width: 390, height: 844 } });
// These write reminders, run the cron and read the Worker's storage: the local Worker only, never production.
test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "needs the local Worker started by playwright.config.ts");

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/reminders/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/reminders/${name}.png`, import.meta.url).pathname });
};

async function setup(page: Page) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
}

/** The site's notification permission, set in the browser itself (DevTools protocol), as a reader's choice leaves it. The session stays open: detaching it undoes the setting. */
async function permission(page: Page, setting: "granted" | "denied" | "prompt") {
  const cdp = await page.context().newCDPSession(page);
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await cdp.send("Browser.setPermission", { permission: { name: "notifications" }, setting, origin, browserContextId: (targetInfo as { browserContextId?: string }).browserContextId });
}
/** The browser's push registration, which needs a push service headless Chromium lacks: it subscribes to the stand-in push service instead. */
async function standInPushService(page: Page, id: string) {
  await page.addInitScript(([endpoint]) => {
    const KEY = "e2e:push-subscription";
    const make = (json: PushSubscriptionJSON) => ({ endpoint: json.endpoint, options: { userVisibleOnly: true }, toJSON: () => json, unsubscribe: async () => { localStorage.removeItem(KEY); return true; } }) as unknown as PushSubscription;
    PushManager.prototype.subscribe = async function () {
      const json = { endpoint, expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
      localStorage.setItem(KEY, JSON.stringify(json));
      return make(json);
    };
    PushManager.prototype.getSubscription = async function () { const j = localStorage.getItem(KEY); return j ? make(JSON.parse(j)) : null; };
  }, [`${STAND_IN}/push/${id}`]);
}

/** What the Worker sent to the stand-in Bot API and push service. */
const sent = async (request: APIRequestContext, since = 0): Promise<Logged[]> => ((await (await request.get(`${STAND_IN}/__log`)).json()) as Logged[]).filter((e) => e.at >= since);

/** The local Worker's storage, read and written as an operator would, with wrangler. */
const kv = (...args: string[]) => execFileSync("npx", ["wrangler", "kv", ...args, "--binding", "SUBS", "--local", "--persist-to", ".wrangler/e2e"], { cwd: BOT_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/**
 * A reminder turned on at today's time starts tomorrow (applySettings), so the run has
 * nothing to send today. To test today's run, the record is moved back to having been
 * turned on yesterday: its start date only, nothing else.
 */
async function startedYesterday(key: string) {
  // Records are sealed at rest (bot/src/privacy.mjs): opened and sealed again with the test Worker's key.
  const stored = kv("key", "get", key).trim();
  expect(stored.startsWith("s1."), "the reminder is sealed at rest").toBe(true);
  const rec = await open<Record<string, unknown>>(KEYS, key, stored);
  const [{ metadata }] = JSON.parse(kv("key", "list", "--prefix", key)) as { metadata: unknown }[];
  kv("key", "put", key, await seal(KEYS, key, { ...rec, from: new Date().toISOString().slice(0, 10) }), "--metadata", JSON.stringify(metadata));
}
/** The run looks at the quarter hour it is in; a test that starts in the last minute of one waits for the next. */
async function clearOfQuarterBoundary() {
  const left = 15 * 60000 - (Date.now() % (15 * 60000));
  if (left < 75_000) await new Promise((r) => setTimeout(r, left + 2000));
}
/** Verify a VAPID Authorization header (RFC 8292): an ES256 JWT for this push service, signed by the key the Worker gives browsers. */
function verifyVapid(header: string, publicKey: string, audience: string) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  expect(m, header).toBeTruthy();
  const [head, body, sig] = m![1].split(".");
  expect(m![2]).toBe(publicKey);
  const pub = Buffer.from(publicKey, "base64url");
  const key = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
  expect(crypto.verify("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  expect(claims.aud).toBe(audience);
  expect(claims.sub).toBe("mailto:e2e@cyberjudah.invalid");
  expect(claims.exp * 1000).toBeGreaterThan(Date.now());
}
const choice = (page: Page, name: string) => page.locator(".remind-choice", { has: page.getByRole("radio", { name }) });

test("inside Telegram: Telegram is offered, push is greyed with the reason, the switch turns it on", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings/reminders${launch(7001)}`);
  await expect(page.getByRole("heading", { name: "Reading reminders" })).toBeVisible();
  const sw = page.getByRole("switch", { name: /Remind me to read/ });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(sw).toContainText("Off");
  await expect(choice(page, "Telegram")).toContainText(TELEGRAM);
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  await expect(choice(page, "Push notification")).toContainText("Push notifications aren't available inside Telegram. Open CyberJudah in your browser at cyberjudah.io/app to turn them on.");
  await expect(choice(page, "Both")).toContainText(BOTH);
  await shot(page, "1-telegram-off");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(sw).toContainText("Every day at 7:00");
  await expect(page.getByRole("radio", { name: "Telegram" })).toHaveAttribute("aria-checked", "true");
  // The bot was asked for permission to write, as Telegram requires.
  const log = await page.evaluate(() => (window as unknown as { __tg: { log: unknown[][] } }).__tg.log);
  expect(log.some((e) => e[0] === "writeAccess")).toBe(true);
  // The time is the reader's own, and it is kept.
  await page.getByRole("button", { name: /^Time/ }).click();
  await page.getByRole("button", { name: "20:00 – 20:45", exact: true }).click();
  await page.getByRole("button", { name: "20:15", exact: true }).click();
  await expect(sw).toContainText("Every day at 20:15");
  await shot(page, "2-telegram-on");
  // Pause (until tomorrow, a week, a date, or until resumed), resume, then stop with the switch.
  await page.getByRole("button", { name: /^Pause/ }).click();
  await expect(page.getByRole("button", { name: "Until a date…", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Until I resume", exact: true }).click();
  await expect(page.getByRole("button", { name: /Paused/ })).toContainText("Until you resume · tap to resume");
  await page.getByRole("button", { name: /Paused/ }).click();
  await page.getByRole("button", { name: /^Pause/ }).click();
  await page.getByRole("button", { name: "For a week", exact: true }).click();
  await expect(page.getByRole("button", { name: /Paused/ })).toContainText(/Until \d{4}-\d{2}-\d{2} · tap to resume/);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
});

test("inside Telegram: a bot that may not write shows 'Start the bot first' with a button", async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    const t = setInterval(() => { const w = (window as unknown as { Telegram?: { WebApp?: { requestWriteAccess?: (cb: (ok: boolean) => void) => void } } }).Telegram?.WebApp; if (w?.requestWriteAccess) { w.requestWriteAccess = (cb) => cb(false); clearInterval(t); } }, 1);
  });
  await page.goto(`/settings/reminders${launch(7002)}`);
  await page.getByRole("radio", { name: "Telegram" }).click();
  await expect(choice(page, "Telegram")).toContainText("Start the bot first so it can message you");
  await expect(choice(page, "Telegram").getByRole("button", { name: "Start the bot" })).toBeVisible();
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toHaveAttribute("aria-checked", "false");
  await shot(page, "3-telegram-start-bot");
});

test("the deep links: Settings opens the reminders, and a reminder's Open lands on its chapter", async ({ page }) => {
  await setup(page);
  await page.goto(`/?tgWebAppStartParam=settings_reminders${launch(7003)}`);
  await expect(page).toHaveURL(/\/settings\/reminders/);
  await expect(page.getByRole("heading", { name: "Reading reminders" })).toBeVisible();
  const other = await page.context().newPage();
  await setup(other);
  await other.goto(`/?tgWebAppStartParam=bible_genesis_3${launch(7003)}`);
  await expect(other).toHaveURL(/\/(read|bible)\/genesis\/3$/);
  await expect(other.locator("#verset-1")).toBeVisible();
  await other.close();
});

test("a browser that can take push: it says the browser will ask, and push is chosen through the browser", async ({ page }) => {
  await setup(page);
  await standInPushService(page, `ui-${RUN}`);
  await page.goto("/settings/reminders");
  expect(await page.evaluate(() => Notification.permission)).toBe("default");
  await expect(choice(page, "Push notification")).toContainText("Your browser will ask permission next.");
  await expect(choice(page, "Telegram")).toContainText(TELEGRAM);
  await expect(choice(page, "Both")).toContainText(BOTH);
  await shot(page, "4-browser-push");
  // The reader answers Allow at the browser's prompt (headless Chromium cannot draw it).
  await permission(page, "granted");
  await page.getByRole("radio", { name: "Push notification" }).click();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "true");
  // The app's own service worker is registered for real.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? "")).toMatch(/\/sw\.js$/);
  // The browser now has its own credential, and the Worker kept the subscription.
  const device = await page.evaluate(() => localStorage.getItem("cj:remind-device"));
  expect(device).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  const stored = await (await page.request.get("/api/reminders?tz=UTC", { headers: { "x-cj-device": device! } })).json();
  expect(stored.pushEndpoints).toEqual([`${STAND_IN}/push/ui-${RUN}`]);
  await page.getByRole("switch", { name: /Remind me to read/ }).click();
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toHaveAttribute("aria-checked", "true");
  // Restored after a reload, from the Worker.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toContainText("Every day at 7:00");
  // Disabled, and restored disabled.
  await page.getByRole("switch", { name: /Remind me to read/ }).click();
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toHaveAttribute("aria-checked", "false");
  await page.reload();
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "true");
  // Telegram from a browser: the bot's chat is linked first.
  await page.getByRole("radio", { name: "Both" }).click();
  await expect(choice(page, "Telegram")).toContainText("Start the bot first so it can message you");
});

test("an iPhone browser not on the Home Screen: push explains Add to Home Screen, with the steps", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await setup(page);
  await page.goto("/settings/reminders");
  const push = choice(page, "Push notification");
  await expect(push).toContainText("On iPhone, push works only after you add CyberJudah to your Home Screen (Share → Add to Home Screen, iOS 16.4 or later)");
  await expect(push.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  await expect(choice(page, "Telegram")).toContainText(TELEGRAM);
  await shot(page, "5-iphone-not-home-screen");
  await context.close();
});

test("notifications already blocked for the site: push says so before anything is tapped, and stays off", async ({ page }) => {
  await setup(page);
  await permission(page, "denied");
  await page.goto("/settings/reminders");
  expect(await page.evaluate(() => Notification.permission)).toBe("denied");
  await expect(choice(page, "Push notification")).toContainText(BLOCKED);
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");
  await shot(page, "6-push-declined");
});

test("declined at the browser's prompt after tapping Push: blocked is explained, push left off, nothing saved", async ({ page }) => {
  await setup(page);
  await page.goto("/settings/reminders");
  // Not yet asked; the tap asks, and the browser answers no (headless Chromium declines prompts).
  expect(await page.evaluate(() => Notification.permission)).toBe("default");
  await expect(choice(page, "Push notification")).toContainText("Your browser will ask permission next.");
  await page.getByRole("radio", { name: "Push notification" }).click();
  await expect(choice(page, "Push notification")).toContainText(BLOCKED);
  expect(await page.evaluate(() => Notification.permission)).toBe("denied");
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("cj:remind-device"))).toBeNull();
});

test("the browser's prompt closed without an answer: not called blocked, and it can be asked again", async ({ page }) => {
  await setup(page);
  // A prompt that is closed leaves the permission at "default" (headless Chromium closes it).
  await permission(page, "prompt");
  await page.goto("/settings/reminders");
  await page.getByRole("radio", { name: "Push notification" }).click();
  await expect(choice(page, "Push notification")).toContainText("The browser's question was closed without an answer. Choose Push notification again to be asked.");
  await expect(choice(page, "Push notification")).not.toContainText(BLOCKED);
  expect(await page.evaluate(() => Notification.permission)).toBe("default");
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");
});

test("Settings lists Reading reminders", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings${launch(7004)}`);
  await page.getByRole("button", { name: /^Reading reminders/ }).click();
  await expect(page).toHaveURL(/\/settings\/reminders/);
});

/** The Worker's own rules, called as a browser would. */
const SUB = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${RUN}-${n}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } });

test("API: a browser's subscription is renewed in place, and Forget removes the browser", async ({ request }) => {
  const made = await request.put("/api/reminders", { data: { settings: { on: true, tz: "UTC", channels: { push: true } }, push: SUB("a") } });
  expect(made.status()).toBe(200);
  const { device, pushEndpoints } = await made.json();
  expect(pushEndpoints).toEqual([SUB("a").endpoint]);
  const headers = { "x-cj-device": device };
  // pushsubscriptionchange: the old endpoint hands over to the new one.
  expect((await request.post("/api/push/renew", { data: { old: SUB("a").endpoint, sub: SUB("b") } })).status()).toBe(200);
  expect((await (await request.get("/api/reminders?tz=UTC", { headers })).json()).pushEndpoints).toEqual([SUB("b").endpoint]);
  // A second browser of the same reader is added beside it, not in place of it.
  await request.put("/api/reminders", { headers, data: { push: SUB("c") } });
  expect((await (await request.get("/api/reminders?tz=UTC", { headers })).json()).pushEndpoints).toEqual([SUB("b").endpoint, SUB("c").endpoint]);
  // A refused endpoint host is not accepted.
  expect((await request.put("/api/reminders", { headers, data: { push: { ...SUB("d"), endpoint: "https://evil.example/x" } } })).status()).toBe(400);
  // Forget: the credential stops working and the subscriptions are gone.
  expect((await request.delete("/api/reminders", { headers, data: {} })).status()).toBe(200);
  expect((await (await request.get("/api/reminders?tz=UTC", { headers })).json()).identity).toBe("none");
  expect((await request.post("/api/push/today", { data: { endpoint: SUB("b").endpoint } })).status()).toBe(404);
});

test("API: each caller is rate limited, with Retry-After", async ({ request }) => {
  const { device } = await (await request.put("/api/reminders", { data: { settings: { tz: "UTC" } } })).json();
  const headers = { "x-cj-device": device };
  let limited = null as null | { status: number; retry: string | undefined };
  for (let i = 0; i < 40 && !limited; i++) {
    const r = await request.get("/api/reminders?tz=UTC", { headers });
    if (r.status() === 429) limited = { status: 429, retry: r.headers()["retry-after"] };
  }
  expect(limited).toEqual({ status: 429, retry: "60" });
});

test("API: inside Telegram the reader is known only by launch data signed with the bot's token", async ({ request }) => {
  const good = await request.put("/api/reminders", { headers: { authorization: `tma ${initData(7201)}` }, data: { settings: { tz: "UTC" } } });
  expect(good.status()).toBe(200);
  expect((await good.json()).identity).toBe("telegram");
  // The same launch data with one character of the signature changed, or signed with another token.
  const forged = initData(7201).replace(/hash=([0-9a-f])/, (_, c) => `hash=${c === "0" ? "1" : "0"}`);
  expect((await request.put("/api/reminders", { headers: { authorization: `tma ${forged}` }, data: { settings: { tz: "UTC" } } })).status()).toBe(401);
  const other = new URLSearchParams(initData(7201));
  other.set("user", JSON.stringify({ id: RUN + 7299, first_name: "Someone else" }));
  expect((await request.put("/api/reminders", { headers: { authorization: `tma ${other}` }, data: { settings: { tz: "UTC" } } })).status()).toBe(401);
});

/** A reminder due now: on at the current quarter hour (UTC), started yesterday, with a chapter to go back to. */
async function dueNow(request: APIRequestContext, who: { headers?: Record<string, string>; channels: { telegram?: boolean; push?: boolean }; push?: object }) {
  const now = new Date();
  const res = await request.put("/api/reminders", { headers: who.headers, data: { settings: { on: true, hour: now.getUTCHours(), minute: Math.floor(now.getUTCMinutes() / 15) * 15, tz: "UTC", channels: who.channels }, content: { plan: null, last: { slug: "genesis", chapter: 3 } }, ...(who.push ? { push: who.push } : {}) } });
  expect(res.status()).toBe(200);
  const v = await res.json();
  expect(v.on).toBe(true);
  return v as { device?: string; publicKey: string };
}
const runCron = async (request: APIRequestContext) => expect((await request.get("/__scheduled?cron=15,30,45+*+*+*+*")).status()).toBe(200);
const pushKeys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };

/**
 * A quarter hour's run, now. Each run is checkpointed (remind-slot:<time>) so it never
 * repeats, and the next quarter's run starts without one; removing the checkpoints first is
 * what the clock would do (an earlier test or run in this quarter may have left them).
 * Whether a reader is sent to again is then up to their own record.
 */
async function freshRun(request: APIRequestContext) {
  const slots = JSON.parse(kv("key", "list", "--prefix", "remind-slot:")) as { name: string }[];
  for (const { name } of slots) kv("key", "delete", name);
  await runCron(request);
}

test("delivery: at the reader's time the run sends by Telegram and by push once a day, drops unsubscribed browsers, and tells the admins once about refused keys", async ({ request }) => {
  test.setTimeout(180_000);
  await clearOfQuarterBoundary();
  const uid = RUN + 7301;
  await dueNow(request, { headers: { authorization: `tma ${initData(7301)}` }, channels: { telegram: true } });
  const endpoint = `${STAND_IN}/push/due-${RUN}`;
  const browser = await dueNow(request, { channels: { push: true }, push: { endpoint, keys: pushKeys } });
  const gone = await dueNow(request, { channels: { push: true }, push: { endpoint: `${STAND_IN}/push/gone-${RUN}`, keys: pushKeys } });
  const refused = await dueNow(request, { channels: { push: true }, push: { endpoint: `${STAND_IN}/push/refuse-${RUN}`, keys: pushKeys } });
  expect(browser.publicKey).toBeTruthy();
  await startedYesterday(`remind:tg:${await pid(KEYS, uid)}`);
  for (const v of [browser, gone, refused]) await startedYesterday(`remind:dev:${v.device!.split(".")[0]}`);
  // The admins are told once a day; this run is the first today (a rerun on a reused local Worker may not be).
  for (const { name } of JSON.parse(kv("key", "list", "--prefix", "remind-alert:")) as { name: string }[]) kv("key", "delete", name);
  const toAdmins = (log: Logged[]) => log.filter((e) => e.path.endsWith("/sendMessage") && (e.body as { chat_id?: number })?.chat_id === 100000002);
  const pushesTo = (log: Logged[], id: string) => log.filter((e) => e.path === `/push/${id}-${RUN}`).length;

  const t0 = Date.now();
  await freshRun(request);
  await expect.poll(async () => { const log = await sent(request, t0); return [log.filter((e) => e.path.endsWith("/sendMessage") && (e.body as { chat_id?: number }).chat_id === uid).length, pushesTo(log, "due"), pushesTo(log, "gone"), Math.min(1, pushesTo(log, "refuse")), toAdmins(log).length]; }, { timeout: 30_000 }).toEqual([1, 1, 1, 1, 1]);
  const log = await sent(request, t0);
  // Telegram: the reader's chat, the chapter to go back to, and Open / Done / Pause / Stop.
  const tg = log.find((e) => e.path === `/bot${BOT_TOKEN}/sendMessage` && (e.body as { chat_id: number }).chat_id === uid)!;
  const msg = tg.body as { text: string; parse_mode: string; reply_markup: { inline_keyboard: { text: string }[][] } };
  expect(msg.text).toBe("<b>Continue where you left off</b>\nGenesis 3");
  expect(msg.parse_mode).toBe("HTML");
  expect(msg.reply_markup.inline_keyboard.flat().map((b) => b.text)).toEqual(["Open", "Done", "Pause…", "Stop"]);
  // Push: no payload, signed with VAPID for this push service, replaceable and short-lived.
  const push = log.find((e) => e.path === `/push/due-${RUN}`)!;
  expect(push.headers.ttl).toBe("21600");
  expect(push.headers.urgency).toBe("normal");
  expect(push.headers.topic).toBe("daily-reading");
  expect(push.headers["content-length"]).toBe("0");
  verifyVapid(push.headers.authorization, browser.publicKey, STAND_IN);
  // What the service worker shows for that push, asked by its endpoint.
  expect(await (await request.post("/api/push/today", { data: { endpoint } })).json()).toEqual({ ok: true, done: false, title: "Continue where you left off", body: "Genesis 3", param: "bible_genesis_3" });
  // 410: that browser unsubscribed, so it is dropped. 403: our keys were refused, so nothing is dropped and the admins are told.
  const endpoints = async (d: string) => (await (await request.get("/api/reminders?tz=UTC", { headers: { "x-cj-device": d } })).json()).pushEndpoints;
  expect(await endpoints(gone.device!)).toEqual([]);
  expect(await endpoints(refused.device!)).toEqual([`${STAND_IN}/push/refuse-${RUN}`]);
  expect((toAdmins(log)[0].body as { text: string }).text).toContain("push services refused our VAPID signature");

  // The next run: nothing again for the readers reached today; the refused push is retried; the admins are not told twice.
  const t1 = Date.now();
  await freshRun(request);
  // (A refused push is given back, so the run's catch-up of the previous quarter may try it too.)
  await expect.poll(async () => pushesTo(await sent(request, t1), "refuse"), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const again = await sent(request, t1);
  expect(again.filter((e) => e.path.endsWith("/sendMessage") && (e.body as { chat_id?: number }).chat_id === uid)).toHaveLength(0);
  expect(pushesTo(again, "due")).toBe(0);
  expect(pushesTo(again, "gone")).toBe(0);
  expect(toAdmins(again)).toHaveLength(0);

  // Done from the notification: the day is done everywhere, and the reading moves on to the next chapter.
  expect((await request.post("/api/push/done", { data: { endpoint } })).status()).toBe(200);
  expect(await (await request.post("/api/push/today", { data: { endpoint } })).json()).toMatchObject({ done: true, body: "Genesis 4" });
});

test("the service worker: a push shows a reminder notification, even when today's reading cannot be fetched", async ({ page }) => {
  await setup(page);
  await page.goto("/settings/reminders");
  await permission(page, "granted");
  // The app's own service worker, registered as subscribePush does.
  const scope = await page.evaluate(async () => { const r = await navigator.serviceWorker.register("/sw.js", { scope: "/" }); await navigator.serviceWorker.ready; return r.scope; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  const reg = await new Promise<string>((resolve) => cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => { const r = registrations.find((x: { scopeURL: string }) => x.scopeURL === scope); if (r) resolve(r.registrationId); }));
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(scope).origin, registrationId: reg, data: "" });
  // This browser has no subscription the Worker knows, so the plain reminder is shown.
  await expect.poll(async () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => [n.title, n.body, n.tag])), { timeout: 15_000 })
    .toEqual([["CyberJudah", "Open CyberJudah to keep reading.", "cj-reminder"]]);
});
