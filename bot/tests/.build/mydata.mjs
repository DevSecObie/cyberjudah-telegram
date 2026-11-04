// src/account-links.ts
import { decodeJwt } from "jose";

// src/privacy.mjs
var enc = new TextEncoder();
var dec = new TextDecoder();
var b64url = (b) => {
  const bytes = new Uint8Array(b);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
var rootOf = (env) => env.PRIVACY_KEY || env.BOT_TOKEN || "";
var roots = /* @__PURE__ */ new Map();
function root(env) {
  const secret = rootOf(env);
  if (!secret) throw new Error("No PRIVACY_KEY or BOT_TOKEN to derive keys from");
  let k = roots.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey", "deriveBits"]);
    roots.set(secret, k);
  }
  return k;
}
var salt = enc.encode("cyberjudah-privacy-v1");
var pids = /* @__PURE__ */ new Map();
async function pid(env, uid) {
  const cacheKey = JSON.stringify([rootOf(env), String(uid)]);
  const hit = pids.get(cacheKey);
  if (hit) return hit;
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`pid:tg:${uid}`) }, await root(env), 128);
  const id2 = b64url(bits);
  if (pids.size > 5e3) pids.clear();
  pids.set(cacheKey, id2);
  return id2;
}
var macKeys = /* @__PURE__ */ new Map();
async function keyedHash(env, purpose, value) {
  const cacheKey = JSON.stringify([rootOf(env), purpose]);
  let k = macKeys.get(cacheKey);
  if (!k) {
    k = crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`mac:${purpose}`) }, await root(env), { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
    macKeys.set(cacheKey, k);
  }
  const sig = await crypto.subtle.sign("HMAC", await k, enc.encode(String(value)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sealKey(env, owner) {
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`seal:${owner}`) }, await root(env), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(env, owner, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env, owner), enc.encode(JSON.stringify(value)));
  return `s1.${b64url(iv)}.${b64url(ct)}`;
}
async function open(env, owner, stored) {
  if (stored == null) return null;
  if (!stored.startsWith("s1.")) {
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }
  const [, iv, ct] = stored.split(".");
  try {
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv) }, await sealKey(env, owner), fromB64url(ct))));
  } catch {
    return null;
  }
}

// src/account-links.ts
var FIREBASE_PROJECT = "cyberjudah-app";
var API_KEY = "AIzaSyAqCIfm78KkoFq0UOszT5YJdpvD6jWqG9U";
var IdentityError = class extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
};
var validFirebaseUid = (uid) => typeof uid === "string" && uid.length > 0 && uid.length <= 128 && uid !== "." && uid !== ".." && !/[\u0000-\u001f/]/.test(uid);
async function verifyFirebaseIdentity(token, recent = false) {
  if (!token || token.length > 16384) throw new IdentityError(401, "invalid_firebase_identity");
  let claims;
  try {
    claims = decodeJwt(token);
  } catch {
    throw new IdentityError(401, "invalid_firebase_identity");
  }
  const now = Math.floor(Date.now() / 1e3), time = claims.auth_time;
  if (claims.aud !== FIREBASE_PROJECT || claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT}` || !validFirebaseUid(claims.sub) || typeof claims.exp !== "number" || claims.exp <= now || typeof claims.iat !== "number" || claims.iat > now || typeof time !== "number" || time > now || time <= 0 || claims.firebase?.sign_in_provider === "anonymous") throw new IdentityError(401, "invalid_firebase_identity");
  if (recent && now - time > 300) throw new IdentityError(401, "recent_sign_in_required");
  let response;
  try {
    response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      // Workers does not implement redirect:"error". Reject manual redirect responses
      // below so the identity token can never be forwarded to another endpoint.
      signal: AbortSignal.timeout(1e4),
      redirect: "manual"
    });
  } catch {
    throw new IdentityError(503, "identity_service_unavailable");
  }
  if (!response.ok) {
    if ([400, 401, 403].includes(response.status)) throw new IdentityError(401, "firebase_sign_in_required");
    throw new IdentityError(503, "identity_service_unavailable");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new IdentityError(503, "identity_service_unavailable");
  }
  const user = result.users?.length === 1 ? result.users[0] : void 0;
  const validSince = Number(user?.validSince);
  if (!user || user.localId !== claims.sub || user.disabled || !Number.isFinite(validSince) || time < validSince) throw new IdentityError(401, "firebase_sign_in_required");
  return { uid: claims.sub, name: typeof user.displayName === "string" ? user.displayName.slice(0, 120) : "CyberJudah reader", authTime: time };
}
async function schema(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS account_links (firebase_uid TEXT PRIMARY KEY, telegram_owner TEXT NOT NULL UNIQUE, sealed TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
}
async function linkedTelegram(env, uid) {
  await schema(env);
  const row = await env.DB.prepare("SELECT firebase_uid,telegram_owner,sealed FROM account_links WHERE firebase_uid=?").bind(uid).first();
  if (!row) return null;
  const value = await open(env, row.telegram_owner, row.sealed);
  if (!value?.id || !Number.isSafeInteger(value.id) || value.id <= 0 || await pid(env, value.id) !== row.telegram_owner) throw new IdentityError(503, "account_link_unavailable");
  return value.id;
}
async function linkedFirebase(env, id2) {
  await schema(env);
  return (await env.DB.prepare("SELECT firebase_uid FROM account_links WHERE telegram_owner=?").bind(await pid(env, id2)).first())?.firebase_uid ?? null;
}
async function linkAccounts(env, id2, firebaseUid) {
  if (!Number.isSafeInteger(id2) || id2 <= 0 || !validFirebaseUid(firebaseUid) || /^tg_/.test(firebaseUid) && firebaseUid !== `tg_${id2}`) throw new IdentityError(409, "account_link_conflict");
  await schema(env);
  const owner = await pid(env, id2), sealed = await seal(env, owner, { id: id2 });
  await env.DB.prepare("UPDATE OR IGNORE account_links SET firebase_uid=? WHERE telegram_owner=? AND firebase_uid=?").bind(firebaseUid, owner, `tg_${id2}`).run();
  await env.DB.prepare("INSERT OR IGNORE INTO account_links (firebase_uid,telegram_owner,sealed,created_at) VALUES (?,?,?,?)").bind(firebaseUid, owner, sealed, Date.now()).run();
  if (await linkedTelegram(env, firebaseUid) !== id2 || await linkedFirebase(env, id2) !== firebaseUid) throw new IdentityError(409, "account_link_conflict");
}
async function removeAccountLink(env, id2) {
  await schema(env);
  await env.DB.prepare("DELETE FROM account_links WHERE telegram_owner=?").bind(await pid(env, id2)).run();
}

// src/firebase-auth.ts
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { importPKCS8, SignJWT } from "jose";

// src/initdata.mjs
var enc2 = new TextEncoder();
async function hmac(key2, data) {
  const k = await crypto.subtle.importKey("raw", key2, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc2.encode(data) : data));
}
var hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function sameHex(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
var LAUNCH_DATA_MAX_AGE = 30 * 86400;
var SENSITIVE_MAX_AGE = 86400;
async function validateInitData(initData, botToken, maxAgeSec = 86400, now = Date.now()) {
  if (typeof initData !== "string" || !initData || typeof botToken !== "string" || !botToken) return null;
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const lines = [];
  for (const [k, v] of params) if (k !== "hash") lines.push(`${k}=${v}`);
  lines.sort();
  const secret = await hmac(enc2.encode("WebAppData"), botToken);
  const expected = hex(await hmac(secret, lines.join("\n")));
  if (!sameHex(expected, hash)) return null;
  const auth_date = Number(params.get("auth_date"));
  if (!Number.isFinite(auth_date) || auth_date <= 0) return null;
  const ageSec = now / 1e3 - auth_date;
  if (ageSec < -30 || ageSec > maxAgeSec) return null;
  const out = { auth_date, hash };
  for (const [k, v] of params) {
    if (k === "hash" || k === "auth_date") continue;
    if (k === "user" || k === "receiver" || k === "chat") {
      try {
        out[k] = JSON.parse(v);
      } catch {
        return null;
      }
    } else out[k] = v;
  }
  return out;
}

// src/firebase-auth.ts
var AUDIENCE = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";
var PROJECT = "cyberjudah-app";
function telegramFirebaseUid(id2) {
  if (typeof id2 !== "number" || !Number.isSafeInteger(id2) || id2 <= 0) throw new Error("Invalid Telegram identity");
  return `tg_${id2}`;
}
var firebaseAuth = new Hono();
firebaseAuth.use("/link", bodyLimit({ maxSize: 18e3, onError: (c) => c.json({ error: "invalid_link_request" }, 413) }));
firebaseAuth.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  const raw = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i)?.[1];
  if (raw && raw.length > 16384) return c.json({ error: "telegram_sign_in_required" }, 401);
  const params = new URLSearchParams(raw ?? "");
  if (new Set(params.keys()).size !== [...params].length) return c.json({ error: "invalid_telegram_identity" }, 401);
  const data = raw ? await validateInitData(raw, c.env.BOT_TOKEN, SENSITIVE_MAX_AGE) : await browserSession(c.req.raw, c.env);
  let fallback;
  try {
    fallback = telegramFirebaseUid(data?.user?.id);
  } catch {
    return c.json({ error: "invalid_telegram_identity", message: "Reopen the app from Telegram to sign in." }, 401);
  }
  c.set("telegramId", data.user.id);
  c.set("telegramAuthTime", data.auth_date);
  try {
    c.set("firebaseUid", c.env.DB ? await linkedFirebase(c.env, data.user.id) ?? fallback : fallback);
  } catch {
    return c.json({ error: "account_link_unavailable" }, 503);
  }
  await next();
});
firebaseAuth.post("/identity", (c) => c.json({ uid: c.get("firebaseUid") }));
firebaseAuth.post("/token", async (c) => {
  if (Object.keys(c.req.query()).length || (await c.req.text()).length > 0) return c.json({ error: "unexpected_sign_in_parameters" }, 400);
  if (!c.env.FIREBASE_SERVICE_ACCOUNT || !c.env.FIREBASE_AUTH_LIMIT) return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  const uid = c.get("firebaseUid");
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key: uid })).success) return c.json({ error: "sign_in_rate_limited", message: "Please wait a minute and try again." }, 429);
  try {
    const token = await mintFirebaseToken(c.env, uid);
    if (c.env.DB) await linkAccounts(c.env, c.get("telegramId"), uid);
    return c.json({ uid, token });
  } catch {
    return c.json({ error: "firebase_sign_in_unavailable" }, 503);
  }
});
async function mintFirebaseToken(env, uid) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new IdentityError(503, "firebase_sign_in_unavailable");
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  if (account.type !== "service_account" || account.project_id !== PROJECT || typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT}.iam.gserviceaccount.com`) || typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
  const key2 = await importPKCS8(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1e3);
  return await new SignJWT({ uid }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(account.client_email).setSubject(account.client_email).setAudience(AUDIENCE).setIssuedAt(now).setExpirationTime(now + 3600).sign(key2);
}
firebaseAuth.post("/link", async (c) => {
  if (Math.floor(Date.now() / 1e3) - c.get("telegramAuthTime") > 300) return c.json({ error: "recent_telegram_sign_in_required" }, 401);
  if (!c.env.FIREBASE_AUTH_LIMIT || !c.env.PRIVACY_KEY) return c.json({ error: "account_link_unavailable" }, 503);
  if (!(await c.env.FIREBASE_AUTH_LIMIT.limit({ key: `link:${c.get("telegramId")}` })).success) return c.json({ error: "sign_in_rate_limited" }, 429);
  if (Number(c.req.header("content-length") ?? 0) > 18e3) return c.json({ error: "invalid_link_request" }, 400);
  const raw = await c.req.text();
  if (raw.length > 18e3) return c.json({ error: "invalid_link_request" }, 400);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_link_request" }, 400);
  }
  if (!body || typeof body.idToken !== "string" || Object.keys(body).some((k) => k !== "idToken")) return c.json({ error: "invalid_link_request" }, 400);
  try {
    const identity = await verifyFirebaseIdentity(body.idToken, true);
    await linkAccounts(c.env, c.get("telegramId"), identity.uid);
    return c.json({ ok: true, uid: identity.uid });
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "account_link_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
});
async function firebaseAccount(request, env, recent = false) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  if (!env.FIREBASE_SESSION_LIMIT || !env.PRIVACY_KEY) throw new IdentityError(503, "firebase_sign_in_unavailable");
  const key2 = await keyedHash(env, "firebase-session-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
  if (!(await env.FIREBASE_SESSION_LIMIT.limit({ key: key2 })).success) throw new IdentityError(429, "sign_in_rate_limited");
  const identity = await verifyFirebaseIdentity(header.slice(7), recent);
  const id2 = await linkedTelegram(env, identity.uid);
  return { identity, user: id2 ? { id: id2, first_name: identity.name } : null };
}

// src/browser-auth.ts
import { Hono as Hono2 } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";
var SESSION = "__Host-cj-session";
var LOGIN = "__Host-cj-login";
var issuer = "https://oauth.telegram.org";
var jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
var cookieOptions = { secure: true, httpOnly: true, sameSite: "Lax", path: "/" };
var random = () => [...crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, "0")).join("");
var configured = (env) => !!(env.TELEGRAM_LOGIN_CLIENT_ID && env.TELEGRAM_LOGIN_CLIENT_SECRET && env.PRIVACY_KEY);
var loginEvent = (result) => console.info(JSON.stringify({ event: "browser_login", result }));
async function schema2(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS browser_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, sealed TEXT NOT NULL, expires INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS browser_sessions_owner ON browser_sessions(owner)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS browser_sessions_expires ON browser_sessions(expires)").run();
}
function telegramProfile(claims) {
  const id2 = typeof claims.id === "string" && /^[1-9][0-9]{0,15}$/.test(claims.id) ? Number(claims.id) : claims.id;
  const name = typeof claims.name === "string" ? claims.name : claims.given_name;
  if (!Number.isSafeInteger(id2) || Number(id2) <= 0) throw Object.assign(new Error("Telegram profile unavailable"), { code: claims.id == null ? "profile-id-missing" : "profile-id-invalid" });
  if (typeof name !== "string") throw Object.assign(new Error("Telegram profile unavailable"), { code: "profile-name" });
  return { id: Number(id2), first_name: name.slice(0, 120), ...typeof claims.preferred_username === "string" ? { username: claims.preferred_username.slice(0, 64) } : {} };
}
async function browserSession(request, env) {
  if (!configured(env)) return null;
  const token = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${SESSION}=`))?.slice(SESSION.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) return null;
  await schema2(env);
  const row = await env.DB.prepare("SELECT owner,sealed FROM browser_sessions WHERE token_hash=? AND expires>?").bind(await keyedHash(env, "browser-session", token), Math.floor(Date.now() / 1e3)).first();
  if (!row) return null;
  const data = await open(env, row.owner, row.sealed);
  if (!data?.user || !data.created) return null;
  return { user: data.user, auth_date: data.created, hash: "browser-session" };
}
async function revokeBrowserSessions(env, uid) {
  await schema2(env);
  await env.DB.prepare("DELETE FROM browser_sessions WHERE owner=?").bind(await pid(env, uid)).run();
}
var browserAuth = new Hono2();
browserAuth.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("referrer-policy", "no-referrer");
  await next();
});
browserAuth.get("/status", async (c) => {
  try {
    const firebase = await firebaseAccount(c.req.raw, c.env);
    if (firebase) return c.json({ available: configured(c.env), user: firebase.user, firebaseUid: firebase.identity.uid, telegramLinked: !!firebase.user, provider: "firebase" });
    const session = await browserSession(c.req.raw, c.env);
    return c.json({ available: configured(c.env), user: session?.user ?? null });
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "sign_in_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
});
browserAuth.get("/start", async (c) => {
  if (!configured(c.env)) return c.json({ error: "Telegram sign-in is not available yet." }, 503);
  const state = random(), verifier = random(), nonce = random();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const returnTo = c.env.BIBLE_STRONG_WEB === "1" ? "/profile?telegram=returned" : "/app/settings/account";
  const sealed = await seal(c.env, "browser-login", { state, verifier, nonce, created: Date.now(), returnTo });
  setCookie(c, LOGIN, sealed, { ...cookieOptions, maxAge: 600 });
  const callback = `${new URL(c.req.url).origin}/api/auth/callback`;
  const params = new URLSearchParams({ client_id: c.env.TELEGRAM_LOGIN_CLIENT_ID, redirect_uri: callback, response_type: "code", scope: "openid profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256" });
  loginEvent("started");
  return c.redirect(`${issuer}/auth?${params}`);
});
browserAuth.get("/callback", async (c) => {
  const encoded = getCookie(c, LOGIN);
  deleteCookie(c, LOGIN, cookieOptions);
  if (!configured(c.env)) return c.redirect("/app/settings/account?login=unavailable");
  let failure = encoded ? "state" : "cookie";
  try {
    const pending = await open(c.env, "browser-login", encoded ?? null);
    const code = c.req.query("code");
    if (!encoded?.startsWith("s1.") || !pending || !code || code.length > 4096 || c.req.query("state") !== pending.state || Date.now() - pending.created > 6e5 || pending.created > Date.now()) throw new Error("Invalid login state");
    failure = "exchange";
    const response = await fetch(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${c.env.TELEGRAM_LOGIN_CLIENT_ID}:${c.env.TELEGRAM_LOGIN_CLIENT_SECRET}`)}` }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${new URL(c.req.url).origin}/api/auth/callback`, client_id: c.env.TELEGRAM_LOGIN_CLIENT_ID, code_verifier: pending.verifier }), signal: AbortSignal.timeout(15e3) });
    if (!response.ok) throw new Error("Token exchange failed");
    failure = "token";
    const tokens2 = await response.json();
    if (!tokens2.id_token) throw new Error("Missing token");
    failure = "claims";
    const { payload } = await jwtVerify(tokens2.id_token, jwks, { issuer, audience: c.env.TELEGRAM_LOGIN_CLIENT_ID, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "10m", clockTolerance: 30 });
    failure = "nonce";
    if (payload.nonce !== pending.nonce) throw new Error("Invalid nonce");
    failure = "profile";
    const user = telegramProfile(payload), token = random(), owner = await pid(c.env, user.id), created = Math.floor(Date.now() / 1e3);
    failure = "storage";
    await schema2(c.env);
    const previous = getCookie(c, SESSION);
    if (previous) await c.env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash=?").bind(await keyedHash(c.env, "browser-session", previous)).run();
    await c.env.DB.prepare("DELETE FROM browser_sessions WHERE expires<=?").bind(created).run();
    await c.env.DB.prepare("INSERT INTO browser_sessions(token_hash,owner,sealed,expires) VALUES(?,?,?,?)").bind(await keyedHash(c.env, "browser-session", token), owner, await seal(c.env, owner, { user, created }), created + 86400).run();
    setCookie(c, SESSION, token, { ...cookieOptions, maxAge: 86400 });
    loginEvent("completed");
    return c.redirect(c.env.BIBLE_STRONG_WEB === "1" && pending.returnTo === "/profile?telegram=returned" ? pending.returnTo : "/app/settings/account");
  } catch (error) {
    const claim2 = error?.claim;
    if (failure === "claims" && typeof claim2 === "string" && ["iss", "aud", "exp", "iat", "sub", "nonce"].includes(claim2)) failure += `-${claim2}`;
    const code = error?.code;
    if (failure === "profile" && typeof code === "string" && ["profile-id-missing", "profile-id-invalid", "profile-name"].includes(code)) failure = code;
    loginEvent(failure);
    return c.redirect(`/app/settings/account?login=failed&reason=${failure}`);
  }
});
browserAuth.post("/logout", async (c) => {
  if (c.req.header("origin") !== new URL(c.req.url).origin) return c.json({ error: "Invalid origin" }, 403);
  const token = getCookie(c, SESSION);
  if (token) {
    await schema2(c.env);
    await c.env.DB.prepare("DELETE FROM browser_sessions WHERE token_hash=?").bind(await keyedHash(c.env, "browser-session", token)).run();
  }
  deleteCookie(c, SESSION, cookieOptions);
  return c.json({ ok: true });
});

