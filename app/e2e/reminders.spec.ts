import { expect, test, type Page, type Route } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Reading reminders at 390×844, in each place a reader can be: inside Telegram, a browser
 * that can take push, an iPhone browser not on the Home Screen, and a browser where
 * notifications were declined. Each choice must say what it means there, in the words given.
 * Set REVIEW_SHOTS=1 to write the screenshots to e2e/review/reminders.
 */
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const DATA_ORIGIN = process.env.VITE_DATA_ORIGIN || "https://data.cyberjudah.io";
const BOT_TOKEN = process.env.BOT_TOKEN ?? "123456:ABC-DEF";
/** A fresh reader each run: the local Worker's KV keeps records between runs. */
const RUN = 100000 + Math.floor(Math.random() * 1e9);
const launch = (n: number) => {
  const id = RUN + n;
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
};
/** A test public key, as the server would give with VAPID_PUBLIC_KEY set (the local Worker has none). */
const PUBLIC_KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const TELEGRAM = "Sent by @CyberJudah_bot in your Telegram chat. Works on every device.";
const BOTH = "You'll get one reminder in each place. Marking it Done in either one clears both.";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.use({ viewport: { width: 390, height: 844 } });

const shot = async (page: Page, name: string) => {
  if (!process.env.REVIEW_SHOTS) return;
  fs.mkdirSync(new URL("./review/reminders/", import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL(`./review/reminders/${name}.png`, import.meta.url).pathname });
};

async function setup(page: Page, { withKey = false } = {}) {
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
  if (DATA_ORIGIN !== "https://data.cyberjudah.io") await page.route("https://data.cyberjudah.io/**", (r) => r.continue({ url: r.request().url().replace("https://data.cyberjudah.io", DATA_ORIGIN) }));
  // The real Worker answers; only the public key is added, as a deploy with the VAPID secrets would.
  if (withKey) await page.route(/\/api\/reminders(\?|$)/, async (r: Route) => {
    const res = await r.fetch();
    const json = await res.json();
    await r.fulfill({ response: res, json: { ...json, publicKey: PUBLIC_KEY } });
  });
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
  await page.getByRole("button", { name: "20:00", exact: true }).click();
  await expect(sw).toContainText("Every day at 20:00");
  await shot(page, "2-telegram-on");
  // Pause, then stop with the switch: off again.
  await page.getByRole("button", { name: /Pause for a week/ }).click();
  await expect(page.getByRole("button", { name: /Paused/ })).toContainText("tap to resume");
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

test("a browser that can take push: it says the browser will ask, and push is chosen through the browser", async ({ page, context }) => {
  await setup(page, { withKey: true });
  // Chromium here has no push service: subscribe() is stood in for, as a browser's would answer.
  await context.grantPermissions(["notifications"]);
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { get: () => (window as unknown as { __perm?: string }).__perm ?? "default", configurable: true });
    Notification.requestPermission = async () => { (window as unknown as { __perm: string }).__perm = "granted"; return "granted"; };
    PushManager.prototype.subscribe = async function () {
      const json = { endpoint: "https://fcm.googleapis.com/fcm/send/e2e-test", expirationTime: null, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
      return { endpoint: json.endpoint, toJSON: () => json, unsubscribe: async () => true } as unknown as PushSubscription;
    };
    PushManager.prototype.getSubscription = async () => null;
  });
  await page.goto("/settings/reminders");
  await expect(choice(page, "Push notification")).toContainText("Your browser will ask permission next.");
  await expect(choice(page, "Telegram")).toContainText(TELEGRAM);
  await expect(choice(page, "Both")).toContainText(BOTH);
  await shot(page, "4-browser-push");
  await page.getByRole("radio", { name: "Push notification" }).click();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "true");
  // The browser now has its own credential, and the Worker kept the subscription.
  expect(await page.evaluate(() => localStorage.getItem("cj:remind-device"))).toMatch(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  await page.getByRole("switch", { name: /Remind me to read/ }).click();
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: /Remind me to read/ })).toContainText("Every day at 7:00");
  // Telegram from a browser: the bot's chat is linked first.
  await page.getByRole("radio", { name: "Both" }).click();
  await expect(choice(page, "Telegram")).toContainText("Start the bot first so it can message you");
});

test("an iPhone browser not on the Home Screen: push explains Add to Home Screen, with the steps", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await setup(page, { withKey: true });
  await page.goto("/settings/reminders");
  const push = choice(page, "Push notification");
  await expect(push).toContainText("On iPhone, push works only after you add CyberJudah to your Home Screen (Share → Add to Home Screen, iOS 16.4 or later)");
  await expect(push.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  await expect(choice(page, "Telegram")).toContainText(TELEGRAM);
  await shot(page, "5-iphone-not-home-screen");
  await context.close();
});

test("notifications declined: push says they are blocked and stays off", async ({ page }) => {
  await setup(page, { withKey: true });
  await page.addInitScript(() => { Object.defineProperty(Notification, "permission", { get: () => "denied", configurable: true }); });
  await page.goto("/settings/reminders");
  await expect(choice(page, "Push notification")).toContainText("Notifications are blocked for this site. You can allow them in your browser settings.");
  await expect(page.getByRole("radio", { name: "Push notification" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");
  await shot(page, "6-push-declined");
});

test("declined at the browser's own prompt: the same explanation, push left off", async ({ page }) => {
  await setup(page, { withKey: true });
  await page.addInitScript(() => { Notification.requestPermission = async () => "denied"; });
  await page.goto("/settings/reminders");
  await page.getByRole("radio", { name: "Push notification" }).click();
  await expect(choice(page, "Push notification")).toContainText("Notifications are blocked for this site. You can allow them in your browser settings.");
  await expect(page.getByRole("radio", { name: "Push notification" })).toHaveAttribute("aria-checked", "false");
});

test("Settings lists Reading reminders", async ({ page }) => {
  await setup(page);
  await page.goto(`/settings${launch(7004)}`);
  await page.getByRole("button", { name: /^Reading reminders/ }).click();
  await expect(page).toHaveURL(/\/settings\/reminders/);
});
