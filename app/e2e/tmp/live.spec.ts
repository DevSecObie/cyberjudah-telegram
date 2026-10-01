import { test } from "@playwright/test";
import fs from "node:fs"; import crypto from "node:crypto";

/**
 * Loads the LIVE Mini App (PLAYWRIGHT_BASE_URL) with the Telegram SDK shim and the real data
 * origin, and prints what rendered plus every console error, page error and failed request,
 * for each way Telegram opens it. Diagnostic only; nothing here is a pass/fail gate.
 */
const MOCK = fs.readFileSync(new URL("../telegram-mock.js", import.meta.url), "utf8");
const signed = () => { const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Probe" }), auth_date: String(Math.floor(Date.now() / 1000)) }; const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n"); const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN ?? "123456:ABC-DEF").digest(); const hash = crypto.createHmac("sha256", secret).update(check).digest("hex"); return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`; };

test("data origin feeds", async ({ request }) => {
  for (const p of ["/search/classes.json", "/search/captains.json", "/search/topics.json", "/search-index/parts.json", "/api/stats.json", "/api/kjv/books.json"]) {
    const r = await request.get(`https://data.cyberjudah.io${p}`);
    console.log(`[feed] ${p} status=${r.status()} bytes=${(await r.body()).length}`);
  }
});

for (const [name, to, shim] of [["app-noslash", "/app", true], ["app-slash", "/app/", true], ["app-deep", "/app/bible/genesis/1", true], ["app-start", "/app?tgWebAppStartParam=bible_psalms_23", true], ["app-real-sdk", "/app/", false]] as const) {
  test(name, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url().slice(0, 160)} ${r.failure()?.errorText}`));
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url().slice(0, 160)}`); });
    if (shim) await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
    await page.goto(to + (shim ? signed() : ""), { waitUntil: "load" });
    await page.waitForTimeout(4000);
    const html = (await page.content()).length;
    const text = (await page.locator("#root").innerText().catch(() => "(no #root)")).slice(0, 300).replace(/\s+/g, " ");
    console.log(`\n[${name}] final url=${page.url()}\n[${name}] html bytes=${html} root text="${text}"\n[${name}] issues (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    await page.screenshot({ path: `test-results/live-${name}.png`, fullPage: false });
  });
}