// ../shared/studies.ts
import { z } from "zod";
var id = z.string().uuid();
var text = z.string().max(4e4);
var studyBlock = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("text"), text }),
  z.object({ id, kind: z.literal("scripture"), book: z.string().regex(/^[a-z0-9-]+$/).max(80), chapter: z.number().int().min(1).max(150), reference: z.string().max(160), verses: z.array(z.object({ verse: z.number().int().min(1).max(200), text })).min(1).max(200) }),
  z.object({ id, kind: z.literal("strongs"), number: z.string().regex(/^[HG][1-9]\d{0,4}$/), lemma: z.string().max(300), definition: text })
]);
var studySchema = z.object({
  version: z.literal(1),
  id,
  revision: z.number().int().nonnegative(),
  title: z.string().max(160),
  tags: z.array(z.string().max(40)).max(20),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  blocks: z.array(studyBlock).max(200)
});
var archiveSchema = z.object({ app: z.literal("cyberjudah-studies"), version: z.literal(1), studies: z.array(studySchema).max(500), annotations: z.array(z.object({ id: z.string().uuid(), verseKey: z.string().regex(/^[a-z0-9-]+$/).max(120), start: z.number().int().nonnegative(), end: z.number().int().positive(), quote: z.string().min(1).max(2e4), style: z.enum(["highlight", "underline", "circle"]), color: z.string().min(1).max(40).optional(), group: z.string().min(1).max(64).optional(), note: z.object({ title: z.string().max(500), description: z.string().max(2e4), date: z.number() }).optional(), tags: z.record(z.string().max(80), z.literal(true)).optional(), created: z.string().datetime() }).refine((a) => a.end > a.start && a.end - a.start === a.quote.length)).max(1e4) });

// src/study-backup.ts
import { Hono as Hono3 } from "hono";
import { bodyLimit as bodyLimit2 } from "hono/body-limit";
async function schema3(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS study_backups (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, sealed TEXT NOT NULL, updated TEXT NOT NULL)").run();
}
async function readStudyBackup(env, uid) {
  await schema3(env);
  const owner = await pid(env, uid);
  const record = await env.DB.prepare("SELECT revision,sealed,updated FROM study_backups WHERE owner=?").bind(owner).first();
  return record ? { revision: record.revision, updated: record.updated, archive: await open(env, owner, record.sealed) } : { revision: 0, updated: null, archive: null };
}
async function deleteStudyBackup(env, uid) {
  await schema3(env);
  await env.DB.prepare("DELETE FROM study_backups WHERE owner=?").bind(await pid(env, uid)).run();
}
var studyBackup = new Hono3();
studyBackup.use("*", bodyLimit2({ maxSize: 1e6 }));
studyBackup.use("*", async (c, next) => {
  c.header("cache-control", "no-store");
  await next();
});
studyBackup.get("/", async (c) => c.json(await readStudyBackup(c.env, c.get("tma").user.id)));
studyBackup.put("/", async (c) => {
  const payload = await c.req.json().catch(() => null);
  if (!payload || !Number.isSafeInteger(payload.revision) || payload.revision < 0 || payload.archive?.app !== "cyberjudah-studies" || payload.archive.version !== 1 || !Array.isArray(payload.archive.studies) || !Array.isArray(payload.archive.annotations)) return c.json({ error: "Invalid study backup" }, 400);
  const checked = archiveSchema.safeParse(payload.archive);
  if (!checked.success) return c.json({ error: "Invalid study archive" }, 400);
  if (!c.env.PRIVACY_KEY) return c.json({ error: "Cloud study backups are unavailable" }, 503);
  await schema3(c.env);
  const owner = await pid(c.env, c.get("tma").user.id), revision = payload.revision + 1, updated = (/* @__PURE__ */ new Date()).toISOString();
  const sealed = await seal(c.env, owner, checked.data);
  const result = payload.revision === 0 ? await c.env.DB.prepare("INSERT INTO study_backups(owner,revision,sealed,updated) VALUES(?,?,?,?) ON CONFLICT(owner) DO NOTHING").bind(owner, revision, sealed, updated).run() : await c.env.DB.prepare("UPDATE study_backups SET revision=?,sealed=?,updated=? WHERE owner=? AND revision=?").bind(revision, sealed, updated, owner, payload.revision).run();
  if (!result.meta.changes) return c.json({ error: "The cloud backup changed on another device. Reload before saving.", reason: "conflict" }, 409);
  return c.json({ revision, updated });
});

