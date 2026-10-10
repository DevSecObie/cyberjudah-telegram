import { expect, test, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
// Existing server encryption/session format; these are local test credentials only.
import { keyedHash, pid, seal } from "../../bot/src/privacy.mjs";

const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
const token = process.env.BOT_TOKEN!;
const old = JSON.stringify({ 2: { color: "color1", date: 123 } });
function signed(id: number, age = 0) {
  const values: Record<string, string> = { user: JSON.stringify({ id, first_name: "Sync reader" }), auth_date: String(Math.floor(Date.now() / 1000) - age) };
  const secret = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const hash = crypto.createHmac("sha256", secret).update(Object.keys(values).sort().map(k => `${k}=${values[k]}`).join("\n")).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}
async function fixture(page: Page, telegram: boolean) {
  await page.route("https://telegram.org/**", r => r.fulfill({ contentType: "application/javascript", body: telegram ? MOCK : "" }));
  await page.route("https://data.cyberjudah.io/**", r => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/books.json")) return r.fulfill({ json: [{ book: "Genesis", slug: "genesis", chapters: 1, verses: 2, testament: "Old Testament", chapterIds: [1] }] });
    if (path.endsWith("/genesis/1.json")) return r.fulfill({ json: { book: "Genesis", chapter: 1, verses: [{ verse: 1, text: "In the beginning God created the heaven and the earth." }, { verse: 2, text: "And the earth was without form, and void." }] } });
    return r.fulfill({ status: 404 });
  });
  await page.addInitScript(value => {
    (window as unknown as { __cloud: Record<string, string> }).__cloud = { bs_h_genesis_1: value };
    if (!localStorage.getItem("cj:bs_h_genesis_1")) localStorage.setItem("cj:bs_h_genesis_1", value);
  }, old);
}
const highlighted = (page: Page, verse: number) => page.locator(`#verset-${verse} .bs-text`);
const colour = (page: Page, verse: number) => highlighted(page, verse).evaluate(el => getComputedStyle(el.parentElement!).backgroundColor);
async function mark(page: Page, verse: number, index = 2) {
  await highlighted(page, verse).click();
  await page.getByRole("group", { name: "Highlight colour" }).getByRole("button").nth(index).click();
}
test.skip(process.env.VITE_FIREBASE_EMULATOR !== "true", "requires the local Auth and Firestore emulators");
test("phone, computer and web share highlights while original marks remain intact", async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const id = crypto.randomInt(500000000, 900000000), launch = `#tgWebAppData=${encodeURIComponent(signed(id))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } }), computer = await browser.newContext({ viewport: { width: 1280, height: 900 } }), web = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const a = await phone.newPage(), b = await computer.newPage(), c = await web.newPage();
    for (const page of [a, b]) await fixture(page, true); await fixture(c, false);
    const origin = info.project.use.baseURL!;
    let mints = 0; a.on("request", r => { if (r.url().endsWith("/api/firebase/token")) mints++; });
    let release!: () => void;
    const restored = new Promise<void>(done => { release = done; });
    await a.route("**/api/firebase/token", async route => { await restored; await route.continue(); });
    await a.goto(`${origin}/read/genesis/1${launch}`);
    // An edit made while sign-in is pending must survive initial server hydration.
    await mark(a, 1); release();
    await expect.poll(() => colour(a, 2)).not.toBe("rgba(0, 0, 0, 0)");
    await a.keyboard.press("Escape");
    await expect.poll(() => colour(a, 1)).not.toBe("rgba(0, 0, 0, 0)");
    await a.screenshot({ path: info.outputPath("phone-highlight.png") });
    await b.goto(`${origin}/read/genesis/1${launch}`);
    await expect.poll(() => colour(b, 1)).toBe(await colour(a, 1));
    await b.screenshot({ path: info.outputPath("computer-highlight.png") });
    // Seed the existing encrypted browser session as if its verified OIDC callback just finished.
    const env = { PRIVACY_KEY: "e2e-privacy-key-not-secret" }, session = crypto.randomBytes(32).toString("hex"), owner = await pid(env, id);
    const hash = await keyedHash(env, "browser-session", session), data = await seal(env, owner, { user: { id, first_name: "Sync reader" }, created: Math.floor(Date.now() / 1000) });
    const sql = `CREATE TABLE IF NOT EXISTS browser_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL); INSERT INTO browser_sessions VALUES ('${hash}', '${owner}', '${data}', ${Math.floor(Date.now() / 1000) + 3600});`;
    execFileSync("npx", ["wrangler", "d1", "execute", "cyberjudah-telegram", "--local", "--persist-to", ".wrangler/e2e", "--command", sql], { cwd: new URL("../../bot", import.meta.url), stdio: "pipe" });
    // Keep the production Secure cookie intact: the local HTTP fixture sends it through
    // the test HTTP client, then returns the real Worker's authenticated response.
    const withSession = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
      const response = await route.fetch({ headers: { ...route.request().headers(), cookie: `__Host-cj-session=${session}` } });
      await route.fulfill({ response });
    };
    await c.route("**/api/firebase/*", withSession);
    // Download and Delete my data (docs/PRIVACY.md) reach this same browser session.
    await c.route("**/api/privacy/*", withSession);
    await c.goto(`${origin}/read/genesis/1`);
    await expect.poll(() => colour(c, 1)).toBe(await colour(a, 1));
    await c.screenshot({ path: info.outputPath("web-highlight.png") });
    for (const page of [a, b, c]) expect(await page.evaluate(() => localStorage.getItem("cj:bs_h_genesis_1"))).toBe(old);
    expect(await a.evaluate(() => (window as unknown as { __tg: { cloud: Record<string, string> } }).__tg.cloud.bs_h_genesis_1)).toBe(old);
    const originalColour = await colour(a, 2);
    await phone.setOffline(true); await mark(a, 1, 0); await a.keyboard.press("Escape");
    await expect.poll(() => colour(a, 1)).toBe(originalColour);
    await mark(b, 2, 4); await b.keyboard.press("Escape");
    await expect.poll(() => colour(b, 2)).not.toBe(originalColour);
    await phone.setOffline(false);
    await expect.poll(() => colour(b, 1)).toBe(originalColour);
    await expect.poll(() => colour(a, 2)).toBe(await colour(b, 2));
    await a.reload(); await expect.poll(() => colour(a, 1)).not.toBe("rgba(0, 0, 0, 0)"); expect(mints).toBe(1);
    await phone.setOffline(true); await computer.setOffline(true);
    await mark(a, 1, 1); await a.keyboard.press("Escape");
    await mark(b, 1, 4); await b.keyboard.press("Escape");
    await expect.poll(() => colour(a, 1)).toBe("rgba(255, 118, 117, 0.9)");
    await phone.setOffline(false); await expect.poll(() => colour(c, 1)).toBe("rgba(255, 118, 117, 0.9)");
    await computer.setOffline(false);
    await expect(a.getByRole("alert")).toContainText("Both saved versions are preserved");
    const saved = await request.get(`http://127.0.0.1:8089/v1/projects/demo-cyberjudah/databases/(default)/documents/users/tg_${id}/highlights`, { headers: { authorization: "Bearer owner" } });
    const revisions = (await saved.json()).documents.filter((d: any) => d.fields.history?.booleanValue).map((d: any) => d.fields.snapshot.mapValue.fields.value?.mapValue?.fields.color?.stringValue);
    expect(revisions).toEqual(expect.arrayContaining(["color2", "color5"]));
    await a.goto(`${origin}/studies${launch}`);
    await a.getByRole("button", { name: "New study", exact: true }).click();
    await a.getByLabel("Study title", { exact: true }).fill("Synced personal study");
    await a.getByRole("textbox", { name: "Writing 1", exact: true }).fill("Words kept across devices.");
    await expect(a.getByRole("status").filter({ hasText: "Saved on this device" })).toBeVisible();
    const studyUrl = a.url().split("#")[0];
    await b.goto(`${studyUrl}${launch}`); await c.goto(studyUrl);
    for (const page of [b, c]) {
      await expect(page.getByLabel("Study title", { exact: true })).toHaveValue("Synced personal study");
      await expect(page.getByRole("textbox", { name: "Writing 1", exact: true })).toHaveValue("Words kept across devices.");
    }
    // Download my data (docs/PRIVACY.md) reaches the same Firestore documents account sync writes.
    const exported = await c.evaluate(() => fetch("/api/privacy/export").then(r => r.json()));
    expect(exported.accountSync.highlights.some((h: { value?: { color?: string } }) => h.value?.color === "color2" || h.value?.color === "color5")).toBe(true);
    expect(exported.accountSync.studies.some((s: unknown) => JSON.stringify(s).includes("Synced personal study"))).toBe(true);
    expect(await a.evaluate(() => localStorage.getItem("cj:bs_h_genesis_1"))).toBe(old);
    expect(mints).toBe(1);
    // Expired launch data must not silently switch a signed-in reader back to old-key writes.
    await a.goto(`${origin}/read/genesis/1#tgWebAppData=${encodeURIComponent(signed(id, 172800))}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`);
    await expect(a.getByRole("alert")).toContainText("Sign-in expired");
    await a.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
    await mark(a, 1, 3);
    await expect(a.getByRole("alert")).toContainText("Account sync is unavailable");
    expect(await a.evaluate(() => localStorage.getItem("cj:bs_h_genesis_1"))).toBe(old);
    expect(await a.evaluate(() => (window as unknown as { __tg: { cloud: Record<string, string> } }).__tg.cloud.bs_h_genesis_1)).toBe(old);
    // Delete my data (docs/PRIVACY.md) removes the same Firestore documents, not only this device's copy.
    const deletion = await c.evaluate(() => fetch("/api/privacy/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "delete" }) }).then(r => r.json()));
    expect(deletion.ok).toBe(true);
    expect(deletion.deleted.accountSyncRecords).toBeGreaterThan(0);
    const afterDelete = await request.get(`http://127.0.0.1:8089/v1/projects/demo-cyberjudah/databases/(default)/documents/users/tg_${id}/highlights`, { headers: { authorization: "Bearer owner" } });
    expect((await afterDelete.json()).documents ?? []).toEqual([]);
    // Deletion also signs this browser out, so its old session can no longer read anything.
    expect(await c.evaluate(() => fetch("/api/privacy/export").then(r => r.status))).toBe(401);
    const reExported = await request.get(`${origin}/api/privacy/export`, { headers: { authorization: `tma ${signed(id)}` } });
    expect((await reExported.json()).accountSync).toBeNull();

  } finally { await phone.close(); await computer.close(); await web.close(); }
});
