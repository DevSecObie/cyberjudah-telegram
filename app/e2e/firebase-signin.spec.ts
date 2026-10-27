import { expect, test, type Page } from "@playwright/test";

test.skip(!!process.env.PLAYWRIGHT_BASE_URL, "local sign-in and credit fixtures only");
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });
const claims = (uid: string) => ({ sub: uid, user_id: uid, aud: "cyberjudah-app", iss: "https://securetoken.google.com/cyberjudah-app", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600, auth_time: Math.floor(Date.now()/1000), firebase: { sign_in_provider: "password" } });
const tokens = new Map<string,string>();
const token = (uid: string) => { if (!tokens.has(uid)) tokens.set(uid, `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims(uid))).toString('base64url')}.fixture`); return tokens.get(uid)!; };
async function fixture(page: Page) {
  let current = "firebase-alice", linked = false, telegram = true, posted = "", reported = false;
  await page.route("https://telegram.org/**", r => r.fulfill({ body: "" }));
  await page.route("https://securetoken.googleapis.com/**", r => r.fulfill({ json: { access_token:token(current), id_token:token(current), refresh_token:`refresh-${current}`, expires_in:"3600", token_type:"Bearer", user_id:current, project_id:"cyberjudah-app" } }));
  await page.route("https://identitytoolkit.googleapis.com/**", async r => {
    const body = r.request().postDataJSON() ?? {};
    if (r.request().url().includes("signInWithPassword")) {
      current = body.email.startsWith("bob") ? "firebase-bob" : "firebase-alice";
      return r.fulfill({ json: { localId: current, email: body.email, displayName: current, idToken: token(current), refreshToken: `refresh-${current}`, expiresIn: "3600", registered: true } });
    }
    if (r.request().url().includes("accounts:lookup")) return r.fulfill({ json: { users: [{ localId: current, email: `${current}@example.test`, emailVerified: true, displayName: current, providerUserInfo: [{ providerId:"password", federatedId:`${current}@example.test`, email:`${current}@example.test` }], lastLoginAt: String(Date.now()), createdAt: String(Date.now()-86400000), validSince:"1" }] } });
    return r.fulfill({ json: { projectId:"cyberjudah-app", authorizedDomains:["127.0.0.1","localhost"] } });
  });
  await page.route("**/api/auth/status", r => {
    const bearer = r.request().headers().authorization;
    const id = bearer?.includes(token(current).split('.')[1]) ? current === "firebase-alice" ? 77 : 88 : 77;
    return r.fulfill({ json: bearer ? { available:true, firebaseUid:current, provider:"firebase", telegramLinked:linked, user:linked ? {id,first_name:current}:null } : { available:true, user:telegram ? {id:77,first_name:"Telegram reader"}:null } });
  });
  await page.route("**/api/firebase/link", r => {
    expect(r.request().headers().authorization).toBeUndefined();
    expect(r.request().postDataJSON().idToken).toBe(token(current));
    linked = true; return r.fulfill({json:{ok:true,uid:current}});
  });
  await page.route("**/api/auth/logout", r => { telegram = false; return r.fulfill({json:{ok:true}}); });
  await page.route("**/api/study-backup", r => r.fulfill({json:{revision:0,updated:null,archive:null}}));
  await page.route("**/api/ask/account?*", r => r.fulfill({json:{ok:true,metered:true,wallet:{total_mc:1000000,lots:[]},models:[{id:"anthropic/claude-sonnet-5",name:"Claude",provider:"Anthropic",typical_mc:100,max_mc:1000}],model:"anthropic/claude-sonnet-5",confirm_above_mc:1000000,sale:{open:false,topups:[],usd_per_star:0.013},remind:{on:false}}}));
  await page.route("**/api/ask", r => {
    posted = r.request().headers().authorization ?? "";
    expect(posted).toBe(`Bearer ${token(current)}`);
    return r.fulfill({contentType:"application/x-ndjson",body:JSON.stringify({delta:`Private answer for ${current}.`})+"\n"+JSON.stringify({done:true})+"\n"});
  });
  await page.route("**/api/report", r => {
    expect(r.request().headers().authorization).toBe(`Bearer ${token(current)}`);
    const body = r.request().postDataJSON();
    expect(Object.keys(body).sort()).toEqual(["chat","kind","reason","turn"]);
    expect(body.kind).toBe("ask"); expect(body.reason).toBe("harmful");
    reported = true; return r.fulfill({json:{ok:true}});
  });
  await page.addInitScript(() => { localStorage.setItem("cj:ai-consent", '["Anthropic"]'); localStorage.setItem("cj:ask-model","anthropic/claude-sonnet-5"); });
  return { posted:()=>posted, reported:()=>reported };
}

test("email sign-in links an existing account, sends its Firebase token to paid Ask, and signs out cleanly", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/settings/account");
  await expect(page.getByRole("button",{name:"Sign in with Google",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Sign in with Apple",exact:true})).toBeVisible();
  await page.getByLabel("Email",{exact:true}).fill("alice@example.test");
  await page.getByLabel("Password",{exact:true}).fill("not-a-real-password");
  await page.getByRole("button",{name:"Sign in with email",exact:true}).click();
  await expect(page.getByRole("button",{name:"Link this login with Telegram",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Link this login with Telegram",exact:true}).click();
  await expect(page.getByText("Accounts connected. Every linked sign-in uses the same Ask balance and chats.")).toBeVisible();
  await page.goto("/ask");
  await page.getByRole("textbox",{name:"Your question"}).fill("What is faith?");
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect(page.getByText("Private answer for firebase-alice.",{exact:true})).toBeVisible();
  expect(f.posted()).toMatch(/^Bearer /);
  await page.getByRole("button",{name:"Report this answer",exact:true}).click();
  await page.getByRole("button",{name:/Harmful or offensive/}).click();
  await expect(page.getByRole("button",{name:"Report this answer",exact:true})).toHaveText("Reported");
  expect(f.reported()).toBe(true);
  await page.goto("/settings/account");
  await page.getByRole("button",{name:"Sign out of this login",exact:true}).click();
  await expect(page.getByRole("button",{name:"Sign in with email",exact:true})).toBeVisible();
  await page.goto("/ask");
  await expect(page.getByRole("textbox",{name:"Your question"})).toBeDisabled();
  await expect(page.getByText("Private answer for firebase-alice.",{exact:true})).toHaveCount(0);
});