// src/chats.ts
var CHAT_ID = /^[a-z0-9]{8,40}$/;
var MAX_CHATS = 300;
var MAX_TURNS = 120;
var CHAT_TTL = 180 * 86400;
var indexKey = (owner) => `chats:${owner}`;
var chatKey = (owner, id2) => `chat:${owner}:${id2}`;
var goneKey = (owner, id2) => `chatgone:${owner}:${id2}`;
var titleOf = (q) => {
  const t = q.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 78).replace(/\s+\S*$/, "")}\u2026` : t;
};
var slim = (s) => ({ n: s.n, kind: s.kind, title: s.title, url: s.url, ...s.sub ? { sub: s.sub } : {}, ...s.video ? { video: s.video, t: s.t ?? 0 } : {}, ...s.date ? { date: s.date } : {} });
var put = async (env, owner, key2, value) => env.SUBS.put(key2, await seal(env, owner, value), { expirationTtl: CHAT_TTL });
async function moveLegacy(env, uid, owner) {
  const old = await env.SUBS.get(`chats:${uid}`, "json");
  if (!old) return null;
  for (const c of old) {
    const chat = await env.SUBS.get(`chat:${uid}:${c.id}`);
    if (chat) await put(env, owner, chatKey(owner, c.id), JSON.parse(chat));
    await env.SUBS.delete(`chat:${uid}:${c.id}`);
  }
  await put(env, owner, indexKey(owner), old);
  await env.SUBS.delete(`chats:${uid}`);
  return old;
}
async function listChats(env, uid) {
  const owner = await pid(env, uid);
  const list = await open(env, owner, await env.SUBS.get(indexKey(owner)));
  return list ?? await moveLegacy(env, uid, owner) ?? [];
}
async function getChat(env, uid, id2) {
  if (!CHAT_ID.test(id2)) return null;
  const owner = await pid(env, uid);
  const sealed = await env.SUBS.get(chatKey(owner, id2));
  if (sealed) return open(env, owner, sealed);
  if (!await moveLegacy(env, uid, owner)) return null;
  return open(env, owner, await env.SUBS.get(chatKey(owner, id2)));
}
async function saveExchange(env, uid, id2, question, answer, replaceLast = false) {
  if (!CHAT_ID.test(id2) || !answer.content.trim()) return;
  const owner = await pid(env, uid);
  if (await env.SUBS.get(goneKey(owner, id2))) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const chat = await getChat(env, uid, id2) ?? { id: id2, title: titleOf(question), created: now, updated: now, turns: [] };
  const n = chat.turns.length;
  if (replaceLast && n >= 2 && chat.turns[n - 2].role === "user" && chat.turns[n - 2].content.trim() === question.trim()) chat.turns.splice(n - 2, 2);
  chat.turns.push({ role: "user", content: question }, { role: "assistant", content: answer.content, sources: (answer.sources ?? []).map(slim), followups: answer.followups ?? [], steps: answer.steps ?? [], ...answer.actions?.length ? { actions: answer.actions } : {}, ...answer.cut ? { cut: true } : {} });
  chat.turns = chat.turns.slice(-MAX_TURNS);
  chat.updated = now;
  await put(env, owner, chatKey(owner, id2), chat);
  const index = (await listChats(env, uid)).filter((c) => c.id !== id2);
  const kept = [{ id: id2, title: chat.title, updated: now, count: chat.turns.length / 2 }, ...index].slice(0, MAX_CHATS);
  await put(env, owner, indexKey(owner), kept);
  for (const gone of index.slice(MAX_CHATS - 1)) await env.SUBS.delete(chatKey(owner, gone.id));
}
async function deleteAllChats(env, uid) {
  const owner = await pid(env, uid);
  const list = await listChats(env, uid);
  for (const c of list) {
    await env.SUBS.put(goneKey(owner, c.id), "1", { expirationTtl: 86400 });
    await env.SUBS.delete(chatKey(owner, c.id));
  }
  await env.SUBS.delete(indexKey(owner));
  return list.length;
}

// src/telegram-api.ts
import { Api } from "grammy";

// src/webpush.mjs
var PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];
function loopbackOrigin(origin) {
  if (typeof origin !== "string" || !origin) return null;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}
function validSubscription(sub, testOrigin) {
  if (!sub || typeof sub !== "object" || typeof sub.endpoint !== "string" || sub.endpoint.length > 1024) return false;
  let u;
  try {
    u = new URL(sub.endpoint);
  } catch {
    return false;
  }
  const loop = loopbackOrigin(testOrigin);
  if (!(loop && u.origin === loop && !u.username && !u.password)) {
    if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
    if (!PUSH_HOSTS.some((h) => h.test(u.hostname))) return false;
  }
  const k = sub.keys;
  return !!k && typeof k.p256dh === "string" && typeof k.auth === "string" && /^[A-Za-z0-9_-]{20,200}=*$/.test(k.p256dh) && /^[A-Za-z0-9_-]{8,100}=*$/.test(k.auth);
}
var enc3 = new TextEncoder();
function b64u(bytes) {
  const b = typeof bytes === "string" ? enc3.encode(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// src/telegram-api.ts
var telegramApi = (env) => {
  const root2 = loopbackOrigin(env.TELEGRAM_API_ROOT);
  return new Api(env.BOT_TOKEN, root2 ? { apiRoot: root2 } : void 0);
};

// ../shared/credits.mjs
var MC_PER_USD = 1e6;
function spendOrder(lots, now = Date.now()) {
  return lots.filter((l) => l.remaining_mc > 0 && (l.expires_at == null || l.expires_at > now)).sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity) || a.created_at - b.created_at || a.id - b.id);
}
function allocate(lots, amount, now = Date.now()) {
  let left = Math.max(0, Math.round(amount));
  const take = [];
  for (const l of spendOrder(lots, now)) {
    if (!left) break;
    const n = Math.min(left, l.remaining_mc);
    take.push({ lot: l.id, mc: n });
    left -= n;
  }
  return { take, short: left };
}
function walletOf(lots, now = Date.now()) {
  const live = spendOrder(lots, now);
  return {
    total_mc: live.reduce((s, l) => s + l.remaining_mc, 0),
    lots: live.map((l) => ({ kind: l.kind, remaining_mc: l.remaining_mc, expires_at: l.expires_at ?? null }))
  };
}

// src/credits.ts
var TABLES = [
  `CREATE TABLE IF NOT EXISTS credit_lots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
    granted_mc INTEGER NOT NULL, remaining_mc INTEGER NOT NULL CHECK (remaining_mc >= 0), expires_at INTEGER,
    source TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (user_id, source))`,
  "CREATE INDEX IF NOT EXISTS credit_lots_owner ON credit_lots (user_id, expires_at)",
  `CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL,
    type TEXT NOT NULL, amount_mc INTEGER NOT NULL, lot_id INTEGER NOT NULL DEFAULT 0, ref TEXT NOT NULL, detail TEXT,
    UNIQUE (user_id, type, ref, lot_id))`,
  "CREATE INDEX IF NOT EXISTS credit_ledger_owner ON credit_ledger (user_id, at)",
  "CREATE INDEX IF NOT EXISTS credit_ledger_lot_type ON credit_ledger (lot_id, type)",
  `CREATE TABLE IF NOT EXISTS credit_holds (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, held_mc INTEGER NOT NULL,
    alloc TEXT NOT NULL, state TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_usage (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, model TEXT,
    status TEXT NOT NULL, held_mc INTEGER NOT NULL, charged_mc INTEGER NOT NULL, cost_usd REAL NOT NULL, absorbed_mc INTEGER NOT NULL DEFAULT 0, detail TEXT)`,
  "CREATE INDEX IF NOT EXISTS credit_usage_owner ON credit_usage (user_id, at)",
  // The admin's daily totals read by time alone; without this the usage page scans the whole table.
  "CREATE INDEX IF NOT EXISTS credit_usage_at ON credit_usage (at)",
  "CREATE TABLE IF NOT EXISTS credit_meta (user_id TEXT PRIMARY KEY, migrated_at INTEGER)",
  // Write-contention events per UTC day, for the hourly health check's alerting.
  "CREATE TABLE IF NOT EXISTS contention_daily (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"
];
var ready = /* @__PURE__ */ new WeakSet();
async function ensureCreditTables(env) {
  if (ready.has(env.DB)) return;
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  ready.add(env.DB);
}
var ownerOfUser = (env, uid) => pid(env, uid);
var isConstraint = (e) => /CHECK constraint|constraint failed/i.test(String(e?.message ?? e));
async function noteContention(env, where, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  console.error(JSON.stringify({ event: "credits_contention", where, day }));
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS contention_daily (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("INSERT INTO contention_daily (day, n) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET n = n + 1").bind(day)
  ]).catch(() => null);
}
async function lotsOf(env, owner) {
  const r = await env.DB.prepare("SELECT id, kind, granted_mc, remaining_mc, expires_at, created_at, source FROM credit_lots WHERE user_id = ? AND remaining_mc > 0").bind(owner).all();
  return r.results ?? [];
}
function grantStatements(env, owner, g, now) {
  return [
    env.DB.prepare("INSERT OR IGNORE INTO credit_lots (user_id, kind, granted_mc, remaining_mc, expires_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(owner, g.kind, g.mc, g.mc, g.expires_at, g.source, now),
    env.DB.prepare(`INSERT OR IGNORE INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref, detail)
      SELECT user_id, ?, ?, granted_mc, id, source, ? FROM credit_lots WHERE user_id = ? AND source = ?`).bind(now, g.type, g.detail === void 0 ? null : JSON.stringify(g.detail), owner, g.source)
  ];
}
async function adjust(env, owner, mc, ref, note, now = Date.now()) {
  await ensureCreditTables(env);
  if (mc > 0) {
    await env.DB.batch(grantStatements(env, owner, { kind: "adjust", mc, expires_at: null, source: `adjust:${ref}`, type: "adjustment", detail: { note } }, now));
    return mc;
  }
  if (await env.DB.prepare("SELECT 1 FROM credit_ledger WHERE user_id = ? AND type = 'adjustment' AND ref = ?").bind(owner, `adjust:${ref}`).first()) return 0;
  for (let i = 0; i < 6; i++) {
    const { take } = allocate(await lotsOf(env, owner), -mc, now);
    try {
      await env.DB.batch(take.flatMap((t) => [
        env.DB.prepare("UPDATE credit_lots SET remaining_mc = remaining_mc - ? WHERE id = ?").bind(t.mc, t.lot),
        env.DB.prepare("INSERT INTO credit_ledger (user_id, at, type, amount_mc, lot_id, ref, detail) VALUES (?, ?, 'adjustment', ?, ?, ?, ?)").bind(owner, now, -t.mc, t.lot, `adjust:${ref}`, JSON.stringify({ note }))
      ]));
      return -take.reduce((s, t) => s + t.mc, 0);
    } catch (e) {
      if (!isConstraint(e)) throw e;
    }
  }
  await noteContention(env, "adjust");
  throw new Error("credits contention");
}
async function history(env, owner, limit = 60) {
  await ensureCreditTables(env);
  const [use, led] = await Promise.all([
    env.DB.prepare("SELECT at, model, status, charged_mc FROM credit_usage WHERE user_id = ? ORDER BY at DESC LIMIT ?").bind(owner, limit).all(),
    env.DB.prepare(`SELECT l.at, l.type, SUM(l.amount_mc) AS amount_mc, MAX(c.expires_at) AS expires_at, MAX(l.detail) AS detail FROM credit_ledger l LEFT JOIN credit_lots c ON c.id = l.lot_id
      WHERE l.user_id = ? AND l.type NOT IN ('hold', 'release', 'usage') GROUP BY l.type, l.ref ORDER BY l.at DESC LIMIT ?`).bind(owner, limit).all()
  ]);
  const items = [
    ...(use.results ?? []).map((u) => ({ at: u.at, kind: "usage", amount_mc: -u.charged_mc, model: u.model, status: u.status })),
    ...(led.results ?? []).filter((l) => l.amount_mc !== 0).map((l) => ({ at: l.at, kind: l.type, amount_mc: l.amount_mc, expires_at: l.expires_at, detail: l.detail ? JSON.parse(l.detail) : void 0 }))
  ];
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}
async function deleteCredits(env, owner) {
  await ensureCreditTables(env);
  const w = walletOf(await lotsOf(env, owner));
  await env.DB.batch(["credit_lots", "credit_ledger", "credit_holds", "credit_usage", "credit_meta"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(owner)));
  return { total_mc: w.total_mc };
}
async function creditsRecord(env, owner) {
  await ensureCreditTables(env);
  return { wallet: walletOf(await lotsOf(env, owner)), history: await history(env, owner, 500) };
}

// ../shared/zone-coords.json
var zone_coords_default = { source: "IANA tz database 2025b: zone1970.tab, zone.tab and tzdata.zi links (bot/scripts/zone-coords.mjs)", zones: { "Africa/Abidjan": [5.32, -4.03], "Africa/Accra": [5.55, -0.22], "Africa/Addis_Ababa": [9.03, 38.7], "Africa/Algiers": [36.78, 3.05], "Africa/Asmara": [15.33, 38.88], "Africa/Asmera": [15.33, 38.88], "Africa/Bamako": [12.65, -8], "Africa/Bangui": [4.37, 18.58], "Africa/Banjul": [13.47, -16.65], "Africa/Bissau": [11.85, -15.58], "Africa/Blantyre": [-15.78, 35], "Africa/Brazzaville": [-4.27, 15.28], "Africa/Bujumbura": [-3.38, 29.37], "Africa/Cairo": [30.05, 31.25], "Africa/Casablanca": [33.65, -7.58], "Africa/Ceuta": [35.88, -5.32], "Africa/Conakry": [9.52, -13.72], "Africa/Dakar": [14.67, -17.43], "Africa/Dar_es_Salaam": [-6.8, 39.28], "Africa/Djibouti": [11.6, 43.15], "Africa/Douala": [4.05, 9.7], "Africa/El_Aaiun": [27.15, -13.2], "Africa/Freetown": [8.5, -13.25], "Africa/Gaborone": [-24.65, 25.92], "Africa/Harare": [-17.83, 31.05], "Africa/Johannesburg": [-26.25, 28], "Africa/Juba": [4.85, 31.62], "Africa/Kampala": [0.32, 32.42], "Africa/Khartoum": [15.6, 32.53], "Africa/Kigali": [-1.95, 30.07], "Africa/Kinshasa": [-4.3, 15.3], "Africa/Lagos": [6.45, 3.4], "Africa/Libreville": [0.38, 9.45], "Africa/Lome": [6.13, 1.22], "Africa/Luanda": [-8.8, 13.23], "Africa/Lubumbashi": [-11.67, 27.47], "Africa/Lusaka": [-15.42, 28.28], "Africa/Malabo": [3.75, 8.78], "Africa/Maputo": [-25.97, 32.58], "Africa/Maseru": [-29.47, 27.5], "Africa/Mbabane": [-26.3, 31.1], "Africa/Mogadishu": [2.07, 45.37], "Africa/Monrovia": [6.3, -10.78], "Africa/Nairobi": [-1.28, 36.82], "Africa/Ndjamena": [12.12, 15.05], "Africa/Niamey": [13.52, 2.12], "Africa/Nouakchott": [18.1, -15.95], "Africa/Ouagadougou": [12.37, -1.52], "Africa/Porto-Novo": [6.48, 2.62], "Africa/Sao_Tome": [0.33, 6.73], "Africa/Timbuktu": [12.65, -8], "Africa/Tripoli": [32.9, 13.18], "Africa/Tunis": [36.8, 10.18], "Africa/Windhoek": [-22.57, 17.1], "America/Adak": [51.88, -176.66], "America/Anchorage": [61.22, -149.9], "America/Anguilla": [18.2, -63.07], "America/Antigua": [17.05, -61.8], "America/Araguaina": [-7.2, -48.2], "America/Argentina/Buenos_Aires": [-34.6, -58.45], "America/Argentina/Catamarca": [-28.47, -65.78], "America/Argentina/ComodRivadavia": [-28.47, -65.78], "America/Argentina/Cordoba": [-31.4, -64.18], "America/Argentina/Jujuy": [-24.18, -65.3], "America/Argentina/La_Rioja": [-29.43, -66.85], "America/Argentina/Mendoza": [-32.88, -68.82], "America/Argentina/Rio_Gallegos": [-51.63, -69.22], "America/Argentina/Salta": [-24.78, -65.42], "America/Argentina/San_Juan": [-31.53, -68.52], "America/Argentina/San_Luis": [-33.32, -66.35], "America/Argentina/Tucuman": [-26.82, -65.22], "America/Argentina/Ushuaia": [-54.8, -68.3], "America/Aruba": [12.5, -69.97], "America/Asuncion": [-25.27, -57.67], "America/Atikokan": [48.76, -91.62], "America/Atka": [51.88, -176.66], "America/Bahia": [-12.98, -38.52], "America/Bahia_Banderas": [20.8, -105.25], "America/Barbados": [13.1, -59.62], "America/Belem": [-1.45, -48.48], "America/Belize": [17.5, -88.2], "America/Blanc-Sablon": [51.42, -57.12], "America/Boa_Vista": [2.82, -60.67], "America/Bogota": [4.6, -74.08], "America/Boise": [43.61, -116.2], "America/Buenos_Aires": [-34.6, -58.45], "America/Cambridge_Bay": [69.11, -105.05], "America/Campo_Grande": [-20.45, -54.62], "America/Cancun": [21.08, -86.77], "America/Caracas": [10.5, -66.93], "America/Catamarca": [-28.47, -65.78], "America/Cayenne": [4.93, -52.33], "America/Cayman": [19.3, -81.38], "America/Chicago": [41.85, -87.65], "America/Chihuahua": [28.63, -106.08], "America/Ciudad_Juarez": [31.73, -106.48], "America/Coral_Harbour": [48.76, -91.62], "America/Cordoba": [-31.4, -64.18], "America/Costa_Rica": [9.93, -84.08], "America/Coyhaique": [-45.57, -72.07], "America/Creston": [49.1, -116.52], "America/Cuiaba": [-15.58, -56.08], "America/Curacao": [12.18, -69], "America/Danmarkshavn": [76.77, -18.67], "America/Dawson": [64.07, -139.42], "America/Dawson_Creek": [55.77, -120.23], "America/Denver": [39.74, -104.98], "America/Detroit": [42.33, -83.05], "America/Dominica": [15.3, -61.4], "America/Edmonton": [53.55, -113.47], "America/Eirunepe": [-6.67, -69.87], "America/El_Salvador": [13.7, -89.2], "America/Ensenada": [32.53, -117.02], "America/Fort_Nelson": [58.8, -122.7], "America/Fort_Wayne": [39.77, -86.16], "America/Fortaleza": [-3.72, -38.5], "America/Glace_Bay": [46.2, -59.95], "America/Godthab": [64.18, -51.73], "America/Goose_Bay": [53.33, -60.42], "America/Grand_Turk": [21.47, -71.13], "America/Grenada": [12.05, -61.75], "America/Guadeloupe": [16.23, -61.53], "America/Guatemala": [14.63, -90.52], "America/Guayaquil": [-2.17, -79.83], "America/Guyana": [6.8, -58.17], "America/Halifax": [44.65, -63.6], "America/Havana": [23.13, -82.37], "America/Hermosillo": [29.07, -110.97], "America/Indiana/Indianapolis": [39.77, -86.16], "America/Indiana/Knox": [41.3, -86.62], "America/Indiana/Marengo": [38.38, -86.34], "America/Indiana/Petersburg": [38.49, -87.28], "America/Indiana/Tell_City": [37.95, -86.76], "America/Indiana/Vevay": [38.75, -85.07], "America/Indiana/Vincennes": [38.68, -87.53], "America/Indiana/Winamac": [41.05, -86.6], "America/Indianapolis": [39.77, -86.16], "America/Inuvik": [68.35, -133.72], "America/Iqaluit": [63.73, -68.47], "America/Jamaica": [17.97, -76.79], "America/Jujuy": [-24.18, -65.3], "America/Juneau": [58.3, -134.42], "America/Kentucky/Louisville": [38.25, -85.76], "America/Kentucky/Monticello": [36.83, -84.85], "America/Knox_IN": [41.3, -86.62], "America/Kralendijk": [12.15, -68.28], "America/La_Paz": [-16.5, -68.15], "America/Lima": [-12.05, -77.05], "America/Los_Angeles": [34.05, -118.24], "America/Louisville": [38.25, -85.76], "America/Lower_Princes": [18.05, -63.05], "America/Maceio": [-9.67, -35.72], "America/Managua": [12.15, -86.28], "America/Manaus": [-3.13, -60.02], "America/Marigot": [18.07, -63.08], "America/Martinique": [14.6, -61.08], "America/Matamoros": [25.83, -97.5], "America/Mazatlan": [23.22, -106.42], "America/Mendoza": [-32.88, -68.82], "America/Menominee": [45.11, -87.61], "America/Merida": [20.97, -89.62], "America/Metlakatla": [55.13, -131.58], "America/Mexico_City": [19.4, -99.15], "America/Miquelon": [47.05, -56.33], "America/Moncton": [46.1, -64.78], "America/Monterrey": [25.67, -100.32], "America/Montevideo": [-34.91, -56.21], "America/Montreal": [43.65, -79.38], "America/Montserrat": [16.72, -62.22], "America/Nassau": [25.08, -77.35], "America/New_York": [40.71, -74.01], "America/Nipigon": [43.65, -79.38], "America/Nome": [64.5, -165.41], "America/Noronha": [-3.85, -32.42], "America/North_Dakota/Beulah": [47.26, -101.78], "America/North_Dakota/Center": [47.12, -101.3], "America/North_Dakota/New_Salem": [46.85, -101.41], "America/Nuuk": [64.18, -51.73], "America/Ojinaga": [29.57, -104.42], "America/Panama": [8.97, -79.53], "America/Pangnirtung": [63.73, -68.47], "America/Paramaribo": [5.83, -55.17], "America/Phoenix": [33.45, -112.07], "America/Port-au-Prince": [18.53, -72.33], "America/Port_of_Spain": [10.65, -61.52], "America/Porto_Acre": [-9.97, -67.8], "America/Porto_Velho": [-8.77, -63.9], "America/Puerto_Rico": [18.47, -66.11], "America/Punta_Arenas": [-53.15, -70.92], "America/Rainy_River": [49.88, -97.15], "America/Rankin_Inlet": [62.82, -92.08], "America/Recife": [-8.05, -34.9], "America/Regina": [50.4, -104.65], "America/Resolute": [74.7, -94.83], "America/Rio_Branco": [-9.97, -67.8], "America/Rosario": [-31.4, -64.18], "America/Santa_Isabel": [32.53, -117.02], "America/Santarem": [-2.43, -54.87], "America/Santiago": [-33.45, -70.67], "America/Santo_Domingo": [18.47, -69.9], "America/Sao_Paulo": [-23.53, -46.62], "America/Scoresbysund": [70.48, -21.97], "America/Shiprock": [39.74, -104.98], "America/Sitka": [57.18, -135.3], "America/St_Barthelemy": [17.88, -62.85], "America/St_Johns": [47.57, -52.72], "America/St_Kitts": [17.3, -62.72], "America/St_Lucia": [14.02, -61], "America/St_Thomas": [18.35, -64.93], "America/St_Vincent": [13.15, -61.23], "America/Swift_Current": [50.28, -107.83], "America/Tegucigalpa": [14.1, -87.22], "America/Thule": [76.57, -68.78], "America/Thunder_Bay": [43.65, -79.38], "America/Tijuana": [32.53, -117.02], "America/Toronto": [43.65, -79.38], "America/Tortola": [18.45, -64.62], "America/Vancouver": [49.27, -123.12], "America/Virgin": [18.35, -64.93], "America/Whitehorse": [60.72, -135.05], "America/Winnipeg": [49.88, -97.15], "America/Yakutat": [59.55, -139.73], "America/Yellowknife": [53.55, -113.47], "Antarctica/Casey": [-66.28, 110.52], "Antarctica/Davis": [-68.58, 77.97], "Antarctica/DumontDUrville": [-66.67, 140.02], "Antarctica/Macquarie": [-54.5, 158.95], "Antarctica/Mawson": [-67.6, 62.88], "Antarctica/McMurdo": [-77.83, 166.6], "Antarctica/Palmer": [-64.8, -64.1], "Antarctica/Rothera": [-67.57, -68.13], "Antarctica/South_Pole": [-77.83, 166.6], "Antarctica/Syowa": [-69.01, 39.59], "Antarctica/Troll": [-72.01, 2.53], "Antarctica/Vostok": [-78.4, 106.9], "Arctic/Longyearbyen": [78, 16], "Asia/Aden": [12.75, 45.2], "Asia/Almaty": [43.25, 76.95], "Asia/Amman": [31.95, 35.93], "Asia/Anadyr": [64.75, 177.48], "Asia/Aqtau": [44.52, 50.27], "Asia/Aqtobe": [50.28, 57.17], "Asia/Ashgabat": [37.95, 58.38], "Asia/Ashkhabad": [37.95, 58.38], "Asia/Atyrau": [47.12, 51.93], "Asia/Baghdad": [33.35, 44.42], "Asia/Bahrain": [26.38, 50.58], "Asia/Baku": [40.38, 49.85], "Asia/Bangkok": [13.75, 100.52], "Asia/Barnaul": [53.37, 83.75], "Asia/Beirut": [33.88, 35.5], "Asia/Bishkek": [42.9, 74.6], "Asia/Brunei": [4.93, 114.92], "Asia/Calcutta": [22.53, 88.37], "Asia/Chita": [52.05, 113.47], "Asia/Choibalsan": [47.92, 106.88], "Asia/Chongqing": [31.23, 121.47], "Asia/Chungking": [31.23, 121.47], "Asia/Colombo": [6.93, 79.85], "Asia/Dacca": [23.72, 90.42], "Asia/Damascus": [33.5, 36.3], "Asia/Dhaka": [23.72, 90.42], "Asia/Dili": [-8.55, 125.58], "Asia/Dubai": [25.3, 55.3], "Asia/Dushanbe": [38.58, 68.8], "Asia/Famagusta": [35.12, 33.95], "Asia/Gaza": [31.5, 34.47], "Asia/Harbin": [31.23, 121.47], "Asia/Hebron": [31.53, 35.1], "Asia/Ho_Chi_Minh": [10.75, 106.67], "Asia/Hong_Kong": [22.28, 114.15], "Asia/Hovd": [48.02, 91.65], "Asia/Irkutsk": [52.27, 104.33], "Asia/Istanbul": [41.02, 28.97], "Asia/Jakarta": [-6.17, 106.8], "Asia/Jayapura": [-2.53, 140.7], "Asia/Jerusalem": [31.78, 35.22], "Asia/Kabul": [34.52, 69.2], "Asia/Kamchatka": [53.02, 158.65], "Asia/Karachi": [24.87, 67.05], "Asia/Kashgar": [43.8, 87.58], "Asia/Kathmandu": [27.72, 85.32], "Asia/Katmandu": [27.72, 85.32], "Asia/Khandyga": [62.66, 135.55], "Asia/Kolkata": [22.53, 88.37], "Asia/Krasnoyarsk": [56.02, 92.83], "Asia/Kuala_Lumpur": [3.17, 101.7], "Asia/Kuching": [1.55, 110.33], "Asia/Kuwait": [29.33, 47.98], "Asia/Macao": [22.2, 113.54], "Asia/Macau": [22.2, 113.54], "Asia/Magadan": [59.57, 150.8], "Asia/Makassar": [-5.12, 119.4], "Asia/Manila": [14.59, 120.97], "Asia/Muscat": [23.6, 58.58], "Asia/Nicosia": [35.17, 33.37], "Asia/Novokuznetsk": [53.75, 87.12], "Asia/Novosibirsk": [55.03, 82.92], "Asia/Omsk": [55, 73.4], "Asia/Oral": [51.22, 51.35], "Asia/Phnom_Penh": [11.55, 104.92], "Asia/Pontianak": [-0.03, 109.33], "Asia/Pyongyang": [39.02, 125.75], "Asia/Qatar": [25.28, 51.53], "Asia/Qostanay": [53.2, 63.62], "Asia/Qyzylorda": [44.8, 65.47], "Asia/Rangoon": [16.78, 96.17], "Asia/Riyadh": [24.63, 46.72], "Asia/Saigon": [10.75, 106.67], "Asia/Sakhalin": [46.97, 142.7], "Asia/Samarkand": [39.67, 66.8], "Asia/Seoul": [37.55, 126.97], "Asia/Shanghai": [31.23, 121.47], "Asia/Singapore": [1.28, 103.85], "Asia/Srednekolymsk": [67.47, 153.72], "Asia/Taipei": [25.05, 121.5], "Asia/Tashkent": [41.33, 69.3], "Asia/Tbilisi": [41.72, 44.82], "Asia/Tehran": [35.67, 51.43], "Asia/Tel_Aviv": [31.78, 35.22], "Asia/Thimbu": [27.47, 89.65], "Asia/Thimphu": [27.47, 89.65], "Asia/Tokyo": [35.65, 139.74], "Asia/Tomsk": [56.5, 84.97], "Asia/Ujung_Pandang": [-5.12, 119.4], "Asia/Ulaanbaatar": [47.92, 106.88], "Asia/Ulan_Bator": [47.92, 106.88], "Asia/Urumqi": [43.8, 87.58], "Asia/Ust-Nera": [64.56, 143.23], "Asia/Vientiane": [17.97, 102.6], "Asia/Vladivostok": [43.17, 131.93], "Asia/Yakutsk": [62, 129.67], "Asia/Yangon": [16.78, 96.17], "Asia/Yekaterinburg": [56.85, 60.6], "Asia/Yerevan": [40.18, 44.5], "Atlantic/Azores": [37.73, -25.67], "Atlantic/Bermuda": [32.28, -64.77], "Atlantic/Canary": [28.1, -15.4], "Atlantic/Cape_Verde": [14.92, -23.52], "Atlantic/Faeroe": [62.02, -6.77], "Atlantic/Faroe": [62.02, -6.77], "Atlantic/Jan_Mayen": [59.92, 10.75], "Atlantic/Madeira": [32.63, -16.9], "Atlantic/Reykjavik": [64.15, -21.85], "Atlantic/South_Georgia": [-54.27, -36.53], "Atlantic/St_Helena": [-15.92, -5.7], "Atlantic/Stanley": [-51.7, -57.85], "Australia/ACT": [-33.87, 151.22], "Australia/Adelaide": [-34.92, 138.58], "Australia/Brisbane": [-27.47, 153.03], "Australia/Broken_Hill": [-31.95, 141.45], "Australia/Canberra": [-33.87, 151.22], "Australia/Currie": [-42.88, 147.32], "Australia/Darwin": [-12.47, 130.83], "Australia/Eucla": [-31.72, 128.87], "Australia/Hobart": [-42.88, 147.32], "Australia/LHI": [-31.55, 159.08], "Australia/Lindeman": [-20.27, 149], "Australia/Lord_Howe": [-31.55, 159.08], "Australia/Melbourne": [-37.82, 144.97], "Australia/NSW": [-33.87, 151.22], "Australia/North": [-12.47, 130.83], "Australia/Perth": [-31.95, 115.85], "Australia/Queensland": [-27.47, 153.03], "Australia/South": [-34.92, 138.58], "Australia/Sydney": [-33.87, 151.22], "Australia/Tasmania": [-42.88, 147.32], "Australia/Victoria": [-37.82, 144.97], "Australia/West": [-31.95, 115.85], "Australia/Yancowinna": [-31.95, 141.45], "Brazil/Acre": [-9.97, -67.8], "Brazil/DeNoronha": [-3.85, -32.42], "Brazil/East": [-23.53, -46.62], "Brazil/West": [-3.13, -60.02], "Canada/Atlantic": [44.65, -63.6], "Canada/Central": [49.88, -97.15], "Canada/Eastern": [43.65, -79.38], "Canada/Mountain": [53.55, -113.47], "Canada/Newfoundland": [47.57, -52.72], "Canada/Pacific": [49.27, -123.12], "Canada/Saskatchewan": [50.4, -104.65], "Canada/Yukon": [60.72, -135.05], "Chile/Continental": [-33.45, -70.67], "Chile/EasterIsland": [-27.15, -109.43], Cuba: [23.13, -82.37], Egypt: [30.05, 31.25], Eire: [53.33, -6.25], "Europe/Amsterdam": [52.37, 4.9], "Europe/Andorra": [42.5, 1.52], "Europe/Astrakhan": [46.35, 48.05], "Europe/Athens": [37.97, 23.72], "Europe/Belfast": [51.51, -0.13], "Europe/Belgrade": [44.83, 20.5], "Europe/Berlin": [52.5, 13.37], "Europe/Bratislava": [48.15, 17.12], "Europe/Brussels": [50.83, 4.33], "Europe/Bucharest": [44.43, 26.1], "Europe/Budapest": [47.5, 19.08], "Europe/Busingen": [47.7, 8.68], "Europe/Chisinau": [47, 28.83], "Europe/Copenhagen": [55.67, 12.58], "Europe/Dublin": [53.33, -6.25], "Europe/Gibraltar": [36.13, -5.35], "Europe/Guernsey": [49.45, -2.54], "Europe/Helsinki": [60.17, 24.97], "Europe/Isle_of_Man": [54.15, -4.47], "Europe/Istanbul": [41.02, 28.97], "Europe/Jersey": [49.18, -2.11], "Europe/Kaliningrad": [54.72, 20.5], "Europe/Kiev": [50.43, 30.52], "Europe/Kirov": [58.6, 49.65], "Europe/Kyiv": [50.43, 30.52], "Europe/Lisbon": [38.72, -9.13], "Europe/Ljubljana": [46.05, 14.52], "Europe/London": [51.51, -0.13], "Europe/Luxembourg": [49.6, 6.15], "Europe/Madrid": [40.4, -3.68], "Europe/Malta": [35.9, 14.52], "Europe/Mariehamn": [60.1, 19.95], "Europe/Minsk": [53.9, 27.57], "Europe/Monaco": [43.7, 7.38], "Europe/Moscow": [55.76, 37.62], "Europe/Nicosia": [35.17, 33.37], "Europe/Oslo": [59.92, 10.75], "Europe/Paris": [48.87, 2.33], "Europe/Podgorica": [42.43, 19.27], "Europe/Prague": [50.08, 14.43], "Europe/Riga": [56.95, 24.1], "Europe/Rome": [41.9, 12.48], "Europe/Samara": [53.2, 50.15], "Europe/San_Marino": [43.92, 12.47], "Europe/Sarajevo": [43.87, 18.42], "Europe/Saratov": [51.57, 46.03], "Europe/Simferopol": [44.95, 34.1], "Europe/Skopje": [41.98, 21.43], "Europe/Sofia": [42.68, 23.32], "Europe/Stockholm": [59.33, 18.05], "Europe/Tallinn": [59.42, 24.75], "Europe/Tirane": [41.33, 19.83], "Europe/Tiraspol": [47, 28.83], "Europe/Ulyanovsk": [54.33, 48.4], "Europe/Uzhgorod": [50.43, 30.52], "Europe/Vaduz": [47.15, 9.52], "Europe/Vatican": [41.9, 12.45], "Europe/Vienna": [48.22, 16.33], "Europe/Vilnius": [54.68, 25.32], "Europe/Volgograd": [48.73, 44.42], "Europe/Warsaw": [52.25, 21], "Europe/Zagreb": [45.8, 15.97], "Europe/Zaporozhye": [50.43, 30.52], "Europe/Zurich": [47.38, 8.53], GB: [51.51, -0.13], "GB-Eire": [51.51, -0.13], Hongkong: [22.28, 114.15], Iceland: [64.15, -21.85], "Indian/Antananarivo": [-18.92, 47.52], "Indian/Chagos": [-7.33, 72.42], "Indian/Christmas": [-10.42, 105.72], "Indian/Cocos": [-12.17, 96.92], "Indian/Comoro": [-11.68, 43.27], "Indian/Kerguelen": [-49.35, 70.22], "Indian/Mahe": [-4.67, 55.47], "Indian/Maldives": [4.17, 73.5], "Indian/Mauritius": [-20.17, 57.5], "Indian/Mayotte": [-12.78, 45.23], "Indian/Reunion": [-20.87, 55.47], Iran: [35.67, 51.43], Israel: [31.78, 35.22], Jamaica: [17.97, -76.79], Japan: [35.65, 139.74], Kwajalein: [9.08, 167.33], Libya: [32.9, 13.18], "Mexico/BajaNorte": [32.53, -117.02], "Mexico/BajaSur": [23.22, -106.42], "Mexico/General": [19.4, -99.15], NZ: [-36.87, 174.77], "NZ-CHAT": [-43.95, -176.55], Navajo: [39.74, -104.98], PRC: [31.23, 121.47], "Pacific/Apia": [-13.83, -171.73], "Pacific/Auckland": [-36.87, 174.77], "Pacific/Bougainville": [-6.22, 155.57], "Pacific/Chatham": [-43.95, -176.55], "Pacific/Chuuk": [7.42, 151.78], "Pacific/Easter": [-27.15, -109.43], "Pacific/Efate": [-17.67, 168.42], "Pacific/Enderbury": [-2.78, -171.72], "Pacific/Fakaofo": [-9.37, -171.23], "Pacific/Fiji": [-18.13, 178.42], "Pacific/Funafuti": [-8.52, 179.22], "Pacific/Galapagos": [-0.9, -89.6], "Pacific/Gambier": [-23.13, -134.95], "Pacific/Guadalcanal": [-9.53, 160.2], "Pacific/Guam": [13.47, 144.75], "Pacific/Honolulu": [21.31, -157.86], "Pacific/Johnston": [21.31, -157.86], "Pacific/Kanton": [-2.78, -171.72], "Pacific/Kiritimati": [1.87, -157.33], "Pacific/Kosrae": [5.32, 162.98], "Pacific/Kwajalein": [9.08, 167.33], "Pacific/Majuro": [7.15, 171.2], "Pacific/Marquesas": [-9, -139.5], "Pacific/Midway": [28.22, -177.37], "Pacific/Nauru": [-0.52, 166.92], "Pacific/Niue": [-19.02, -169.92], "Pacific/Norfolk": [-29.05, 167.97], "Pacific/Noumea": [-22.27, 166.45], "Pacific/Pago_Pago": [-14.27, -170.7], "Pacific/Palau": [7.33, 134.48], "Pacific/Pitcairn": [-25.07, -130.08], "Pacific/Pohnpei": [6.97, 158.22], "Pacific/Ponape": [6.97, 158.22], "Pacific/Port_Moresby": [-9.5, 147.17], "Pacific/Rarotonga": [-21.23, -159.77], "Pacific/Saipan": [15.2, 145.75], "Pacific/Samoa": [-14.27, -170.7], "Pacific/Tahiti": [-17.53, -149.57], "Pacific/Tarawa": [1.42, 173], "Pacific/Tongatapu": [-21.13, -175.2], "Pacific/Truk": [7.42, 151.78], "Pacific/Wake": [19.28, 166.62], "Pacific/Wallis": [-13.3, -176.17], "Pacific/Yap": [7.42, 151.78], Poland: [52.25, 21], Portugal: [38.72, -9.13], ROC: [25.05, 121.5], ROK: [37.55, 126.97], Singapore: [1.28, 103.85], Turkey: [41.02, 28.97], "US/Alaska": [61.22, -149.9], "US/Aleutian": [51.88, -176.66], "US/Arizona": [33.45, -112.07], "US/Central": [41.85, -87.65], "US/East-Indiana": [39.77, -86.16], "US/Eastern": [40.71, -74.01], "US/Hawaii": [21.31, -157.86], "US/Indiana-Starke": [41.3, -86.62], "US/Michigan": [42.33, -83.05], "US/Mountain": [39.74, -104.98], "US/Pacific": [34.05, -118.24], "US/Samoa": [-14.27, -170.7], "W-SU": [55.76, 37.62] } };

// ../shared/holy-days.json
var holy_days_default = {
  source: "https://israelunite.org/high-holy-days/calendar/",
  rule: "Top-ups pause from full dark the evening before each date to full dark that evening. Feast weeks: opening and closing days only.",
  days: [
    {
      date: "2026-10-06",
      kind: "feast",
      name: "Day of Atonement"
    },
    {
      date: "2026-10-11",
      kind: "feast",
      name: "Feast of Tabernacles (opening day)"
    },
    {
      date: "2026-10-17",
      kind: "feast",
      name: "Feast of Tabernacles (closing day)"
    },
    {
      date: "2026-10-27",
      kind: "newmoon",
      name: "New Moon"
    },
    {
      date: "2026-11-25",
      kind: "newmoon",
      name: "New Moon"
    },
    {
      date: "2026-12-19",
      kind: "feast",
      name: "Feast of Dedication (opening day)"
    },
    {
      date: "2026-12-25",
      kind: "feast",
      name: "Feast of Dedication (closing day)"
    },
    {
      date: "2026-12-25",
      kind: "newmoon",
      name: "New Moon"
    },
    {
      date: "2027-01-23",
      kind: "newmoon",
      name: "New Moon"
    },
    {
      date: "2027-02-21",
      kind: "newmoon",
      name: "New Moon"
    },
    {
      date: "2027-03-04",
      kind: "feast",
      name: "Destruction of Nicanor"
    },
    {
      date: "2027-03-06",
      kind: "feast",
      name: "Purim"
    },
    {
      date: "2027-03-11",
      kind: "feast",
      name: "Destruction of Nicanor"
    },
    {
      date: "2027-03-13",
      kind: "feast",
      name: "Purim"
    }
  ]
};

// ../shared/holy-days.mjs
var DEFAULT_ZONE = "America/New_York";
var ZONES = zone_coords_default.zones;
var HOLY_DAYS = Array.isArray(holy_days_default.days) ? holy_days_default.days.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? "") && (d.kind === "feast" || d.kind === "newmoon")) : [];
var validZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
var zoneOf = (tz) => typeof tz === "string" && tz.length < 64 && ZONES[tz] && validZone(tz) ? tz : DEFAULT_ZONE;
var RAD = Math.PI / 180;

// src/billing.ts
async function deleteBilling(env, uid) {
  const id2 = await pid(env, uid);
  const left = await deleteCredits(env, id2);
  const stmts = [];
  if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first()) {
    stmts.push(env.DB.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ? OR user_id = ?").bind(id2, String(uid)));
  }
  if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'donations'").first()) {
    stmts.push(env.DB.prepare("UPDATE donations SET user_id = 'deleted' WHERE user_id = ? OR user_id = ?").bind(id2, String(uid)));
  }
  for (const t of ["accounts", "usage_people"]) {
    if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(t).first()) stmts.push(env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ? OR user_id = ?`).bind(id2, String(uid)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  await env.SUBS.delete(`acct:${uid}`);
  return { balanceUsd: left.total_mc / MC_PER_USD };
}
async function billingRecord(env, uid) {
  const id2 = await pid(env, uid);
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first();
  const pays = has ? await env.DB.prepare("SELECT kind, stars, created_at FROM payments WHERE user_id = ? ORDER BY created_at").bind(id2).all() : { results: [] };
  const hasDonations = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'donations'").first();
  const gifts = hasDonations ? await env.DB.prepare("SELECT stars, created_at FROM donations WHERE user_id = ? ORDER BY created_at").bind(id2).all() : { results: [] };
  return {
    balance: await creditsRecord(env, id2),
    payments: (pays.results ?? []).map((r) => ({ kind: r.kind, stars: r.stars, at: new Date(r.created_at).toISOString() })),
    donations: (gifts.results ?? []).map((r) => ({ stars: r.stars, at: new Date(r.created_at).toISOString() }))
  };
}

