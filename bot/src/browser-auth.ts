import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "./env";
import type { InitData, TelegramUser } from "./initdata.mjs";
import { keyedHash, open, pid, seal } from "./privacy.mjs";

const SESSION = "__Host-cj-session", LOGIN = "__Host-cj-login";
const issuer = "https://oauth.telegram.org";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const cookieOptions = { secure: true, httpOnly: true, sameSite: "Lax" as const, path: "/" };
const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, "0")).join("");
const configured = (env: Env) => !!(env.TELEGRAM_LOGIN_CLIENT_ID && env.TELEGRAM_LOGIN_CLIENT_SECRET && env.PRIVACY_KEY);
const loginEvent = (result: string) => console.info(JSON.stringify({ event: "browser_login", result }));
async function schema(env: Env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS browser_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS browser_sessions_owner ON browser_sessions(owner)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS browser_sessions_expires ON browser_sessions(expires)").run();
}

/** OIDC's opaque sub is NOT the Telegram numeric user id. Only the verified profile id is used. */
export function telegramProfile(claims: JWTPayload): TelegramUser {
  const id = typeof claims.id === "string" && /^[1-9][0-9]{0,15}$/.test(claims.id) ? Number(claims.id) : claims.id;
  const name = typeof claims.name === "string" ? claims.name : claims.given_name;
  if (!Number.isSafeInteger(id) || Number(id) <= 0) throw Object.assign(new Error("Telegram profile unavailable"), { code: claims.id == null ? "profile-id-missing" : "profile-id-invalid" });
  if (typeof name !== "string") throw Object.assign(new Error("Telegram profile unavailable"), { code: "profile-name" });
  return { id: Number(id), first_name: name.slice(0, 120), ...(typeof claims.preferred_username === "string" ? { username: claims.preferred_username.slice(0, 64) } : {}) };
}

export async function browserSession(request: Request, env: Env): Promise<InitData | null> {
  if (!configured(env)) return null;
  const token = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith(`${SESSION}=`))?.slice(SESSION.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  // Cookie credentials are only accepted for same-origin mutations; Telegram's signed
  // authorization header continues to work independently of cookies.
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) return null;
  await schema(env);
  const row = await env.DB.prepare("SELECT owner,sealed FROM browser_sessions WHERE token_hash=? AND expires>?").bind(await keyedHash(env, "browser-session", token), Math.floor(Date.now() / 1000)).first<{ owner: string; sealed: string }>();
  if (!row) return null;
  const data = await open(env, row.owner, row.sealed) as { user?: TelegramUser; created?: number } | null;
  if (!data?.user || !data.created) return null;
  return { user: data.user, auth_date: data.created, hash: "browser-session" };
}
export async function revokeBrowserSessions(env: Env, uid: number) { await schema(env); await env.DB.prepare("DELETE FROM browser_sessions WHERE owner=?").bind(await pid(env, uid)).run(); }

export const browserAuth = new Hono<{ Bindings: Env }>();
browserAuth.use("*", async (c, next) => { c.header("cache-control", "no-store"); c.header("referrer-policy", "no-referrer"); await next(); });
browserAuth.get("/status", async c => {
  const session = await browserSession(c.req.raw, c.env);
  return c.json({ available: configured(c.env), user: session?.user ?? null });
});
browserAuth.get("/start", async c => {
  if (!configured(c.env)) return c.json({ error: "Telegram sign-in is not available yet." }, 503);
  const state = random(), verifier = random(), nonce = random();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sealed = await seal(c.env, "browser-login", { state, verifier, nonce, created: Date.now() });
  setCookie(c, LOGIN, sealed, { ...cookieOptions, maxAge: 600 });
  const callback = `${new URL(c.req.url).origin}/api/auth/callback`;
  const params = new URLSearchParams({ client_id: c.env.TELEGRAM_LOGIN_CLIENT_ID!, redirect_uri: callback, response_type: "code", scope: "openid profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" });
  loginEvent("started");
  return c.redirect(`${issuer}/auth?${params}`);
});
browserAuth.get("/callback", async c => {
  const encoded = getCookie(c, LOGIN);
  deleteCookie(c, LOGIN, cookieOptions);
  if (!configured(c.env)) return c.redirect("/app/settings/account?login=unavailable");
  let failure = encoded ? "state" : "cookie";
  try {
    const pending = await open(c.env, "browser-login", encoded ?? null) as { state: string; verifier: string; nonce: string; created: number } | null;
    const code = c.req.query("code");
    if (!encoded?.startsWith("s1.") || !pending || !code || code.length > 4096 || c.req.query("state") !== pending.state || Date.now() - pending.created > 600_000 || pending.created > Date.now()) throw new Error("Invalid login state");
    failure = "exchange";
    const response = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${c.env.TELEGRAM_LOGIN_CLIENT_ID}:${c.env.TELEGRAM_LOGIN_CLIENT_SECRET}`)}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${new URL(c.req.url).origin}/api/auth/callback`, client_id: c.env.TELEGRAM_LOGIN_CLIENT_ID!, code_verifier: pending.verifier }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Token exchange failed");
    failure = "token";
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) throw new Error("Missing token");
    failure = "claims";
    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer, audience: c.env.TELEGRAM_LOGIN_CLIENT_ID, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "10m", clockTolerance: 30 });
    failure = "nonce";
    if (payload.nonce !== pending.nonce) throw new Error("Invalid nonce");
    failure = "profile";
    const user = telegramProfile(payload), token = random(), owner = await pid(c.env, user.id), created = Math.floor(Date.now() / 1000);
    failure = "storage";
    await schema(c.env);
    const previous = getCookie(c, SESSION);
    if (previous) await c.env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash=?").bind(await keyedHash(c.env, "browser-session", previous)).run();
    await c.env.DB.prepare("DELETE FROM browser_sessions WHERE expires<=?").bind(created).run();
    await c.env.DB.prepare("INSERT INTO browser_sessions(token_hash,owner,sealed,expires) VALUES(?,?,?,?)").bind(await keyedHash(c.env, "browser-session", token), owner, await seal(c.env, owner, { user, created }), created + 86400).run();
    setCookie(c, SESSION, token, { ...cookieOptions, maxAge: 86400 });
    loginEvent("completed");
    return c.redirect("/app/settings/account");
  } catch (error) {
    // Only bounded stage/claim names leave the server, never codes, tokens or error messages.
    const claim = (error as { claim?: unknown })?.claim;
    if (failure === "claims" && typeof claim === "string" && ["iss", "aud", "exp", "iat", "sub", "nonce"].includes(claim)) failure += `-${claim}`;
    const code = (error as { code?: unknown })?.code;
    if (failure === "profile" && typeof code === "string" && ["profile-id-missing", "profile-id-invalid", "profile-name"].includes(code)) failure = code;
    loginEvent(failure);
    return c.redirect(`/app/settings/account?login=failed&reason=${failure}`);
  }
});
browserAuth.post("/logout", async c => {
  if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "Invalid origin" }, 403);
  const token = getCookie(c, SESSION);
  if (token) { await schema(c.env); await c.env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash=?").bind(await keyedHash(c.env, "browser-session", token)).run(); }
  deleteCookie(c, SESSION, cookieOptions);
  return c.json({ ok: true });
});
