import { test, expect } from "@playwright/test";
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const MOCK = fs.readFileSync(new URL("../telegram-mock.js", import.meta.url), "utf8");
const DATA = process.env.DATA_DIR ?? "";
const signed = () => { const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) }; const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n"); const secret = crypto.createHmac("sha256", "WebAppData").update(process.env.BOT_TOKEN ?? "123456:ABC-DEF").digest(); const hash = crypto.createHmac("sha256", secret).update(check).digest("hex"); return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`; };
for (const [name, to] of [["app-noslash", "/app"], ["app-slash", "/app/"], ["app-deep", "/app/bible/genesis/1"], ["app-start", "/app?tgWebAppStartParam=bible_psalms_23"]]) {
  test(name, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
    page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
    await page.route("https://data.cyberjudah.io/**", (r) => { const p = decodeURIComponent(new URL(r.request().url()).pathname); const f = path.join(DATA, p); if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); return r.fulfill({ status: 404, body: "" }); });
    await page.route(/ytimg|youtube\.com|fonts\.g/, (r) => r.abort());
    await page.goto(to + signed());
    await page.waitForTimeout(2500);
    const text = (await page.locator("#root").innerText().catch(() => "")).slice(0, 200).replace(/\s+/g, " ");
    console.log(`[${name}] url=${page.url()} root-text="${text}" errors=${JSON.stringify(errors)}`);
    await page.screenshot({ path: `e2e/tmp/${name}.png` });
    expect(text.length).toBeGreaterThan(0);
  });
}