// src/topup-remind.ts
import { GrammyError as GrammyError3 } from "grammy";

// src/webhook-updates.ts
var LEASE_MS = 20 * 6e4;

// src/bot.ts
import { Bot, InlineKeyboard as InlineKeyboard3, InputFile } from "grammy";

// src/health.ts
var REMIND_MS = 6 * 3600 * 1e3;

// ../shared/links.mjs
var SECTIONS = /* @__PURE__ */ new Set([
  "plan",
  "resources",
  "doctrine",
  "about",
  "api",
  "ask",
  "bible",
  "captains",
  "cases",
  "classes",
  "concordance",
  "dictionary",
  "downloads",
  "encyclopedia",
  "history",
  "law",
  "lexicon",
  "people",
  "person",
  "precepts",
  "privacy",
  "search",
  "settings",
  "shows",
  "study",
  "tags",
  "teachings",
  "terms",
  "timeline",
  "topics",
  "truth-shall-make-you-free"
]);
var SAFE = /^[A-Za-z0-9_-]{1,512}$/;
var SEGMENT = /^[a-z0-9-]+$/;
var VERSES = /^\d+(-\d+)?(x\d+(-\d+)?)*$/;
function startParamToPath(param) {
  if (typeof param !== "string" || !SAFE.test(param)) return "/";
  const parts = param.toLowerCase().split("_").filter(Boolean);
  if (!parts.length || !parts.every((p) => SEGMENT.test(p))) return "/";
  if (!SECTIONS.has(parts[0])) parts.unshift("bible");
  if (parts[0] === "bible" && parts.length === 4 && /^\d+$/.test(parts[2]) && VERSES.test(parts[3])) {
    const v = parts[3].replace(/x/g, ",");
    return `/bible/${parts[1]}/${parts[2]}?v=${v}#v${v.match(/^\d+/)[0]}`;
  }
  return `/${parts.join("/")}`;
}

// src/data.ts
async function dataJson(env, path, ctx) {
  const url = `${env.DATA_ORIGIN}${path}`;
  const cache = caches.default;
  const hit = await cache.match(url);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const copy = new Response(res.body, res);
  copy.headers.set("cache-control", "public, max-age=3600");
  const put2 = cache.put(url, copy.clone());
  if (ctx) ctx.waitUntil(put2);
  else await put2;
  return copy.json();
}
var books = (env, ctx) => dataJson(env, "/api/kjv/books.json", ctx);
function openLink(env, startapp) {
  if (env.APP_URL) return startapp ? `${env.APP_URL}?startapp=${startapp}` : env.APP_URL;
  const path = startParamToPath(startapp);
  return `${env.SITE_URL}${path === "/" ? "" : path}`;
}
var escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ../shared/search-query.mjs
var NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "hundred", "thousand"];
var NUMBER_FIGURES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "30", "40", "50", "100", "1000"];
var NAME_VARIANTS = [
  ["melchizedek", "melchisedec", "melchisedek"],
  ["elijah", "elias"],
  ["elisha", "eliseus"],
  ["noah", "noe"],
  ["isaiah", "esaias"],
  ["jeremiah", "jeremias", "jeremy"],
  ["hosea", "osee"],
  ["jonah", "jonas"],
  ["korah", "core"],
  ["uzziah", "ozias"],
  ["hezekiah", "ezekias"],
  ["zechariah", "zacharias"],
  ["rahab", "rachab"],
  ["boaz", "booz"],
  ["sarah", "sara"],
  ["canaan", "chanaan"],
  ["midian", "madian"],
  ["sidon", "zidon"],
  ["tyre", "tyrus"],
  ["ezra", "esdras"],
  ["tobit", "tobias"],
  ["sirach", "ecclesiasticus"],
  ["judah", "juda"],
  ["gomorrah", "gomorrha"],
  ["sodom", "sodoma"],
  ["jericho", "hiericho"],
  ["kish", "cis"],
  ["enoch", "henoch"],
  ["reuben", "ruben"]
];
var ALTERNATIVES = /* @__PURE__ */ new Map();
NUMBER_WORDS.forEach((w, i) => {
  ALTERNATIVES.set(w, [w, NUMBER_FIGURES[i]]);
  ALTERNATIVES.set(NUMBER_FIGURES[i], [NUMBER_FIGURES[i], w]);
});
for (const group of NAME_VARIANTS) for (const n of group) ALTERNATIVES.set(n, [n, ...group.filter((x) => x !== n)]);

// src/remind.ts
import { Hono as Hono4 } from "hono";
import { GrammyError as GrammyError2 } from "grammy";

// src/daily.ts
import { Api as Api2, GrammyError } from "grammy";
var SLOT_TTL = 3 * 86400;

