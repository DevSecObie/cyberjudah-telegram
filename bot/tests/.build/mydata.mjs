// src/privacy.mjs
var enc = new TextEncoder();
var dec = new TextDecoder();
var b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  const cacheKey = `${rootOf(env).length}:${uid}`;
  const hit = pids.get(cacheKey);
  if (hit) return hit;
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode(`pid:tg:${uid}`) }, await root(env), 128);
  const id = b64url(bits);
  if (pids.size > 5e3) pids.clear();
  pids.set(cacheKey, id);
  return id;
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

// src/chats.ts
var CHAT_ID = /^[a-z0-9]{8,40}$/;
var MAX_CHATS = 300;
var MAX_TURNS = 120;
var CHAT_TTL = 180 * 86400;
var indexKey = (owner) => `chats:${owner}`;
var chatKey = (owner, id) => `chat:${owner}:${id}`;
var goneKey = (owner, id) => `chatgone:${owner}:${id}`;
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
async function getChat(env, uid, id) {
  if (!CHAT_ID.test(id)) return null;
  const owner = await pid(env, uid);
  const sealed = await env.SUBS.get(chatKey(owner, id));
  if (sealed) return open(env, owner, sealed);
  if (!await moveLegacy(env, uid, owner)) return null;
  return open(env, owner, await env.SUBS.get(chatKey(owner, id)));
}
async function saveExchange(env, uid, id, question, answer, replaceLast = false) {
  if (!CHAT_ID.test(id) || !answer.content.trim()) return;
  const owner = await pid(env, uid);
  if (await env.SUBS.get(goneKey(owner, id))) return;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const chat = await getChat(env, uid, id) ?? { id, title: titleOf(question), created: now, updated: now, turns: [] };
  const n = chat.turns.length;
  if (replaceLast && n >= 2 && chat.turns[n - 2].role === "user" && chat.turns[n - 2].content.trim() === question.trim()) chat.turns.splice(n - 2, 2);
  chat.turns.push({ role: "user", content: question }, { role: "assistant", content: answer.content, sources: (answer.sources ?? []).map(slim), followups: answer.followups ?? [], steps: answer.steps ?? [], ...answer.actions?.length ? { actions: answer.actions } : {}, ...answer.cut ? { cut: true } : {} });
  chat.turns = chat.turns.slice(-MAX_TURNS);
  chat.updated = now;
  await put(env, owner, chatKey(owner, id), chat);
  const index = (await listChats(env, uid)).filter((c) => c.id !== id);
  const kept = [{ id, title: chat.title, updated: now, count: chat.turns.length / 2 }, ...index].slice(0, MAX_CHATS);
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
var enc2 = new TextEncoder();
function b64u(bytes) {
  const b = typeof bytes === "string" ? enc2.encode(bytes) : bytes;
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
var MC = 1e3;
function spendOrder(lots, now = Date.now()) {
  return lots.filter((l) => l.remaining_mc > 0 && (l.expires_at == null || l.expires_at > now)).sort((a, b) => (a.expires_at ?? Infinity) - (b.expires_at ?? Infinity) || a.created_at - b.created_at || a.id - b.id);
}
function walletOf(lots, now = Date.now()) {
  const live = spendOrder(lots, now);
  const by = (k) => live.filter((l) => l.kind === k).reduce((s, l) => s + l.remaining_mc, 0);
  const total = live.reduce((s, l) => s + l.remaining_mc, 0);
  return {
    total_mc: total,
    free_mc: by("daily"),
    plan_mc: by("plan"),
    topup_mc: live.filter((l) => l.kind !== "daily" && l.kind !== "plan").reduce((s, l) => s + l.remaining_mc, 0),
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
  `CREATE TABLE IF NOT EXISTS credit_holds (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, held_mc INTEGER NOT NULL,
    alloc TEXT NOT NULL, state TEXT NOT NULL, model TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_usage (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, at INTEGER NOT NULL, model TEXT,
    status TEXT NOT NULL, held_mc INTEGER NOT NULL, charged_mc INTEGER NOT NULL, cost_usd REAL NOT NULL, absorbed_mc INTEGER NOT NULL DEFAULT 0, detail TEXT)`,
  "CREATE INDEX IF NOT EXISTS credit_usage_owner ON credit_usage (user_id, at)",
  `CREATE TABLE IF NOT EXISTS credit_meta (user_id TEXT PRIMARY KEY, migrated_at INTEGER, plan_charge TEXT, plan_tg INTEGER, plan_cancelled INTEGER NOT NULL DEFAULT 0)`
];
var ready = false;
async function ensureCreditTables(env) {
  if (ready) return;
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  ready = true;
}
var ownerOfUser = (env, uid) => pid(env, uid);
async function lotsOf(env, owner) {
  const r = await env.DB.prepare("SELECT id, kind, granted_mc, remaining_mc, expires_at, created_at, source FROM credit_lots WHERE user_id = ? AND remaining_mc > 0").bind(owner).all();
  return r.results ?? [];
}
async function wallet(env, owner, now = Date.now()) {
  await ensureCreditTables(env);
  const w = walletOf(await lotsOf(env, owner), now);
  const plan = await env.DB.prepare("SELECT granted_mc, expires_at FROM credit_lots WHERE user_id = ? AND kind = 'plan' AND expires_at > ? ORDER BY expires_at DESC LIMIT 1").bind(owner, now).first();
  const meta2 = await env.DB.prepare("SELECT plan_cancelled FROM credit_meta WHERE user_id = ?").bind(owner).first();
  return { ...w, plan: plan ? { renews_at: plan.expires_at, cancelled: !!meta2?.plan_cancelled, credits_mc: plan.granted_mc } : null };
}
async function markPlanCancelled(env, owner) {
  await ensureCreditTables(env);
  const m = await env.DB.prepare("SELECT plan_charge, plan_tg FROM credit_meta WHERE user_id = ?").bind(owner).first();
  if (!m?.plan_charge || !m.plan_tg) return null;
  await env.DB.prepare("UPDATE credit_meta SET plan_cancelled = 1 WHERE user_id = ?").bind(owner).run();
  return { charge: m.plan_charge, tg: m.plan_tg };
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

// src/billing.ts
async function cancelPlan(env, uid) {
  const plan = await markPlanCancelled(env, await ownerOfUser(env, uid));
  if (!plan) return false;
  await telegramApi(env).editUserStarSubscription(plan.tg, plan.charge, true);
  return true;
}
async function deleteBilling(env, uid) {
  const id = await pid(env, uid);
  const planUntil = (await wallet(env, id)).plan?.renews_at ?? null;
  const planCancelled = planUntil ? await cancelPlan(env, uid).catch(() => false) : false;
  const left = await deleteCredits(env, id);
  const stmts = [env.DB.prepare("UPDATE payments SET user_id = 'deleted' WHERE user_id = ? OR user_id = ?").bind(id, String(uid))];
  for (const t of ["accounts", "usage_people"]) {
    if (await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(t).first()) stmts.push(env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ? OR user_id = ?`).bind(id, String(uid)));
  }
  await env.DB.batch(stmts).catch(() => null);
  await env.SUBS.delete(`acct:${uid}`).catch(() => null);
  return { credits: left.total_mc / MC, planUntil, planCancelled };
}
async function billingRecord(env, uid) {
  const id = await pid(env, uid);
  const has = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payments'").first();
  const pays = has ? await env.DB.prepare("SELECT kind, stars, created_at FROM payments WHERE user_id = ? ORDER BY created_at").bind(id).all() : { results: [] };
  return { credits: await creditsRecord(env, id), payments: (pays.results ?? []).map((r) => ({ kind: r.kind, stars: r.stars, at: new Date(r.created_at).toISOString() })) };
}

// src/remind.ts
import { Hono } from "hono";
import { GrammyError as GrammyError2 } from "grammy";

// src/initdata.mjs
var enc3 = new TextEncoder();
async function hmac(key2, data) {
  const k = await crypto.subtle.importKey("raw", key2, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc3.encode(data) : data));
}
var hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
var LAUNCH_DATA_MAX_AGE = 30 * 86400;
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
  const secret = await hmac(enc3.encode("WebAppData"), botToken);
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

// ../shared/links.mjs
var SECTIONS = /* @__PURE__ */ new Set([
  "plan",
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
  "study",
  "tags",
  "teachings",
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

// src/bot.ts
import { Bot, InlineKeyboard, InputFile } from "grammy";

// src/health.ts
var REMIND_MS = 6 * 3600 * 1e3;

// src/search.ts
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

// src/bot.ts
function openButton(env, origin, chatType, param, text = "Open in CyberJudah") {
  const kb = new InlineKeyboard();
  const base = origin || env.WORKER_URL;
  if (chatType === "private" && base) return kb.webApp(text, `${base}/${param ? `?tgWebAppStartParam=${param}` : ""}`);
  return kb.url(text, openLink(env, param));
}
var HELP = [
  "<b>CyberJudah</b> \u2014 the KJV with the Apocrypha, the classes, the law, the precepts and the cases.",
  "",
  "/verse \u2014 today's verse",
  "/daily \u2014 the daily verse, on or off",
  "/stop \u2014 stop reading reminders",
  "/support \u2014 support the work with Telegram Stars",
  "/help \u2014 this",
  "",
  "In any chat, type <code>@BOT matthew 15:24</code> or <code>@BOT passover</code> to send a verse or a search hit."
].join("\n");

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
  else if (p && Number.isInteger(p.day) && p.day >= 0 && p.day < 5e3 && Number.isInteger(p.perDay) && p.perDay >= 1 && p.perDay <= 50) next.plan = { day: p.day, perDay: p.perDay };
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
    const slice = all.slice(rec.plan.day * per, rec.plan.day * per + per);
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

// src/device.ts
var IDLE_TTL = 180 * 86400;
var CREATE_PER_DAY = 100;
var CREDENTIAL = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
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
var clientIp = (c) => c.req.header("cf-connecting-ip") ?? "unknown";
async function deviceOf(env, header) {
  const d = CREDENTIAL.exec(header ?? "");
  if (!d) return null;
  const saved = await env.SUBS.get(`remdev:${d[1]}`, "json");
  if (!saved || !same(saved.h, await sha256(d[2]))) return null;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  if (saved.t !== today) await env.SUBS.put(`remdev:${d[1]}`, JSON.stringify({ ...saved, t: today }), { expirationTtl: IDLE_TTL });
  return { dev: d[1], rid: saved.rid };
}
var forgetDevice = (env, dev) => env.SUBS.delete(`remdev:${dev}`);
async function issueDevice(env, ip) {
  if (await overLimit(env, `create:${ip}`)) return { ok: false, error: "rate-limited" };
  const dayKey = `remcreate:${await sha256(ip)}:${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
  const made = Number(await env.SUBS.get(dayKey)) || 0;
  if (made >= CREATE_PER_DAY) return { ok: false, error: "rate-limited" };
  await env.SUBS.put(dayKey, String(made + 1), { expirationTtl: 2 * 86400 });
  const id = randomHex(16), secret = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const device = { dev: id, rid: `dev:${id}` };
  await env.SUBS.put(`remdev:${id}`, JSON.stringify({ h: await sha256(secret), rid: device.rid, t: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) }), { expirationTtl: IDLE_TTL });
  return { ok: true, device, credential: `${id}.${secret}` };
}

// src/remind.ts
var PREFIX = "remind:";
var recKey = (rid) => `${PREFIX}${rid}`;
var tgRid = async (env, uid) => `tg:${await pid(env, uid)}`;
var LINK_TTL = 15 * 60;
async function loadReminder(env, rid) {
  return open(env, recKey(rid), await env.SUBS.get(recKey(rid)));
}
async function saveReminder(env, rid, rec) {
  await env.SUBS.put(recKey(rid), await seal(env, recKey(rid), rec), { metadata: meta(rec), ...rid.startsWith("dev:") ? { expirationTtl: IDLE_TTL } : {} });
}
var putIndex = async (env, endpoint, rid) => env.SUBS.put(`pushep:${await sha256(endpoint)}`, rid, { expirationTtl: IDLE_TTL });
var tooMany = (c) => c.json({ ok: false, error: "rate-limited" }, 429, { "retry-after": "60" });
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
  const d = await deviceOf(c.env, c.req.header("x-cj-device"));
  return d ? { kind: "device", ...d } : null;
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
var botUsername;
async function botLink(env, start) {
  botUsername ??= (await telegramApi(env).getMe()).username;
  return `https://t.me/${botUsername}?start=${start}`;
}
var reminders = new Hono();
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
    const made = await issueDevice(c.env, clientIp(c));
    if (!made.ok) return tooMany(c);
    w = { kind: "device", ...made.device };
    device = made.credential;
  }
  const now = /* @__PURE__ */ new Date();
  let rec = await loadReminder(c.env, w.rid) ?? blank();
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
    await c.env.SUBS.delete(recKey(w.rid));
  } else if (rec && typeof body?.endpoint === "string" && body.endpoint.length <= 1024) {
    await saveReminder(c.env, w.rid, await removePushFrom(c.env, rec, body.endpoint));
  }
  if (w.kind === "device") await forgetDevice(c.env, w.dev);
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
var push = new Hono();
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
    note: "Everything CyberJudah keeps about you. Your highlights, notes, bookmarks and reading history stay on your device and in your Telegram backups, not on CyberJudah's servers.",
    savedChats: chats,
    readingReminder: rec ? publicView(rec) : null,
    dailyVerse: sub ? { hour: sub.hour, tzOffsetMinutes: sub.tz } : null,
    ask: await billingRecord(env, uid).catch(() => null),
    classNoteRequests: (await noteRequestsOf(env, uid)).map((x) => x.video)
  };
}
async function deleteData(env, uid) {
  const me = await pid(env, uid);
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
  const billing = await deleteBilling(env, uid).catch(() => ({ credits: 0, planUntil: null, planCancelled: false }));
  await env.DB.prepare("DELETE FROM rate_counts WHERE key LIKE ?").bind(`%:${me}:%`).run().catch(() => null);
  return { savedChats, readingReminder, dailyVerse, classNoteRequests: reqs.length, askCredits: billing.credits, askPlanUntil: billing.planUntil && !billing.planCancelled ? new Date(billing.planUntil).toISOString() : null };
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
  deleteData,
  deletionToken,
  exportData,
  requestNotes,
  saveExchange,
  saveReminder,
  tgRid,
  useDeletionToken
};
