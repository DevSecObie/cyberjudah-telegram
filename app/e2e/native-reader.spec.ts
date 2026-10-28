import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test.skip(process.env.CYBERJUDAH_TEST_NATIVE_READER !== "1", "Requires the native build profile");

test("the real Worker serves public reading search without an account and keeps private routes locked", async ({ request }) => {
  execFileSync("npx", ["wrangler", "d1", "execute", "cyberjudah-telegram", "--local", "--persist-to", ".wrangler/e2e", "--command", "CREATE VIRTUAL TABLE IF NOT EXISTS search_docs USING fts5(kind UNINDEXED,title,url UNINDEXED,sub UNINDEXED,text,book UNINDEXED,chapter UNINDEXED); DELETE FROM search_docs WHERE url='/bible/john/3#v16'; INSERT INTO search_docs(kind,title,text,url,sub) VALUES('verse','John 3:16','For God so loved the world','/bible/john/3#v16','KJV');"], { cwd: new URL("../../bot", import.meta.url), stdio: "pipe" });
  const response = await request.get('/api/reader/search?q=%22God%20so%20loved%22&only=verse');
  expect(response.status()).toBe(200);
  expect((await response.json()).hits).toEqual(expect.arrayContaining([expect.objectContaining({ title: "John 3:16" })]));
  expect((await request.get('/api/search?q=God')).status()).toBe(401);
  expect((await request.post('/api/ask', { data: { q: 'God' } })).status()).toBe(401);
  expect((await request.post('/api/reader/ask', { data: { q: 'God' } })).status()).toBe(405);
  expect((await request.get('/api/reader/ask/account')).status()).toBe(404);
});

test("native reading stays free and linked-account Ask is discoverable without purchase controls", async ({ page }, testInfo) => {
  const purchases: string[] = [];
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  page.on("request", r => { if (/\/api\/(ask\/buy|invoice|donations)([/?]|$)/.test(r.url())) purchases.push(r.url()); });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ask CyberJudah", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Main menu", exact: true }).click();
  await expect(page.getByRole("link", { name: "Ask CyberJudah", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Support CyberJudah", exact: true })).toHaveCount(0);
  await page.goto("/settings/account");
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in securely", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Export all personal studies/ })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export all personal studies/ }).click();
  expect((await download).suggestedFilename()).toBe("cyberjudah-personal-studies.json");
  await page.screenshot({ path: testInfo.outputPath("linked-account-native.png") });
  expect(purchases).toEqual([]);
});

test("native Ask requires sign-in while unavailable donation and admin routes remain gated", async ({ page }) => {
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  await page.goto("/ask?q=John%203");
  await expect(page.getByRole("textbox", { name: "Your question" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  for (const path of ["/settings/donate", "/settings/reminders", "/settings/admin"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Free reading and study", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the Bible", exact: true })).toBeVisible();
  }
});

test("native linked-account view can report an answer without leaving the app", async ({ page }, info) => {
  // UI contract only: server ownership and token checks run in account-links.test.mjs.
  let reported = false;
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  await page.route("**/api/auth/status", r => r.fulfill({json:{available:true,user:{id:77,first_name:"Reader"},provider:"firebase",firebaseUid:"fixture-reader",telegramLinked:true}}));
  await page.route("**/api/ask/account?*", r => r.fulfill({json:{ok:true,metered:true,wallet:{total_mc:1000000,lots:[]},models:[{id:"anthropic/claude-sonnet-5",name:"Claude",provider:"Anthropic",typical_mc:100,max_mc:1000}],model:"anthropic/claude-sonnet-5",confirm_above_mc:1000000,sale:{open:false,topups:[],usd_per_star:0.013},remind:{on:false}}}));
  await page.route("**/api/ask", r => r.fulfill({contentType:"application/x-ndjson",body:'{"delta":"Synthetic native answer."}\n{"done":true}\n'}));
  await page.route("**/api/report", r => {
    const body = r.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["chat","kind","reason","turn"]);
    expect(body.reason).toBe("harmful"); reported=true;
    return r.fulfill({json:{ok:true}});
  });
  await page.addInitScript(() => { localStorage.setItem("cj:ai-consent", '["Anthropic"]'); localStorage.setItem("cj:ask-model","anthropic/claude-sonnet-5"); });
  await page.goto("/ask");
  await page.getByRole("textbox",{name:"Your question"}).fill("Synthetic question");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByText("Synthetic native answer.",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Report this answer",exact:true}).click();
  await page.getByRole("button",{name:/Harmful or offensive/}).click();
  await expect(page.getByRole("button",{name:"Report this answer",exact:true})).toHaveText("Reported");
  expect(reported).toBe(true);
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.locator(".sheet[data-actions]")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("native-answer-report.png")});
});

test("native keyword search does not call AI even when a query is submitted", async ({ page }) => {
  const ai: string[] = [];
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  page.on("request", r => { if (/\/api\/(ask|search\/answer)([/?]|$)/.test(r.url())) ai.push(r.url()); });
  await page.route("**/api/reader/search?*", r => r.fulfill({ json: { ok: true, q: "Passover", mode: "strict", counts: {}, hits: [] } }));
  await page.route("**/api/reader/teachings?*", r => r.fulfill({ json: { ok: true, q: "Passover", more: false, hits: [] } }));
  await page.goto("/search?q=Passover");
  await expect(page.locator("#q")).toHaveValue("Passover");
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText("0 results for Passover");
  await expect(page.getByText("Ask CyberJudah", { exact: true })).toHaveCount(0);
  await expect(page.locator(".search-ai")).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Support CyberJudah/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Credits Narrators, recordings and licences" })).toBeVisible();
  expect(ai).toEqual([]);
});


test("native audio offers recordings and device voices without authenticated AI calls", async ({ page }) => {
  const generated: string[] = [];
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  page.on("request", r => { if (/\/api\/(voices|tts|me)([/?]|$)/.test(r.url())) generated.push(r.url()); });
  await page.addInitScript(() => localStorage.setItem("ttsVoice", "ai:asteria"));
  await page.goto("/settings/audio");
  await expect(page.getByRole("heading", { name: "Audio settings", exact: true })).toBeVisible();
  await expect(page.getByText("Licensed narrators and this device’s own voices", { exact: true })).toBeVisible();
  await expect(page.getByText("Generated voices", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Voice Licensed narrators/ }).click();
  await expect(page.getByRole("heading", { name: "Device voices", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI reading voices", exact: true })).toHaveCount(0);
  expect(generated).toEqual([]);
});