// src/reminders.mjs
var PAUSE_CHOICES = [1, 7];
var PAUSE_DAYS = 7;
var PAUSE_FOREVER = "9999-12-31";
var MINUTES = [0, 15, 30, 45];
var PUSH_DEVICES = 10;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
function validTz(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function localNow(tz, now = /* @__PURE__ */ new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: validTz(tz) ? tz : "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}
var lateBy = (local, hour, minute = 0) => local.hour * 60 + local.minute - (hour * 60 + minute);
function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function blank(tz = "UTC") {
  return { v: 1, on: false, hour: 7, minute: 0, tz: validTz(tz) ? tz : "UTC", channels: { telegram: false, push: false }, pushes: [], sent: {}, pending: [] };
}
function applySettings(rec, input, now = /* @__PURE__ */ new Date()) {
  const next = { ...rec, channels: { ...rec.channels }, sent: { ...rec.sent } };
  if (!input || typeof input !== "object") return next;
  if (typeof input.on === "boolean") next.on = input.on;
  if (Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23) next.hour = input.hour;
  if (MINUTES.includes(input.minute)) next.minute = input.minute;
  if (validTz(input.tz)) next.tz = input.tz;
  if (input.channels && typeof input.channels === "object") {
    if (typeof input.channels.telegram === "boolean") next.channels.telegram = input.channels.telegram;
    if (typeof input.channels.push === "boolean") next.channels.push = input.channels.push;
  }
  if (input.paused === false) delete next.pausedUntil;
  if (input.paused === true) next.pausedUntil = pause(next, now, input.pauseDays ?? input.pauseUntil).pausedUntil;
  if (next.on && (!rec.on || next.hour !== rec.hour || (next.minute ?? 0) !== (rec.minute ?? 0) || next.tz !== rec.tz)) {
    const local = localNow(next.tz, now);
    next.from = lateBy(local, next.hour, next.minute) < 0 ? local.date : addDays(local.date, 1);
  }
  if (!next.channels.telegram && !next.channels.push) next.on = false;
  return next;
}
function applyContent(rec, content) {
  const next = { ...rec };
  if (!content || typeof content !== "object") return next;
  const p = content.plan;
  if (p === null) next.plan = null;
  else if (p && Number.isInteger(p.day) && p.day >= 0 && p.day < 5e3 && Number.isInteger(p.perDay) && p.perDay >= 1 && p.perDay <= 50) {
    const valid = (b) => Array.isArray(b) && b.length <= 100 && b.every((x) => typeof x === "string" && /^[a-z0-9-]{1,40}$/.test(x));
    if (p.books === void 0 || valid(p.books)) next.plan = p.books?.length ? { day: p.day, perDay: p.perDay, books: p.books } : { day: p.day, perDay: p.perDay };
  }
  const l = content.last;
  if (l === null) next.last = null;
  else if (l && typeof l.slug === "string" && /^[a-z0-9-]{1,40}$/.test(l.slug) && Number.isInteger(l.chapter) && l.chapter >= 1 && l.chapter <= 200) next.last = { slug: l.slug, chapter: l.chapter };
  return next;
}
function reachable(rec, ch) {
  if (!rec.channels?.[ch]) return false;
  return ch === "telegram" ? Number.isInteger(rec.chatId) : (rec.pushes?.length ?? 0) > 0;
}
function addPush(rec, sub, now = /* @__PURE__ */ new Date()) {
  const date = localNow(rec.tz, now).date;
  const list = (rec.pushes ?? []).filter((p) => p.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, seen: date });
  list.sort((a, b) => (a.seen ?? "").localeCompare(b.seen ?? ""));
  const dropped = list.length > PUSH_DEVICES ? list.splice(0, list.length - PUSH_DEVICES).map((p) => p.endpoint) : [];
  return { rec: { ...rec, pushes: list }, dropped };
}
function removePush(rec, endpoint) {
  return { ...rec, pushes: (rec.pushes ?? []).filter((p) => p.endpoint !== endpoint) };
}
var APOCRYPHA = [
  ["1-esdras", "1 Esdras"],
  ["2-esdras", "2 Esdras"],
  ["tobit", "Tobit"],
  ["judith", "Judith"],
  ["esther-greek", "Rest of Esther"],
  ["wisdom-of-solomon", "Wisdom of Solomon"],
  ["sirach", "Ecclesiasticus"],
  ["baruch", "Baruch"],
  ["epistle-of-jeremiah", "Epistle of Jeremiah"],
  ["song-of-the-three-children", "Song of the Three Holy Children"],
  ["susanna", "History of Susanna"],
  ["bel-and-the-dragon", "Bel and the Dragon"],
  ["prayer-of-manasseh", "Prayer of Manasses"],
  ["1-maccabees", "1 Maccabees"],
  ["2-maccabees", "2 Maccabees"]
];
function orderBooks(books2) {
  const list = books2 ?? [];
  const rest = list.filter((b) => b.testament !== "Apocrypha");
  const by = new Map(list.map((b) => [b.slug, b]));
  const apoc = APOCRYPHA.flatMap(([slug, name]) => {
    const b = by.get(slug);
    return b ? [{ ...b, book: name }] : [];
  });
  const known = new Set(APOCRYPHA.map(([s]) => s));
  return [...rest, ...apoc, ...list.filter((b) => b.testament === "Apocrypha" && !known.has(b.slug))];
}
function flatChapters(books2) {
  const out = [];
  for (const b of orderBooks(books2)) for (const c of b.chapterIds ?? Array.from({ length: b.chapters ?? 0 }, (_, i) => i + 1)) out.push({ slug: b.slug, book: b.book, chapter: c });
  return out;
}
var chapterParam = (slug, chapter2) => `bible_${slug}_${chapter2}`;
function portion(rec, books2) {
  const all = flatChapters(books2);
  if (rec.plan) {
    const per = rec.plan.perDay;
    const own = rec.plan.books?.length ? flatChapters(books2.filter((b) => rec.plan.books.includes(b.slug))) : all;
    const slice = own.slice(rec.plan.day * per, rec.plan.day * per + per);
    if (slice.length) {
      const first = slice[0], last = slice[slice.length - 1];
      const label = first.slug === last.slug ? `${first.book} ${first.chapter}${last.chapter > first.chapter ? `\u2013${last.chapter}` : ""}` : `${first.book} ${first.chapter} \u2013 ${last.book} ${last.chapter}`;
      return { kind: "plan", day: rec.plan.day, label, slug: first.slug, chapter: first.chapter, chapters: slice.map(({ slug, chapter: chapter2 }) => ({ slug, chapter: chapter2 })), param: chapterParam(first.slug, first.chapter) };
    }
  }
  if (rec.last) {
    const hit = all.find((c) => c.slug === rec.last.slug && c.chapter === rec.last.chapter);
    if (hit) return { kind: "last", label: `${hit.book} ${hit.chapter}`, slug: hit.slug, chapter: hit.chapter, chapters: [{ slug: hit.slug, chapter: hit.chapter }], param: chapterParam(hit.slug, hit.chapter) };
  }
  return null;
}
function markDone(rec, books2, now = /* @__PURE__ */ new Date()) {
  const { date } = localNow(rec.tz, now);
  if (rec.done === date) return rec;
  const next = { ...rec, done: date, pending: [...rec.pending ?? []] };
  const p = portion(rec, books2);
  if (p?.kind === "plan") {
    next.pending.push({ day: p.day, chapters: p.chapters, date });
    next.plan = { ...rec.plan, day: rec.plan.day + 1 };
  } else if (p?.kind === "last") {
    next.pending.push({ chapters: p.chapters, date });
    const all = flatChapters(books2);
    const i = all.findIndex((c) => c.slug === p.slug && c.chapter === p.chapter);
    if (i >= 0 && i + 1 < all.length) next.last = { slug: all[i + 1].slug, chapter: all[i + 1].chapter };
  }
  next.pending = next.pending.slice(-30);
  return next;
}
function pause(rec, now = /* @__PURE__ */ new Date(), until = PAUSE_DAYS) {
  const today = localNow(rec.tz, now).date;
  let end;
  if (until === "forever") end = PAUSE_FOREVER;
  else if (typeof until === "string" && DATE.test(until) && until > today && until <= addDays(today, 366)) end = until;
  else end = addDays(today, PAUSE_CHOICES.includes(until) ? until : PAUSE_DAYS);
  return { ...rec, pausedUntil: end };
}
function ackPending(rec, dates) {
  const set = new Set((Array.isArray(dates) ? dates : []).filter((d) => typeof d === "string" && DATE.test(d)));
  return { ...rec, pending: (rec.pending ?? []).filter((p) => !set.has(p.date)) };
}
function meta(rec) {
  return { o: rec.on ? 1 : 0, h: rec.hour, n: rec.minute ?? 0, z: rec.tz, t: reachable(rec, "telegram") ? 1 : 0, p: reachable(rec, "push") ? 1 : 0, u: rec.pausedUntil ?? "" };
}
function publicView(rec) {
  return {
    on: !!rec.on,
    hour: rec.hour,
    minute: rec.minute ?? 0,
    tz: rec.tz,
    channels: { telegram: !!rec.channels?.telegram, push: !!rec.channels?.push },
    telegramLinked: Number.isInteger(rec.chatId),
    pushEndpoints: (rec.pushes ?? []).map((p) => p.endpoint),
    pausedUntil: rec.pausedUntil ?? null,
    done: rec.done ?? null,
    pending: rec.pending ?? [],
    notice: rec.notice ?? null,
    plan: rec.plan ?? null,
    last: rec.last ?? null
  };
}

// src/remind.ts
var PREFIX = "remind:";
var recKey = (rid) => `${PREFIX}${rid}`;
var tgRid = async (env, uid) => `tg:${await pid(env, uid)}`;
var LINK_TTL = 15 * 60;
var IDLE_TTL = 180 * 86400;
var CREATE_PER_DAY = 100;
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function loadReminder(env, rid) {
  return open(env, recKey(rid), await env.SUBS.get(recKey(rid)));
}
async function saveReminder(env, rid, rec) {
  await env.SUBS.put(recKey(rid), await seal(env, recKey(rid), rec), { metadata: meta(rec), ...rid.startsWith("dev:") ? { expirationTtl: IDLE_TTL } : {} });
}
var putIndex = async (env, endpoint, rid) => env.SUBS.put(`pushep:${await sha256(endpoint)}`, rid, { expirationTtl: IDLE_TTL });
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function overLimit(env, key2) {
  if (!env.REMIND_LIMIT) return false;
  try {
    return !(await env.REMIND_LIMIT.limit({ key: key2 })).success;
  } catch {
    return false;
  }
}
var tooMany = (c) => c.json({ ok: false, error: "rate-limited" }, 429, { "retry-after": "60" });
var clientIp = (c) => c.req.header("cf-connecting-ip") ?? "unknown";
var pushable = (env, sub) => validSubscription(sub, env.PUSH_TEST_ORIGIN);
function vapidKeys(env) {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null;
}
var asked = /* @__PURE__ */ new WeakMap();
function who(c) {
  let w = asked.get(c.req.raw);
  if (!w) {
    w = resolveWho(c);
    asked.set(c.req.raw, w);
  }
  return w;
}
async function resolveWho(c) {
  const m = (c.req.header("authorization") ?? "").match(/^tma\s+(.+)$/i);
  if (m) {
    const data = await validateInitData(m[1], c.env.BOT_TOKEN, 30 * 86400);
    return data?.user ? { kind: "telegram", uid: data.user.id, rid: await tgRid(c.env, data.user.id) } : null;
  }
  const d = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/.exec(c.req.header("x-cj-device") ?? "");
  if (!d) return null;
  const saved = await c.env.SUBS.get(`remdev:${d[1]}`, "json");
  if (!saved || !same(saved.h, await sha256(d[2]))) return null;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (saved.t !== today) await c.env.SUBS.put(`remdev:${d[1]}`, JSON.stringify({ ...saved, t: today }), { expirationTtl: IDLE_TTL });
  return { kind: "device", dev: d[1], rid: saved.rid };
}
function telegramMessage(p) {
  return p.kind === "plan" ? `<b>Today's reading</b>
Day ${(p.day ?? 0) + 1} of your plan: ${escapeHtml(p.label)}` : `<b>Continue where you left off</b>
${escapeHtml(p.label)}`;
}
function telegramKeyboard(env, p, done = false) {
  const kb = openButton(env, env.WORKER_URL, "private", p.param, "Open");
  if (done) return kb;
  return kb.text("Done", "rd:done").row().text("Pause\u2026", "rd:pause").text("Stop", "rd:stop");
}
async function markTelegramDone(env, rec, before) {
  if (!before || !rec.tgMessage || !Number.isInteger(rec.chatId) || rec.tgMessage.date !== rec.done) return;
  try {
    await telegramApi(env).editMessageText(rec.chatId, rec.tgMessage.id, `${telegramMessage(before)}

\u2713 Done`, { parse_mode: "HTML", reply_markup: telegramKeyboard(env, before, true) });
  } catch {
  }
}
async function doneFor(env, rid, now = /* @__PURE__ */ new Date()) {
  const rec = await loadReminder(env, rid);
  if (!rec) return null;
  const list = await books(env) ?? [];
  const before = portion(rec, list);
  const next = markDone(rec, list, now);
  if (next === rec) return rec;
  await saveReminder(env, rid, next);
  await markTelegramDone(env, next, before);
  return next;
}
async function addPushTo(env, rid, rec, sub) {
  if (!pushable(env, sub)) return rec;
  const { rec: next, dropped } = addPush(rec, sub);
  await putIndex(env, sub.endpoint, rid);
  for (const e of dropped) await env.SUBS.delete(`pushep:${await sha256(e)}`);
  return next;
}
async function removePushFrom(env, rec, endpoint) {
  await env.SUBS.delete(`pushep:${await sha256(endpoint)}`);
  return removePush(rec, endpoint);
}
async function forgetLinkedDevices(env, rid, rec) {
  for (const dev of rec.devices ?? []) {
    if (!/^[0-9a-f]{32}$/.test(dev)) continue;
    const cred = await env.SUBS.get(`remdev:${dev}`, "json");
    if (cred?.rid === rid) await env.SUBS.delete(`remdev:${dev}`);
  }
}
var botUsername;
async function botLink(env, start) {
  botUsername ??= (await telegramApi(env).getMe()).username;
  return `https://t.me/${botUsername}?start=${start}`;
}
var reminders = new Hono4();
reminders.use("*", async (c, next) => {
  const w = await who(c);
  if (w && await overLimit(c.env, `${w.kind}:${w.kind === "telegram" ? w.uid : w.dev}`)) return tooMany(c);
  await next();
});
var view = (env, rec, extra = {}) => ({ ok: true, ...publicView(rec), publicKey: vapidKeys(env)?.publicKey ?? null, ...extra });
reminders.get("/", async (c) => {
  const w = await who(c);
  const tz = c.req.query("tz") ?? "UTC";
  if (!w) return c.json(view(c.env, blank(validTz(tz) ? tz : "UTC"), { identity: "none" }));
  const rec = await loadReminder(c.env, w.rid) ?? { ...blank(validTz(tz) ? tz : "UTC"), ...w.kind === "telegram" ? { chatId: w.uid } : {} };
  return c.json(view(c.env, rec, { identity: w.kind, linked: w.rid.startsWith("tg:") }));
});
reminders.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ ok: false, error: "bad-json" }, 400);
  if (body.push !== void 0 && !pushable(c.env, body.push)) return c.json({ ok: false, error: "bad-subscription" }, 400);
  let w = await who(c);
  let device;
  if (!w) {
    if (c.req.header("authorization") || c.req.header("x-cj-device")) return c.json({ ok: false, error: "unauthorized" }, 401);
    const ip = clientIp(c);
    if (await overLimit(c.env, `create:${ip}`)) return tooMany(c);
    const dayKey = `remcreate:${await keyedHash(c.env, "remcreate", ip)}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
    const made = Number(await c.env.SUBS.get(dayKey)) || 0;
    if (made >= CREATE_PER_DAY) return c.json({ ok: false, error: "rate-limited" }, 429, { "retry-after": "3600" });
    await c.env.SUBS.put(dayKey, String(made + 1), { expirationTtl: 2 * 86400 });
    const id2 = randomHex(16), secret = b64u(crypto.getRandomValues(new Uint8Array(32)));
    await c.env.SUBS.put(`remdev:${id2}`, JSON.stringify({ h: await sha256(secret), rid: `dev:${id2}`, t: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }), { expirationTtl: IDLE_TTL });
    w = { kind: "device", dev: id2, rid: `dev:${id2}` };
    device = `${id2}.${secret}`;
  }
  const now = /* @__PURE__ */ new Date();
  const saved = await loadReminder(c.env, w.rid);
  if (!saved && w.kind === "device" && w.rid.startsWith("tg:")) {
    await c.env.SUBS.delete(`remdev:${w.dev}`);
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  let rec = saved ?? blank();
  if (w.kind === "telegram") rec.chatId = w.uid;
  rec = applySettings(rec, body.settings, now);
  rec = applyContent(rec, body.content);
  if (body.push !== void 0) rec = await addPushTo(c.env, w.rid, rec, body.push);
  if (typeof body.pushRemove === "string" && body.pushRemove.length <= 1024) rec = await removePushFrom(c.env, rec, body.pushRemove);
  if (body.notice === false) delete rec.notice;
  if (!(device && !rec.on && !rec.pushes?.length)) await saveReminder(c.env, w.rid, rec);
  return c.json(view(c.env, rec, { identity: w.kind, linked: w.rid.startsWith("tg:"), ...device ? { device } : {} }));
});
async function forgetReminder(env, uid) {
  const rid = await tgRid(env, uid);
  const rec = await loadReminder(env, rid);
  if (!rec) return false;
  for (const p of rec.pushes ?? []) await env.SUBS.delete(`pushep:${await sha256(p.endpoint)}`);
  await forgetLinkedDevices(env, rid, rec);
  await env.SUBS.delete(recKey(rid));
  return true;
}
reminders.delete("/", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const rec = await loadReminder(c.env, w.rid);
  const forgetAll = w.kind === "telegram" || w.rid.startsWith("dev:");
  if (rec && forgetAll) {
    for (const p of rec.pushes ?? []) await c.env.SUBS.delete(`pushep:${await sha256(p.endpoint)}`);
    if (w.rid.startsWith("tg:")) await forgetLinkedDevices(c.env, w.rid, rec);
    await c.env.SUBS.delete(recKey(w.rid));
  } else if (rec && typeof body?.endpoint === "string" && body.endpoint.length <= 1024) {
    await saveReminder(c.env, w.rid, await removePushFrom(c.env, rec, body.endpoint));
  }
  if (w.kind === "device") await c.env.SUBS.delete(`remdev:${w.dev}`);
  return c.json({ ok: true });
});
reminders.post("/done", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const rec = await doneFor(c.env, w.rid);
  return rec ? c.json(view(c.env, rec)) : c.json({ ok: false, error: "not-found" }, 404);
});
reminders.post("/ack", async (c) => {
  const w = await who(c);
  if (!w) return c.json({ ok: false, error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  const rec = await loadReminder(c.env, w.rid);
  if (!rec) return c.json({ ok: true });
  const next = ackPending(rec, body?.dates);
  await saveReminder(c.env, w.rid, next);
  return c.json(view(c.env, next));
});
reminders.post("/link", async (c) => {
  const w = await who(c);
  if (!w || w.kind !== "device") return c.json({ ok: false, error: "unauthorized" }, 401);
  const code = randomHex(16);
  await c.env.SUBS.put(`remlink:${code}`, w.dev, { expirationTtl: LINK_TTL });
  try {
    return c.json({ ok: true, link: await botLink(c.env, `remind_${code}`) });
  } catch {
    return c.json({ ok: false, error: "unavailable" }, 503);
  }
});
var push = new Hono4();
push.get("/key", (c) => c.json({ publicKey: vapidKeys(c.env)?.publicKey ?? null }));
push.use("/*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  const body = await c.req.raw.clone().json().catch(() => null);
  const ep = typeof body?.endpoint === "string" ? body.endpoint : typeof body?.old === "string" ? body.old : "";
  if (await overLimit(c.env, ep ? `ep:${await sha256(ep)}` : `ip:${clientIp(c)}`)) return tooMany(c);
  await next();
});
async function byEndpoint(c) {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.endpoint !== "string" || body.endpoint.length > 1024) return null;
  return c.env.SUBS.get(`pushep:${await sha256(body.endpoint)}`);
}
push.post("/renew", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.old !== "string" || body.old.length > 1024 || !pushable(c.env, body.sub)) return c.json({ ok: false }, 400);
  const rid = await c.env.SUBS.get(`pushep:${await sha256(body.old)}`);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  if (!rid || !rec) return c.json({ ok: false }, 404);
  const next = await addPushTo(c.env, rid, await removePushFrom(c.env, rec, body.old), body.sub);
  await saveReminder(c.env, rid, next);
  return c.json({ ok: true });
});
push.post("/today", async (c) => {
  const rid = await byEndpoint(c);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  const p = rec ? portion(rec, await books(c.env) ?? []) : null;
  if (!rec || !p) return c.json({ ok: false }, 404);
  const done = rec.done === localNow(rec.tz).date;
  return c.json({ ok: true, done, title: p.kind === "plan" ? "Today's reading" : "Continue where you left off", body: p.kind === "plan" ? `Day ${(p.day ?? 0) + 1} of your plan: ${p.label}` : p.label, param: p.param });
});
push.post("/done", async (c) => {
  const rid = await byEndpoint(c);
  if (!rid || !await doneFor(c.env, rid)) return c.json({ ok: false }, 404);
  return c.json({ ok: true });
});
push.post("/pause", async (c) => {
  const rid = await byEndpoint(c);
  const rec = rid ? await loadReminder(c.env, rid) : null;
  if (!rid || !rec) return c.json({ ok: false }, 404);
  await saveReminder(c.env, rid, pause(rec, /* @__PURE__ */ new Date(), 7));
  return c.json({ ok: true });
});
var QUARTER = 15 * 6e4;

// src/bot.ts
function openButton(env, origin, chatType, param, text3 = "Open in CyberJudah") {
  const kb = new InlineKeyboard3();
  const base = origin || env.WORKER_URL;
  if (chatType === "private" && base) return kb.webApp(text3, `${base}/${param ? `?tgWebAppStartParam=${param}` : ""}`);
  return kb.url(text3, openLink(env, param));
}
var HELP = [
  "<b>CyberJudah</b> \u2014 the KJV with the Apocrypha, the classes, the law, the precepts and the cases.",
  "",
  "/verse \u2014 today's verse",
  "/daily \u2014 the daily verse, on or off",
  "/stop \u2014 stop reading reminders",
  "/support \u2014 support the work with Telegram Stars",
  "/privacy \u2014 what is kept about you, and your choices",
  "/terms \u2014 the terms for the Ask balance",
  "/paysupport \u2014 help with a Stars payment",
  "/help \u2014 this",
  "",
  "In any chat, type <code>@BOT matthew 15:24</code> or <code>@BOT passover</code> to send a verse or a search hit."
].join("\n");

// ../shared/cms-classes.ts
import { z as z3 } from "zod";

// ../shared/cms.ts
import { z as z2 } from "zod";

// ../shared/cms-bible.json
var cms_bible_default = { source: { repository: "DevSecObie/cyberjudah", commit: "f83224a50a2623f7e68a2fe3558703124d62d9fb" }, books: [{ book: "Genesis", slug: "genesis", sha256: "82a306c052dee69050a95190f54c7d4b130fe41d49772639610faa613e5eaa38", chapters: { "1": 31, "2": 25, "3": 24, "4": 26, "5": 32, "6": 22, "7": 24, "8": 22, "9": 29, "10": 32, "11": 32, "12": 20, "13": 18, "14": 24, "15": 21, "16": 16, "17": 27, "18": 33, "19": 38, "20": 18, "21": 34, "22": 24, "23": 20, "24": 67, "25": 34, "26": 35, "27": 46, "28": 22, "29": 35, "30": 43, "31": 55, "32": 32, "33": 20, "34": 31, "35": 29, "36": 43, "37": 36, "38": 30, "39": 23, "40": 23, "41": 57, "42": 38, "43": 34, "44": 34, "45": 28, "46": 34, "47": 31, "48": 22, "49": 33, "50": 26 } }, { book: "Exodus", slug: "exodus", sha256: "3118a9faa107a1addc5eaed3dbfc496b332015796bab5da4e5103277a0dd7089", chapters: { "1": 22, "2": 25, "3": 22, "4": 31, "5": 23, "6": 30, "7": 25, "8": 32, "9": 35, "10": 29, "11": 10, "12": 51, "13": 22, "14": 31, "15": 27, "16": 36, "17": 16, "18": 27, "19": 25, "20": 26, "21": 36, "22": 31, "23": 33, "24": 18, "25": 40, "26": 37, "27": 21, "28": 43, "29": 46, "30": 38, "31": 18, "32": 35, "33": 23, "34": 35, "35": 35, "36": 38, "37": 29, "38": 31, "39": 43, "40": 38 } }, { book: "Leviticus", slug: "leviticus", sha256: "638220cf41de808536e7baeb83a55ef937000ff248d4cebb8e9932af8cd59a91", chapters: { "1": 17, "2": 16, "3": 17, "4": 35, "5": 19, "6": 30, "7": 38, "8": 36, "9": 24, "10": 20, "11": 47, "12": 8, "13": 59, "14": 57, "15": 33, "16": 34, "17": 16, "18": 30, "19": 37, "20": 27, "21": 24, "22": 33, "23": 44, "24": 23, "25": 55, "26": 46, "27": 34 } }, { book: "Numbers", slug: "numbers", sha256: "f30a0dbeb745e58bcb8526d920703aed82e353122b210bdbb101ef16833d1c92", chapters: { "1": 54, "2": 34, "3": 51, "4": 49, "5": 31, "6": 27, "7": 89, "8": 26, "9": 23, "10": 36, "11": 35, "12": 16, "13": 33, "14": 45, "15": 41, "16": 50, "17": 13, "18": 32, "19": 22, "20": 29, "21": 35, "22": 41, "23": 30, "24": 25, "25": 18, "26": 65, "27": 23, "28": 31, "29": 40, "30": 16, "31": 54, "32": 42, "33": 56, "34": 29, "35": 34, "36": 13 } }, { book: "Deuteronomy", slug: "deuteronomy", sha256: "e26ad49a5aa43417d6bbe4e4e3f1d0c9f1980b2220150eea1779ec9cb2fe6d2c", chapters: { "1": 46, "2": 37, "3": 29, "4": 49, "5": 33, "6": 25, "7": 26, "8": 20, "9": 29, "10": 22, "11": 32, "12": 32, "13": 18, "14": 29, "15": 23, "16": 22, "17": 20, "18": 22, "19": 21, "20": 20, "21": 23, "22": 30, "23": 25, "24": 22, "25": 19, "26": 19, "27": 26, "28": 68, "29": 29, "30": 20, "31": 30, "32": 52, "33": 29, "34": 12 } }, { book: "Joshua", slug: "joshua", sha256: "660f412ead3362873ca0bc3fcea7fdcc9d7bfd37db7f14f1e8b1e64e167dd9cf", chapters: { "1": 18, "2": 24, "3": 17, "4": 24, "5": 15, "6": 27, "7": 26, "8": 35, "9": 27, "10": 43, "11": 23, "12": 24, "13": 33, "14": 15, "15": 63, "16": 10, "17": 18, "18": 28, "19": 51, "20": 9, "21": 45, "22": 34, "23": 16, "24": 33 } }, { book: "Judges", slug: "judges", sha256: "03bdbe846a96123418e6345055ac22daa129a6514a93f043430d2d5192abe126", chapters: { "1": 36, "2": 23, "3": 31, "4": 24, "5": 31, "6": 40, "7": 25, "8": 35, "9": 57, "10": 18, "11": 40, "12": 15, "13": 25, "14": 20, "15": 20, "16": 31, "17": 13, "18": 31, "19": 30, "20": 48, "21": 25 } }, { book: "Ruth", slug: "ruth", sha256: "00e2395a6911d67f096ac969c0a201e731222d20d2d74269209aceb08565bbb2", chapters: { "1": 22, "2": 23, "3": 18, "4": 22 } }, { book: "1 Samuel", slug: "1-samuel", sha256: "884bc2cd39c2add4c852b24a20b323b17fced1079866a32dbeee1b9b88cf1124", chapters: { "1": 28, "2": 36, "3": 21, "4": 22, "5": 12, "6": 21, "7": 17, "8": 22, "9": 27, "10": 27, "11": 15, "12": 25, "13": 23, "14": 52, "15": 35, "16": 23, "17": 58, "18": 30, "19": 24, "20": 42, "21": 15, "22": 23, "23": 29, "24": 22, "25": 44, "26": 25, "27": 12, "28": 25, "29": 11, "30": 31, "31": 13 } }, { book: "2 Samuel", slug: "2-samuel", sha256: "5aef8030584443f95df97afcee2d6349562552251a7f881a556a8ab40e243ac6", chapters: { "1": 27, "2": 32, "3": 39, "4": 12, "5": 25, "6": 23, "7": 29, "8": 18, "9": 13, "10": 19, "11": 27, "12": 31, "13": 39, "14": 33, "15": 37, "16": 23, "17": 29, "18": 33, "19": 43, "20": 26, "21": 22, "22": 51, "23": 39, "24": 25 } }, { book: "1 Kings", slug: "1-kings", sha256: "484fbff1bfb4fee6d2279cc36cd2a8065b9f25cbfffe2199a41b88f555f36f75", chapters: { "1": 53, "2": 46, "3": 28, "4": 34, "5": 18, "6": 38, "7": 51, "8": 66, "9": 28, "10": 29, "11": 43, "12": 33, "13": 34, "14": 31, "15": 34, "16": 34, "17": 24, "18": 46, "19": 21, "20": 43, "21": 29, "22": 53 } }, { book: "2 Kings", slug: "2-kings", sha256: "b424ade55cfc560aec1aff3d73e10a26a06e4ad2e09c31578ae8e2c3b64ef798", chapters: { "1": 18, "2": 25, "3": 27, "4": 44, "5": 27, "6": 33, "7": 20, "8": 29, "9": 37, "10": 36, "11": 21, "12": 21, "13": 25, "14": 29, "15": 38, "16": 20, "17": 41, "18": 37, "19": 37, "20": 21, "21": 26, "22": 20, "23": 37, "24": 20, "25": 30 } }, { book: "1 Chronicles", slug: "1-chronicles", sha256: "fc4b7ea5ccf5fd1c8400fd949bd7f3d91d687087c28797e453a98948061da70c", chapters: { "1": 54, "2": 55, "3": 24, "4": 43, "5": 26, "6": 81, "7": 40, "8": 40, "9": 44, "10": 14, "11": 47, "12": 40, "13": 14, "14": 17, "15": 29, "16": 43, "17": 27, "18": 17, "19": 19, "20": 8, "21": 30, "22": 19, "23": 32, "24": 31, "25": 31, "26": 32, "27": 34, "28": 21, "29": 30 } }, { book: "2 Chronicles", slug: "2-chronicles", sha256: "42152d9cc38a6aad7e412577e23d5f9b05bcd4c0d33d36e65913498bd4ca88de", chapters: { "1": 17, "2": 18, "3": 17, "4": 22, "5": 14, "6": 42, "7": 22, "8": 18, "9": 31, "10": 19, "11": 23, "12": 16, "13": 22, "14": 15, "15": 19, "16": 14, "17": 19, "18": 34, "19": 11, "20": 37, "21": 20, "22": 12, "23": 21, "24": 27, "25": 28, "26": 23, "27": 9, "28": 27, "29": 36, "30": 27, "31": 21, "32": 33, "33": 25, "34": 33, "35": 27, "36": 23 } }, { book: "Ezra", slug: "ezra", sha256: "1e6b41c031f68f9f68c7e3332e5b516162e8d4e84109ed9f368c5042c0c57d82", chapters: { "1": 11, "2": 70, "3": 13, "4": 24, "5": 17, "6": 22, "7": 28, "8": 36, "9": 15, "10": 44 } }, { book: "Nehemiah", slug: "nehemiah", sha256: "d6e05c7973c24f6247f6cdd451bbac3c32e1f21439f756100727cee0570d3a09", chapters: { "1": 11, "2": 20, "3": 32, "4": 23, "5": 19, "6": 19, "7": 73, "8": 18, "9": 38, "10": 39, "11": 36, "12": 47, "13": 31 } }, { book: "Esther", slug: "esther", sha256: "6fbc352b84862b02ebc1107315e3b4f0c9219722176420994da95dd114d2ea8a", chapters: { "1": 22, "2": 23, "3": 15, "4": 17, "5": 14, "6": 14, "7": 10, "8": 17, "9": 32, "10": 3 } }, { book: "Job", slug: "job", sha256: "f1e8c3c019a494dbd520c4151346e2ac3b23db6c9ce89e939d622ee13f9896fc", chapters: { "1": 22, "2": 13, "3": 26, "4": 21, "5": 27, "6": 30, "7": 21, "8": 22, "9": 35, "10": 22, "11": 20, "12": 25, "13": 28, "14": 22, "15": 35, "16": 22, "17": 16, "18": 21, "19": 29, "20": 29, "21": 34, "22": 30, "23": 17, "24": 25, "25": 6, "26": 14, "27": 23, "28": 28, "29": 25, "30": 31, "31": 40, "32": 22, "33": 33, "34": 37, "35": 16, "36": 33, "37": 24, "38": 41, "39": 30, "40": 24, "41": 34, "42": 17 } }, { book: "Psalms", slug: "psalms", sha256: "e5f66a23f099f6629cbbeeeaf66adde217cc4d841838df794fa9ce9d4b862787", chapters: { "1": 6, "2": 12, "3": 8, "4": 8, "5": 12, "6": 10, "7": 17, "8": 9, "9": 20, "10": 18, "11": 7, "12": 8, "13": 6, "14": 7, "15": 5, "16": 11, "17": 15, "18": 50, "19": 14, "20": 9, "21": 13, "22": 31, "23": 6, "24": 10, "25": 22, "26": 12, "27": 14, "28": 9, "29": 11, "30": 12, "31": 24, "32": 11, "33": 22, "34": 22, "35": 28, "36": 12, "37": 40, "38": 22, "39": 13, "40": 17, "41": 13, "42": 11, "43": 5, "44": 26, "45": 17, "46": 11, "47": 9, "48": 14, "49": 20, "50": 23, "51": 19, "52": 9, "53": 6, "54": 7, "55": 23, "56": 13, "57": 11, "58": 11, "59": 17, "60": 12, "61": 8, "62": 12, "63": 11, "64": 10, "65": 13, "66": 20, "67": 7, "68": 35, "69": 36, "70": 5, "71": 24, "72": 20, "73": 28, "74": 23, "75": 10, "76": 12, "77": 20, "78": 72, "79": 13, "80": 19, "81": 16, "82": 8, "83": 18, "84": 12, "85": 13, "86": 17, "87": 7, "88": 18, "89": 52, "90": 17, "91": 16, "92": 15, "93": 5, "94": 23, "95": 11, "96": 13, "97": 12, "98": 9, "99": 9, "100": 5, "101": 8, "102": 28, "103": 22, "104": 35, "105": 45, "106": 48, "107": 43, "108": 13, "109": 31, "110": 7, "111": 10, "112": 10, "113": 9, "114": 8, "115": 18, "116": 19, "117": 2, "118": 29, "119": 176, "120": 7, "121": 8, "122": 9, "123": 4, "124": 8, "125": 5, "126": 6, "127": 5, "128": 6, "129": 8, "130": 8, "131": 3, "132": 18, "133": 3, "134": 3, "135": 21, "136": 26, "137": 9, "138": 8, "139": 24, "140": 13, "141": 10, "142": 7, "143": 12, "144": 15, "145": 21, "146": 10, "147": 20, "148": 14, "149": 9, "150": 6 } }, { book: "Proverbs", slug: "proverbs", sha256: "211c65b9a6a1d95828626edcca69ed88d4a9a238a28ab00217082f65cfa16ae5", chapters: { "1": 33, "2": 22, "3": 35, "4": 27, "5": 23, "6": 35, "7": 27, "8": 36, "9": 18, "10": 32, "11": 31, "12": 28, "13": 25, "14": 35, "15": 33, "16": 33, "17": 28, "18": 24, "19": 29, "20": 30, "21": 31, "22": 29, "23": 35, "24": 34, "25": 28, "26": 28, "27": 27, "28": 28, "29": 27, "30": 33, "31": 31 } }, { book: "Ecclesiastes", slug: "ecclesiastes", sha256: "2c628ae99e818b483638ca9644d5994bc0282079d23e45ce1512444b63d98bcf", chapters: { "1": 18, "2": 26, "3": 22, "4": 16, "5": 20, "6": 12, "7": 29, "8": 17, "9": 18, "10": 20, "11": 10, "12": 14 } }, { book: "Song of Solomon", slug: "song-of-solomon", sha256: "28c259d38e28a7991df6d7c13ffbb66fce31da694d423e26d4d57b4b826e4ae1", chapters: { "1": 17, "2": 17, "3": 11, "4": 16, "5": 16, "6": 13, "7": 13, "8": 14 } }, { book: "Isaiah", slug: "isaiah", sha256: "a6097d1911d790122b827318df76a381a53105a39585f1edfd7b8a67e23b6be4", chapters: { "1": 31, "2": 22, "3": 26, "4": 6, "5": 30, "6": 13, "7": 25, "8": 22, "9": 21, "10": 34, "11": 16, "12": 6, "13": 22, "14": 32, "15": 9, "16": 14, "17": 14, "18": 7, "19": 25, "20": 6, "21": 17, "22": 25, "23": 18, "24": 23, "25": 12, "26": 21, "27": 13, "28": 29, "29": 24, "30": 33, "31": 9, "32": 20, "33": 24, "34": 17, "35": 10, "36": 22, "37": 38, "38": 22, "39": 8, "40": 31, "41": 29, "42": 25, "43": 28, "44": 28, "45": 25, "46": 13, "47": 15, "48": 22, "49": 26, "50": 11, "51": 23, "52": 15, "53": 12, "54": 17, "55": 13, "56": 12, "57": 21, "58": 14, "59": 21, "60": 22, "61": 11, "62": 12, "63": 19, "64": 12, "65": 25, "66": 24 } }, { book: "Jeremiah", slug: "jeremiah", sha256: "e3ef9c783e5d4c97700b243e6ac187ce7bf89954d02940207e67a6abc12da797", chapters: { "1": 19, "2": 37, "3": 25, "4": 31, "5": 31, "6": 30, "7": 34, "8": 22, "9": 26, "10": 25, "11": 23, "12": 17, "13": 27, "14": 22, "15": 21, "16": 21, "17": 27, "18": 23, "19": 15, "20": 18, "21": 14, "22": 30, "23": 40, "24": 10, "25": 38, "26": 24, "27": 22, "28": 17, "29": 32, "30": 24, "31": 40, "32": 44, "33": 26, "34": 22, "35": 19, "36": 32, "37": 21, "38": 28, "39": 18, "40": 16, "41": 18, "42": 22, "43": 13, "44": 30, "45": 5, "46": 28, "47": 7, "48": 47, "49": 39, "50": 46, "51": 64, "52": 34 } }, { book: "Lamentations", slug: "lamentations", sha256: "3d51eb3d5752e846484adf717ab6f5b4f93528ee6d022e973f7994c4224490d1", chapters: { "1": 22, "2": 22, "3": 66, "4": 22, "5": 22 } }, { book: "Ezekiel", slug: "ezekiel", sha256: "2ee73d257f2d2594a8fced39283bd51001d072cc3a92f6ae7a939e2b53455f80", chapters: { "1": 28, "2": 10, "3": 27, "4": 17, "5": 17, "6": 14, "7": 27, "8": 18, "9": 11, "10": 22, "11": 25, "12": 28, "13": 23, "14": 23, "15": 8, "16": 63, "17": 24, "18": 32, "19": 14, "20": 49, "21": 32, "22": 31, "23": 49, "24": 27, "25": 17, "26": 21, "27": 36, "28": 26, "29": 21, "30": 26, "31": 18, "32": 32, "33": 33, "34": 31, "35": 15, "36": 38, "37": 28, "38": 23, "39": 29, "40": 49, "41": 26, "42": 20, "43": 27, "44": 31, "45": 25, "46": 24, "47": 23, "48": 35 } }, { book: "Daniel", slug: "daniel", sha256: "d0af1ff5755955db431b308a7b893d43a7437a8fe71108cdcb7a99660498c00c", chapters: { "1": 21, "2": 49, "3": 30, "4": 37, "5": 31, "6": 28, "7": 28, "8": 27, "9": 27, "10": 21, "11": 45, "12": 13 } }, { book: "Hosea", slug: "hosea", sha256: "524dd94ab335041328703f798ded8d7c6aa598edbf6d734de52cf200fd967c71", chapters: { "1": 11, "2": 23, "3": 5, "4": 19, "5": 15, "6": 11, "7": 16, "8": 14, "9": 17, "10": 15, "11": 12, "12": 14, "13": 16, "14": 9 } }, { book: "Joel", slug: "joel", sha256: "7f4e6c647c8930aaa909812e0b3f4fd839c2ceeb20424a8a9d2f17ae22f30726", chapters: { "1": 20, "2": 32, "3": 21 } }, { book: "Amos", slug: "amos", sha256: "c473bfd8f4bfa24d5d7b7520fe96e92245b36319d77162d3fc592b0f1f21a075", chapters: { "1": 15, "2": 16, "3": 15, "4": 13, "5": 27, "6": 14, "7": 17, "8": 14, "9": 15 } }, { book: "Obadiah", slug: "obadiah", sha256: "5a3f050de69d72be7fe59daaea24cdb2a6cd33f15308820caf3b2ea4a8de6fc4", chapters: { "1": 21 } }, { book: "Jonah", slug: "jonah", sha256: "a6fc6ba0119d45aa1f4687f112041457a3bc1629fe86b531a9cdc85e8d8e19c1", chapters: { "1": 17, "2": 10, "3": 10, "4": 11 } }, { book: "Micah", slug: "micah", sha256: "6713a3370b64f2711bd753d8d1f9e07bce02519cba02bfa9750b22fdd7b5a756", chapters: { "1": 16, "2": 13, "3": 12, "4": 13, "5": 15, "6": 16, "7": 20 } }, { book: "Nahum", slug: "nahum", sha256: "978a41d9e8e8e87823bec65dc60de98fa8e5e36c48ec82bc80158b56f1b87805", chapters: { "1": 15, "2": 13, "3": 19 } }, { book: "Habakkuk", slug: "habakkuk", sha256: "a5c0936f2bdde3ead068e34b522b7605c59feef9513a9faab77e230322db3e8b", chapters: { "1": 17, "2": 20, "3": 19 } }, { book: "Zephaniah", slug: "zephaniah", sha256: "e9cf7d59f560f6699d5c36d012b76e1042461841e5baae22cc8f35e93dc70cd7", chapters: { "1": 18, "2": 15, "3": 20 } }, { book: "Haggai", slug: "haggai", sha256: "747f81363b5f754c1d3cf629c2269f59a53142c22fdf6caf9d4d405072ac4a45", chapters: { "1": 15, "2": 23 } }, { book: "Zechariah", slug: "zechariah", sha256: "397c39203bb8075655f9a9b0d9e3de5d97cf7e5f40da6ffbc7afafa4af6f29e5", chapters: { "1": 21, "2": 13, "3": 10, "4": 14, "5": 11, "6": 15, "7": 14, "8": 23, "9": 17, "10": 12, "11": 17, "12": 14, "13": 9, "14": 21 } }, { book: "Malachi", slug: "malachi", sha256: "a69f5517ea520036811f62e60a5fab96942e00f661590f538160edcba1e1d795", chapters: { "1": 14, "2": 17, "3": 18, "4": 6 } }, { book: "Matthew", slug: "matthew", sha256: "bf08e8b6102494424375759b6779b32ccaa5628c576e1d1d179e12875e5fc210", chapters: { "1": 25, "2": 23, "3": 17, "4": 25, "5": 48, "6": 34, "7": 29, "8": 34, "9": 38, "10": 42, "11": 30, "12": 50, "13": 58, "14": 36, "15": 39, "16": 28, "17": 27, "18": 35, "19": 30, "20": 34, "21": 46, "22": 46, "23": 39, "24": 51, "25": 46, "26": 75, "27": 66, "28": 20 } }, { book: "Mark", slug: "mark", sha256: "081320e7fccaf82ab317f7636a5b5c844f4b5dc47ca1b53227937f553b15b842", chapters: { "1": 45, "2": 28, "3": 35, "4": 41, "5": 43, "6": 56, "7": 37, "8": 38, "9": 50, "10": 52, "11": 33, "12": 44, "13": 37, "14": 72, "15": 47, "16": 20 } }, { book: "Luke", slug: "luke", sha256: "36765c7ae2c7f0b05958ff1d69e272fa61fe508e085f6ae6ccfece825437f6fb", chapters: { "1": 80, "2": 52, "3": 38, "4": 44, "5": 39, "6": 49, "7": 50, "8": 56, "9": 62, "10": 42, "11": 54, "12": 59, "13": 35, "14": 35, "15": 32, "16": 31, "17": 37, "18": 43, "19": 48, "20": 47, "21": 38, "22": 71, "23": 56, "24": 53 } }, { book: "John", slug: "john", sha256: "eacd52dc24a682618466acc60967295771160e49241e097b38b61f3cbbeaf9c2", chapters: { "1": 51, "2": 25, "3": 36, "4": 54, "5": 47, "6": 71, "7": 53, "8": 59, "9": 41, "10": 42, "11": 57, "12": 50, "13": 38, "14": 31, "15": 27, "16": 33, "17": 26, "18": 40, "19": 42, "20": 31, "21": 25 } }, { book: "Acts", slug: "acts", sha256: "2308a70ae45714dee4362f09206b392e52ca258823e3582e03ca2dce450ee907", chapters: { "1": 26, "2": 47, "3": 26, "4": 37, "5": 42, "6": 15, "7": 60, "8": 40, "9": 43, "10": 48, "11": 30, "12": 25, "13": 52, "14": 28, "15": 41, "16": 40, "17": 34, "18": 28, "19": 41, "20": 38, "21": 40, "22": 30, "23": 35, "24": 27, "25": 27, "26": 32, "27": 44, "28": 31 } }, { book: "Romans", slug: "romans", sha256: "0427c69104fb46858f22707f63fc68f5e16fef06401a614fd6d0b43f914b44f2", chapters: { "1": 32, "2": 29, "3": 31, "4": 25, "5": 21, "6": 23, "7": 25, "8": 39, "9": 33, "10": 21, "11": 36, "12": 21, "13": 14, "14": 23, "15": 33, "16": 27 } }, { book: "1 Corinthians", slug: "1-corinthians", sha256: "227bd563607ab30d752afe49082d204872bf6490671aa986464c4608616bf2af", chapters: { "1": 31, "2": 16, "3": 23, "4": 21, "5": 13, "6": 20, "7": 40, "8": 13, "9": 27, "10": 33, "11": 34, "12": 31, "13": 13, "14": 40, "15": 58, "16": 24 } }, { book: "2 Corinthians", slug: "2-corinthians", sha256: "beb7b11b6a45793dcba44e4c21751e649e1386540a446977d51d80b546ca14d7", chapters: { "1": 24, "2": 17, "3": 18, "4": 18, "5": 21, "6": 18, "7": 16, "8": 24, "9": 15, "10": 18, "11": 33, "12": 21, "13": 14 } }, { book: "Galatians", slug: "galatians", sha256: "0dcccacbb052c691638687380642dc565820b66aa459ce91ce5c4140346f159d", chapters: { "1": 24, "2": 21, "3": 29, "4": 31, "5": 26, "6": 18 } }, { book: "Ephesians", slug: "ephesians", sha256: "b5ca75760503cf518024c0d77f1cdc664bf4329330d72dad689deb851e69a680", chapters: { "1": 23, "2": 22, "3": 21, "4": 32, "5": 33, "6": 24 } }, { book: "Philippians", slug: "philippians", sha256: "a9efe8f86b883136b237b8090df001b66ac0a22e11886d2a0f953450dbcba9fe", chapters: { "1": 30, "2": 30, "3": 21, "4": 23 } }, { book: "Colossians", slug: "colossians", sha256: "cea98d30036769d2cb96b427a05b1fdadcb21d94d8048cda3a74b335d6bfe948", chapters: { "1": 29, "2": 23, "3": 25, "4": 18 } }, { book: "1 Thessalonians", slug: "1-thessalonians", sha256: "533722ed4ba0a98c2801f567adeb42209337cc3fa7193b3116abf435827217cc", chapters: { "1": 10, "2": 20, "3": 13, "4": 18, "5": 28 } }, { book: "2 Thessalonians", slug: "2-thessalonians", sha256: "0a8252d211cf95379b2e984345bc3727565572b8be0bf359db2a3d5273da5543", chapters: { "1": 12, "2": 17, "3": 18 } }, { book: "1 Timothy", slug: "1-timothy", sha256: "202b4dd31767cebd0a3f32e4449a60f8fe5d8d1fd44b248bb36973ddd175c415", chapters: { "1": 20, "2": 15, "3": 16, "4": 16, "5": 25, "6": 21 } }, { book: "2 Timothy", slug: "2-timothy", sha256: "c318b38603f511caed6fd1b9d3c4aefacd7ced69a0be01ef39266492a7f9c937", chapters: { "1": 18, "2": 26, "3": 17, "4": 22 } }, { book: "Titus", slug: "titus", sha256: "273e18065dbb5b59d72ff2a38aa04f4b370ffd38428e1fbd69c0bd0c335eb659", chapters: { "1": 16, "2": 15, "3": 15 } }, { book: "Philemon", slug: "philemon", sha256: "1ad055334328a1ca7911f78ad302bbfc7ea10618e26b272978f8f41767c66b8a", chapters: { "1": 25 } }, { book: "Hebrews", slug: "hebrews", sha256: "0ec0cbd3c7dee84459c5af7ef8739f32a690b5e8fdc6b368e32ead866363b6e8", chapters: { "1": 14, "2": 18, "3": 19, "4": 16, "5": 14, "6": 20, "7": 28, "8": 13, "9": 28, "10": 39, "11": 40, "12": 29, "13": 25 } }, { book: "James", slug: "james", sha256: "0c8d720bead1c2244ab54a3ae7553b547a69a7ec3c8ab011225634b37b9beb32", chapters: { "1": 27, "2": 26, "3": 18, "4": 17, "5": 20 } }, { book: "1 Peter", slug: "1-peter", sha256: "eb276546913f0daf68becd9051d22ba62edf4f22f449452ff9b861781b581a23", chapters: { "1": 25, "2": 25, "3": 22, "4": 19, "5": 14 } }, { book: "2 Peter", slug: "2-peter", sha256: "9f2cd647f14ea82bf77e0da6842892ac57161b46d6d862375e1c3fa662af1837", chapters: { "1": 21, "2": 22, "3": 18 } }, { book: "1 John", slug: "1-john", sha256: "597ffd2ca4b03b5dd9b5f2215f351b81726a656191553d44e5ec096363535602", chapters: { "1": 10, "2": 29, "3": 24, "4": 21, "5": 21 } }, { book: "2 John", slug: "2-john", sha256: "fc8d56e7bf809bdfba6b3470536093663b8a0aa14587a3723fcc9fa451dcacca", chapters: { "1": 13 } }, { book: "3 John", slug: "3-john", sha256: "00ab2378ecedfe65e83c616b5e00c616e607260d29a133560c8cccc272dbba3d", chapters: { "1": 14 } }, { book: "Jude", slug: "jude", sha256: "805d32d6d39ecfff8ac096af83b3d4e09740f1e208a1a5a558bc0dfa1b1db4a8", chapters: { "1": 25 } }, { book: "Revelation", slug: "revelation", sha256: "c54578766557d40e7f58d2446705a7fc4f55624590d28ee1b771a549e9d38d18", chapters: { "1": 20, "2": 29, "3": 22, "4": 11, "5": 14, "6": 17, "7": 17, "8": 13, "9": 21, "10": 11, "11": 19, "12": 17, "13": 18, "14": 20, "15": 8, "16": 21, "17": 18, "18": 24, "19": 21, "20": 15, "21": 27, "22": 21 } }, { book: "1 Esdras", slug: "1-esdras", sha256: "7b2ce4a2c3f20a0f18f30fdd951d7864d4bdadc4a00367aa4ef13d4249a54a7d", chapters: { "1": 58, "2": 30, "3": 24, "4": 63, "5": 73, "6": 34, "7": 15, "8": 96, "9": 55 } }, { book: "2 Esdras", slug: "2-esdras", sha256: "dc82861680dd5394c8aa16f00b1a51f4779cbe421573dcba8df51324ab43a510", chapters: { "1": 40, "2": 48, "3": 36, "4": 52, "5": 56, "6": 59, "7": 70, "8": 63, "9": 47, "10": 59, "11": 46, "12": 51, "13": 58, "14": 48, "15": 63, "16": 78 } }, { book: "Tobit", slug: "tobit", sha256: "4158ff333b3a2b2aa32e9f5f64a462e2e46893c8525eb499e09417c8e9e87229", chapters: { "1": 22, "2": 14, "3": 17, "4": 21, "5": 22, "6": 17, "7": 18, "8": 21, "9": 6, "10": 12, "11": 19, "12": 22, "13": 18, "14": 15 } }, { book: "Judith", slug: "judith", sha256: "a8da2431fdb13fc2e7ef97cb2f8937735fb25e45c3797ff0728ada413bd42a1e", chapters: { "1": 16, "2": 28, "3": 10, "4": 15, "5": 24, "6": 21, "7": 32, "8": 36, "9": 14, "10": 23, "11": 23, "12": 20, "13": 20, "14": 19, "15": 13, "16": 25 } }, { book: "Esther (Greek)", slug: "esther-greek", sha256: "9633067ed180e3643cdcd0abc761cda6ae5bc712763315be680adc1f1db48427", chapters: { "10": 13, "11": 12, "12": 6, "13": 18, "14": 19, "15": 16, "16": 24 } }, { book: "Wisdom of Solomon", slug: "wisdom-of-solomon", sha256: "390c7275a5e5f23476ebba52b81e106404e807bc342f26bfe90202852c573449", chapters: { "1": 16, "2": 24, "3": 19, "4": 20, "5": 23, "6": 25, "7": 30, "8": 21, "9": 18, "10": 21, "11": 26, "12": 27, "13": 19, "14": 31, "15": 19, "16": 29, "17": 21, "18": 25, "19": 22 } }, { book: "Sirach", slug: "sirach", sha256: "55bc46f85076e43076219ecd3f6a4e1ad250b11b3beba4dde59bc8a8a409f4d1", chapters: { "1": 30, "2": 18, "3": 31, "4": 31, "5": 15, "6": 37, "7": 36, "8": 19, "9": 18, "10": 31, "11": 34, "12": 18, "13": 26, "14": 27, "15": 20, "16": 30, "17": 32, "18": 33, "19": 30, "20": 32, "21": 28, "22": 27, "23": 28, "24": 34, "25": 26, "26": 29, "27": 30, "28": 26, "29": 28, "30": 25, "31": 31, "32": 24, "33": 31, "34": 26, "35": 20, "36": 26, "37": 31, "38": 34, "39": 35, "40": 30, "41": 24, "42": 25, "43": 33, "44": 23, "45": 26, "46": 20, "47": 25, "48": 25, "49": 16, "50": 29, "51": 30 } }, { book: "Baruch", slug: "baruch", sha256: "132f30463d8fd3caef65eb905c503ea8b34232ae75dcffcb88bae3bff12b3d97", chapters: { "1": 22, "2": 35, "3": 37, "4": 37, "5": 9 } }, { book: "Song of the Three Children", slug: "song-of-the-three-children", sha256: "9f8248772fbceb4d778cddc1b1c63f0bb701feb0dd79b2ec36357a0030f71b59", chapters: { "1": 68 } }, { book: "Susanna", slug: "susanna", sha256: "f38ed8d43e93e9773a5d2efb5394d71ca633d3d3c4aaa55f8512e3f359a42e22", chapters: { "1": 64 } }, { book: "Bel and the Dragon", slug: "bel-and-the-dragon", sha256: "2066b078a8696171041a4bb5c1e99c1c827a1cea9cbd58d35e84b02c80df0eaf", chapters: { "1": 42 } }, { book: "Prayer of Manasseh", slug: "prayer-of-manasseh", sha256: "ae276f028586104e51ddbe819c8020f88c23bf4b584bad8665bfc9eeb870097f", chapters: { "1": 14 } }, { book: "1 Maccabees", slug: "1-maccabees", sha256: "097446eef69f9c019124695d9588af27c31a84d02014167a197e594930c6f55d", chapters: { "1": 64, "2": 70, "3": 60, "4": 61, "5": 68, "6": 63, "7": 50, "8": 32, "9": 73, "10": 89, "11": 74, "12": 53, "13": 53, "14": 49, "15": 41, "16": 24 } }, { book: "2 Maccabees", slug: "2-maccabees", sha256: "8d5a6ed8e2534ed26fa95c88596721f6ec78d97f62a9582f8447e14d174223dd", chapters: { "1": 36, "2": 32, "3": 40, "4": 50, "5": 27, "6": 31, "7": 42, "8": 36, "9": 29, "10": 38, "11": 38, "12": 45, "13": 26, "14": 46, "15": 39 } }, { book: "Epistle of Jeremiah", slug: "epistle-of-jeremiah", sha256: "45e437ded181fd2be7947e3e937540a4b4cb94e61b4a32a3f63e57c8eed84fab", chapters: { "1": 73 } }] };

// ../shared/cms-bible.mjs
var cms_bible_default2 = cms_bible_default;

// ../shared/cms-timeline-rules.mjs
var GROUPS = [
  "African captivity",
  "Transatlantic trade",
  "Slavery",
  "Resistance",
  "Abolition",
  "Caribbean and Latin America",
  "Native dispossession",
  "Reconstruction and Jim Crow",
  "Civil rights",
  "Other atrocities",
  "Achievements",
  "Identity and erasure",
  "Forerunners",
  "Israel United in Christ",
  "Return from exile",
  "Maccabean revolt"
];
var PEOPLES = ["Black", "Hispanic", "Native"];
var TRIBES = {
  Judah: "the so-called African Americans",
  Benjamin: "the West Indians",
  Levi: "the Haitians",
  Simeon: "the Dominicans",
  Zebulon: "Guatemala to Panama",
  Ephraim: "the Puerto Ricans",
  Manasseh: "the Cubans",
  Gad: "the North American Indians",
  Reuben: "the Seminole Indians",
  Naphtali: "Argentina and Chile",
  Asher: "Colombia to Uruguay",
  Issachar: "the Mexicans"
};

// ../shared/cms.ts
var CmsKind = z2.enum(["timeline", "note", "sources", "class", "person", "precept"]);
var CmsId = z2.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/).refine((v) => !v.includes(".."), "Invalid content id");
var FileSha = z2.string().regex(/^[a-f0-9]{40}$/);
var Reason = z2.string().trim().min(3, "Explain why this change is needed").max(2e3);
var text2 = z2.string().max(1e5);
var nonempty = text2.trim().min(1);
var web = z2.string().url().refine((v) => ["http:", "https:"].includes(new URL(v).protocol), "Use an http(s) source URL");
var CalendarDate = z2.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = /* @__PURE__ */ new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, "Use a real calendar date");
var aliases = {
  "ecclesiasticus": "sirach",
  "sirach": "sirach",
  "wisdom of sirach": "sirach",
  "rest of esther": "esther-greek",
  "the rest of esther": "esther-greek",
  "additions to esther": "esther-greek",
  "esther (greek)": "esther-greek",
  "wisdom": "wisdom-of-solomon",
  "the wisdom of solomon": "wisdom-of-solomon",
  "song of the three holy children": "song-of-the-three-children",
  "the song of the three holy children": "song-of-the-three-children",
  "history of susanna": "susanna",
  "the history of susanna": "susanna",
  "prayer of manasses": "prayer-of-manasseh",
  "the prayer of manasses": "prayer-of-manasseh",
  "epistle of jeremy": "epistle-of-jeremiah",
  "the epistle of jeremiah": "epistle-of-jeremiah",
  "psalm": "psalms",
  "song of songs": "song-of-solomon",
  "canticles": "song-of-solomon",
  "revelations": "revelation",
  "the revelation": "revelation",
  "i esdras": "1-esdras",
  "ii esdras": "2-esdras",
  "i maccabees": "1-maccabees",
  "ii maccabees": "2-maccabees"
};
function resolveScripture(value) {
  const m = /^\s*(.+?)\s+(\d+)(?::\s*([\d,\s–-]+))?\s*$/.exec(value);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").replace(/^(first|1st) /, "1 ").replace(/^(second|2nd) /, "2 ").replace(/^(third|3rd) /, "3 ");
  const book = cms_bible_default2.books.find((b) => b.book.toLowerCase() === name || b.slug === name.replaceAll(" ", "-") || b.slug === aliases[name]);
  const count = book && book.chapters[String(+m[2])];
  if (!book || !count) return null;
  const verses = [];
  if (m[3]) for (const part of m[3].trim().split(",")) {
    const range = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/.exec(part);
    if (!range) return null;
    const from = +range[1], to = +(range[2] ?? range[1]);
    if (from < 1 || to < from || to > count) return null;
    for (let n = from; n <= to; n++) verses.push(n);
  }
  else for (let n = 1; n <= count; n++) verses.push(n);
  return { slug: book.slug, chapter: +m[2], verses };
}
var scripture = z2.strictObject({ ref: nonempty.refine((v) => !!resolveScripture(v), "Reference must resolve to KJV verses"), why: text2.optional() });
var source = z2.strictObject({ title: nonempty, url: web, author: text2.optional(), publisher: text2.optional(), supports: text2.optional(), via: text2.optional(), year: z2.union([z2.string(), z2.number()]).optional(), accessed: z2.string().optional() });
var teaching = z2.strictObject({
  points: z2.array(text2).max(100).optional(),
  quote: text2.optional(),
  teacher: text2.optional(),
  source: z2.strictObject({ kind: z2.enum(["class", "history", "site", "note"]), title: nonempty, url: web, id: text2.optional(), ts: text2.optional(), date: z2.union([CalendarDate, z2.literal("")]).optional() })
});
var TimelineShape = z2.strictObject({
  slug: z2.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
  title: nonempty,
  start: z2.int().nullable().optional(),
  end: z2.int().nullable().optional(),
  date: z2.strictObject({
    text: nonempty,
    precision: z2.enum(["day", "month", "year", "circa", "range", "decade", "unknown"]),
    // A source-calendar date ("15 Casleu, year 145") that is not converted to a BCE/CE year: say
    // which calendar and where it is stated, but never invent the conversion (CYB-146).
    calendar: text2.optional(),
    sourceRef: text2.optional()
  }).optional(),
  period: nonempty,
  group: z2.string().refine((v) => GROUPS.includes(v), "Choose a listed group").optional(),
  tribes: z2.array(z2.string().refine((v) => Object.hasOwn(TRIBES, v), "Choose one of the twelve tribes")).max(12).optional(),
  peoples: z2.array(z2.string().refine((v) => PEOPLES.includes(v), "Choose a listed people")).max(3).optional(),
  people: z2.array(text2).max(100).optional(),
  place: text2.optional(),
  region: text2.optional(),
  summary: text2.optional(),
  account: z2.array(text2).max(1e3).optional(),
  sources: z2.array(source).max(200).optional(),
  scriptures: z2.array(scripture).max(200).optional(),
  answer: z2.array(scripture).max(200).optional(),
  teaching: z2.array(teaching).max(200).optional(),
  uncertainty: text2.optional(),
  needs: text2.optional(),
  leader: text2.optional(),
  disagreements: z2.array(z2.strictObject({ point: nonempty, views: z2.array(nonempty).min(2).max(20) })).max(100).optional(),
  image: z2.strictObject({ kind: z2.enum(["archival", "generated"]), src: nonempty.refine((v) => /^https?:\/\//.test(v) || /^\/?[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(v) && !v.includes(".."), "Use a web image or app image path"), caption: nonempty, credit: text2.optional(), license: text2.optional(), sourceUrl: web.optional() }).optional(),
  status: z2.enum(["published", "draft"]).optional()
});
var SourceHost = z2.string().trim().toLowerCase().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);
var SourceList = z2.array(SourceHost).max(100).refine((v) => new Set(v).size === v.length, "A site is listed twice");
var TimelineSave = z2.strictObject({
  id: CmsId,
  action: z2.enum(["add", "edit", "publish", "unpublish"]),
  draft: z2.boolean(),
  shas: z2.strictObject({ events: FileSha, drafts: FileSha }),
  event: TimelineShape,
  reason: Reason
});
var NoteSave = z2.strictObject({ file: z2.string().max(240), sha: FileSha, reason: Reason, body: text2.optional(), teacher: z2.string().max(200).optional(), title: z2.string().max(500).optional(), replace: z2.array(z2.strictObject({ from: text2, to: text2 })).max(30).optional() });

// ../shared/cms-classes.ts
var VideoId = z3.string().regex(/^[\w-]{11}$/);
var cell = (max) => z3.string().max(max).refine((s) => !/[\r\n\t]/.test(s), "Use a single line without tabs");
var ClassMetadata = z3.strictObject({ video: VideoId, title: cell(500).trim().min(1), teacher: cell(200), date: z3.union([CalendarDate, z3.literal("")]) });
var ClassSave = z3.strictObject({ value: ClassMetadata, tableSha: FileSha, note: z3.strictObject({ file: z3.string(), sha: FileSha }).nullable(), reason: Reason });

// src/topup-remind.ts
var TABLE = "CREATE TABLE IF NOT EXISTS topup_reminders (user_id TEXT PRIMARY KEY, chat TEXT NOT NULL, tz TEXT NOT NULL, last_day TEXT NOT NULL DEFAULT '')";
var ready2 = false;
async function ensure(env) {
  if (!ready2) {
    await env.DB.prepare(TABLE).run();
    ready2 = true;
  }
}
var sealKey2 = (owner) => `topup:${owner}`;
async function getTopupReminder(env, uid) {
  await ensure(env);
  const r = await env.DB.prepare("SELECT tz FROM topup_reminders WHERE user_id = ?").bind(await ownerOfUser(env, uid)).first();
  return { on: !!r, tz: r?.tz ?? null };
}
async function setTopupReminder(env, uid, on, tz) {
  await ensure(env);
  const owner = await ownerOfUser(env, uid);
  if (!on) {
    await env.DB.prepare("DELETE FROM topup_reminders WHERE user_id = ?").bind(owner).run();
    return { on: false, tz: null };
  }
  const zone = zoneOf(tz);
  await env.DB.prepare("INSERT INTO topup_reminders (user_id, chat, tz) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET chat = excluded.chat, tz = excluded.tz").bind(owner, await seal(env, sealKey2(owner), uid), zone).run();
  return { on: true, tz: zone };
}
async function forgetTopupReminder(env, uid) {
  await ensure(env);
  const r = await env.DB.prepare("DELETE FROM topup_reminders WHERE user_id = ?").bind(await ownerOfUser(env, uid)).run();
  return Number(r.meta.changes ?? 0) > 0;
}

// src/firestore-admin.ts
import { importPKCS8 as importPKCS82, SignJWT as SignJWT2 } from "jose";
var PROJECT2 = "cyberjudah-app";
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var SCOPE = "https://www.googleapis.com/auth/datastore";
var SYNC_COLLECTIONS = ["highlights", "notes", "links", "bookmarks", "tags", "relations", "studies", "wordAnnotations"];
var HAS_REVISIONS_SUBCOLLECTION = /* @__PURE__ */ new Set(["notes", "studies"]);
function emulatorHost(env) {
  const host = env.FIRESTORE_EMULATOR_HOST;
  return host && /^(127\.0\.0\.1|localhost):\d+$/.test(host) ? host : void 0;
}
function databasePath(env) {
  const host = emulatorHost(env);
  if (host) return { documentsUrl: `http://${host}/v1/projects/demo-cyberjudah/databases/(default)/documents`, emulator: true };
  return { documentsUrl: `https://firestore.googleapis.com/v1/projects/${PROJECT2}/databases/(default)/documents`, emulator: false };
}
var mintedToken;
async function accessToken(env) {
  if (emulatorHost(env)) return "owner";
  if (mintedToken && mintedToken.expires > Date.now()) return mintedToken.token;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error("Account sync is not configured on this Worker.");
  let account;
  try {
    account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error("Invalid signing configuration");
  }
  if (account.type !== "service_account" || account.project_id !== PROJECT2 || typeof account.client_email !== "string" || !account.client_email.endsWith(`@${PROJECT2}.iam.gserviceaccount.com`) || typeof account.private_key !== "string") throw new Error("Invalid signing configuration");
  const key2 = await importPKCS82(account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1e3);
  const assertion = await new SignJWT2({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(account.client_email).setSubject(account.client_email).setAudience(TOKEN_URL).setIssuedAt(now).setExpirationTime(now + 3600).sign(key2);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!response.ok) throw new Error("Firestore access is unavailable.");
  const result = await response.json();
  mintedToken = { token: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1e3 };
  return result.access_token;
}
function decodeValue(value) {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  return null;
}
function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key2, value]) => [key2, decodeValue(value)]));
}
async function listCollection(env, path) {
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const documents = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ pageSize: "300" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`${documentsUrl}/${path}?${params}`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) break;
    if (!response.ok) throw new Error("Firestore read failed.");
    const body = await response.json();
    for (const doc of body.documents ?? []) documents.push({ name: doc.name, id: doc.name.split("/").pop(), fields: decodeFields(doc.fields ?? {}) });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return documents;
}
function syncConfigured(env) {
  return !!env.FIREBASE_SERVICE_ACCOUNT || !!emulatorHost(env);
}
async function exportAccountSyncMarks(env, uid) {
  if (!syncConfigured(env)) return null;
  const canonical = await linkedFirebase(env, uid) ?? telegramFirebaseUid(uid);
  const identities = [.../* @__PURE__ */ new Set([canonical, telegramFirebaseUid(uid)])].map(encodeURIComponent);
  const out = {};
  for (const firebaseUid of identities) for (const name of SYNC_COLLECTIONS) {
    const documents = await listCollection(env, `users/${firebaseUid}/${name}`);
    if (!documents.length) continue;
    const rows = [];
    for (const doc of documents) {
      const row = { id: doc.id, ...doc.fields };
      if (HAS_REVISIONS_SUBCOLLECTION.has(name)) {
        const revisions = await listCollection(env, `users/${firebaseUid}/${name}/${doc.id}/revisions`);
        if (revisions.length) row.revisions = revisions.map((r) => ({ id: r.id, ...r.fields }));
      }
      rows.push(row);
    }
    out[firebaseUid === encodeURIComponent(canonical) ? name : `legacyTelegram.${name}`] = rows;
  }
  return Object.keys(out).length ? out : null;
}
async function deleteAccountSyncMarks(env, uid) {
  if (!syncConfigured(env)) return 0;
  const canonical = await linkedFirebase(env, uid) ?? telegramFirebaseUid(uid);
  const identities = [.../* @__PURE__ */ new Set([canonical, telegramFirebaseUid(uid)])].map(encodeURIComponent);
  const names = [];
  for (const firebaseUid of identities) for (const name of SYNC_COLLECTIONS) {
    const documents = await listCollection(env, `users/${firebaseUid}/${name}`);
    for (const doc of documents) {
      if (HAS_REVISIONS_SUBCOLLECTION.has(name)) {
        const revisions = await listCollection(env, `users/${firebaseUid}/${name}/${doc.id}/revisions`);
        for (const revision of revisions) names.push(revision.name);
      }
      names.push(doc.name);
    }
  }
  if (!names.length) return 0;
  const { documentsUrl } = databasePath(env);
  const token = await accessToken(env);
  const base = documentsUrl.slice(0, -"/documents".length);
  for (let i = 0; i < names.length; i += 300) {
    const chunk = names.slice(i, i + 300);
    const response = await fetch(`${base}/documents:batchWrite`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: chunk.map((name) => ({ delete: name })) })
    });
    if (!response.ok) throw new Error("Firestore deletion failed.");
  }
  return names.length;
}

// src/mydata.ts
async function noteRequestsOf(env, uid) {
  const me = await pid(env, uid);
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: "notereq:", cursor });
    for (const k of page.keys) {
      const got = await env.SUBS.getWithMetadata(k.name);
      const r = got.value ? JSON.parse(got.value) : null;
      if (r?.users.some((u) => u === me || u === uid)) out.push({ video: k.name.slice("notereq:".length), r, meta: got.metadata });
    }
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return out;
}
async function exportData(env, uid) {
  const chats = [];
  for (const c of await listChats(env, uid)) {
    const chat = await getChat(env, uid, c.id);
    if (chat) chats.push(chat);
  }
  const rec = await loadReminder(env, await tgRid(env, uid));
  const subKey = `sub:${await pid(env, uid)}`;
  const sub = await open(env, subKey, await env.SUBS.get(subKey));
  return {
    generated: (/* @__PURE__ */ new Date()).toISOString(),
    note: "Everything CyberJudah keeps about you, including an optional personal-study cloud backup. Reader highlights, notes, bookmarks and reading history stay on your device and in Telegram's storage, unless account sync is on (then highlights, notes, bookmarks and studies are also kept in Google Firebase and listed under accountSync).",
    personalStudyBackup: await readStudyBackup(env, uid),
    savedChats: chats,
    readingReminder: rec ? publicView(rec) : null,
    dailyVerse: sub ? { hour: sub.hour, tzOffsetMinutes: sub.tz } : null,
    ask: await billingRecord(env, uid),
    askTopupReminder: await getTopupReminder(env, uid),
    classNoteRequests: (await noteRequestsOf(env, uid)).map((x) => x.video),
    accountSync: await exportAccountSyncMarks(env, uid)
  };
}
async function deleteData(env, uid) {
  const me = await pid(env, uid);
  await deleteStudyBackup(env, uid);
  const savedChats = await deleteAllChats(env, uid);
  const readingReminder = await forgetReminder(env, uid);
  const subKey = `sub:${me}`;
  const dailyVerse = !!await env.SUBS.get(subKey);
  await env.SUBS.delete(subKey);
  const reqs = await noteRequestsOf(env, uid);
  for (const { video, r, meta: meta2 } of reqs) {
    const users = r.users.filter((u) => u !== me && u !== uid);
    const count = Math.max(0, r.count - 1);
    if (!count) {
      await env.SUBS.delete(`notereq:${video}`);
      continue;
    }
    await env.SUBS.put(`notereq:${video}`, JSON.stringify({ ...r, users, count }), { metadata: { ...meta2, count } });
  }
  const billing = await deleteBilling(env, uid);
  const topupReminder = await forgetTopupReminder(env, uid);
  await env.DB.batch([
    // Readers who have never used Ask may not have a rate table yet.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_counts (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("DELETE FROM rate_counts WHERE key LIKE ?").bind(`%:${me}:%`)
  ]);
  const accountSyncRecords = await deleteAccountSyncMarks(env, uid);
  await revokeBrowserSessions(env, uid);
  await removeAccountLink(env, uid);
  return { savedChats, readingReminder, dailyVerse, classNoteRequests: reqs.length, askBalanceUsd: billing.balanceUsd, topupReminder, accountSyncRecords };
}
async function deletionToken(env, uid) {
  const token = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const key2 = `privacydel:${token}`;
  await env.SUBS.put(key2, await seal(env, key2, { uid }), { expirationTtl: 600 });
  return token;
}
async function useDeletionToken(env, token, uid) {
  if (!/^[a-f0-9]{16}$/.test(token)) return false;
  const key2 = `privacydel:${token}`;
  const t = await open(env, key2, await env.SUBS.get(key2));
  await env.SUBS.delete(key2);
  return t?.uid === uid;
}

// src/requests.ts
var asPids = async (env, users) => Promise.all(users.map((u) => typeof u === "number" ? pid(env, u) : u));
async function askedBy(env, r, userId) {
  if (!r) return false;
  const me = await pid(env, userId);
  return r.users.some((u) => u === me || u === userId);
}
var VIDEO = /^[A-Za-z0-9_-]{11}$/;
var key = (video) => `notereq:${video}`;
var MILESTONES = /* @__PURE__ */ new Set([1, 5, 10, 25, 50, 100]);
var validVideo = (video) => VIDEO.test(video);
async function requestNotes(env, video, userId, title, now = /* @__PURE__ */ new Date(), notify) {
  if (!validVideo(video)) throw new Error("bad-video");
  const at = now.toISOString();
  const cur = await env.SUBS.get(key(video), "json");
  if (await askedBy(env, cur, userId)) return { count: cur.count, mine: true, added: false };
  const me = await pid(env, userId);
  const next = cur ? { ...cur, title: cur.title || title, count: cur.count + 1, users: [...await asPids(env, cur.users), me].slice(-5e3), last: at } : { video, title: title.slice(0, 200), count: 1, users: [me], first: at, last: at };
  await env.SUBS.put(key(video), JSON.stringify(next), { metadata: { title: next.title, count: next.count, last: next.last } });
  if (notify && MILESTONES.has(next.count)) await notify(next);
  return { count: next.count, mine: true, added: true };
}
export {
  adjust,
  deleteData,
  deletionToken,
  exportData,
  requestNotes,
  saveExchange,
  saveReminder,
  setTopupReminder,
  tgRid,
  useDeletionToken
};
