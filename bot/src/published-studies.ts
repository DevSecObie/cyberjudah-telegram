import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Marked } from "marked";
import { IdentityError, verifyFirebaseIdentity } from "./account-links";
import type { Env } from "./env";
import { keyedHash } from "./privacy.mjs";

/**
 * A study the app's reader chose to publish. The app sends its own study as Markdown with
 * a Firebase sign-in; anyone with the link can read it at /app/published/<id>. Only the
 * person who published it can change or remove it. Nothing here touches Bible Strong.
 */
export const MAX_BODY = 200_000;
const ID = /^[A-Za-z0-9_-]{6,64}$/;

type Row = { id: string; owner: string; title: string; author: string; body: string; updated: string };

async function schema(env: Env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS published_studies (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, updated TEXT NOT NULL)").run();
}

async function ownerOf(c: { req: { header(name: string): string | undefined }; env: Env }) {
  const token = (c.req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const identity = await verifyFirebaseIdentity(token);
  return keyedHash(c.env, "published-study", identity.uid) as Promise<string>;
}

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";

/** The signed-in API: publish (or update) and unpublish. Mounted at /api/published-studies. */
export const publishedStudies = new Hono<{ Bindings: Env }>();
publishedStudies.use("*", bodyLimit({ maxSize: MAX_BODY + 4_000, onError: c => c.json({ error: "study_too_large" }, 413) }));
publishedStudies.use("*", async (c, next) => { c.header("cache-control", "no-store"); await next(); });

/** Account deletion: every study this reader published comes down at once. */
publishedStudies.delete("/", async c => {
  if (!c.env.PRIVACY_KEY) return c.json({ error: "publishing_unavailable" }, 503);
  let owner: string;
  try { owner = await ownerOf(c); }
  catch (error) { return error instanceof IdentityError ? c.json({ error: error.reason }, error.status as 401) : c.json({ error: "sign_in_unavailable" }, 503); }
  await schema(c.env);
  const result = await c.env.DB.prepare("DELETE FROM published_studies WHERE owner=?").bind(owner).run();
  return c.json({ removed: result.meta.changes ?? 0 });
});

publishedStudies.get("/:id", async c => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "not_found" }, 404);
  await schema(c.env);
  const row = await c.env.DB.prepare("SELECT updated FROM published_studies WHERE id=?").bind(id).first<{ updated: string }>();
  return row ? c.json({ published: true, updated: row.updated }) : c.json({ published: false }, 404);
});

publishedStudies.put("/:id", async c => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "invalid_id" }, 400);
  if (!c.env.PRIVACY_KEY) return c.json({ error: "publishing_unavailable" }, 503);
  let owner: string;
  try { owner = await ownerOf(c); }
  catch (error) { return error instanceof IdentityError ? c.json({ error: error.reason }, error.status as 401) : c.json({ error: "sign_in_unavailable" }, 503); }
  const payload = await c.req.json().catch(() => null) as { title?: unknown; author?: unknown; body?: unknown } | null;
  const title = clean(payload?.title, 200), author = clean(payload?.author, 120), body = typeof payload?.body === "string" ? payload.body : "";
  if (!title || !body.trim() || body.length > MAX_BODY) return c.json({ error: "invalid_study" }, 400);
  await schema(c.env);
  const updated = new Date().toISOString();
  // Insert, or update only a row this same reader owns: another reader's study is never replaced.
  const result = await c.env.DB.prepare(
    "INSERT INTO published_studies(id,owner,title,author,body,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,body=excluded.body,updated=excluded.updated WHERE published_studies.owner=excluded.owner",
  ).bind(id, owner, title, author, body, updated).run();
  if (!result.meta.changes) return c.json({ error: "not_your_study" }, 403);
  return c.json({ published: true, updated, path: `/app/published/${id}` });
});

publishedStudies.delete("/:id", async c => {
  const id = c.req.param("id");
  if (!ID.test(id)) return c.json({ error: "invalid_id" }, 400);
  if (!c.env.PRIVACY_KEY) return c.json({ error: "publishing_unavailable" }, 503);
  let owner: string;
  try { owner = await ownerOf(c); }
  catch (error) { return error instanceof IdentityError ? c.json({ error: error.reason }, error.status as 401) : c.json({ error: "sign_in_unavailable" }, 503); }
  await schema(c.env);
  const row = await c.env.DB.prepare("SELECT owner FROM published_studies WHERE id=?").bind(id).first<{ owner: string }>();
  if (!row) return c.json({ published: false });
  if (row.owner !== owner) return c.json({ error: "not_your_study" }, 403);
  await c.env.DB.prepare("DELETE FROM published_studies WHERE id=? AND owner=?").bind(id, owner).run();
  return c.json({ published: false });
});

const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Markdown with no raw HTML, no images and only web links: a reader's text can never run as code. */
const studyMarkdown = new Marked({
  gfm: true, async: false,
  renderer: {
    html: token => escape(token.text),
    image: token => escape(token.text || ""),
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      return /^https?:\/\//i.test(token.href) ? `<a href="${escape(token.href)}" rel="noopener noreferrer nofollow">${text}</a>` : text;
    },
  },
});
export const renderStudy = (body: string) => studyMarkdown.parse(body, { async: false }) as string;

const STYLE = `:root{color-scheme:light dark;--bg:#fbf8f2;--fg:#1d1b18;--muted:#6b645a;--rule:#e2dccf;--accent:#8a5a14}
@media (prefers-color-scheme:dark){:root{--bg:#141210;--fg:#f1ece2;--muted:#a59d90;--rule:#34302a;--accent:#e0a64a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.6 Georgia,"Iowan Old Style",serif}
main{max-width:680px;margin:0 auto;padding:32px 16px 64px}header{border-bottom:1px solid var(--rule);margin-bottom:24px;padding-bottom:16px}
h1{font-size:30px;line-height:1.2;margin:0 0 8px}.by{color:var(--muted);font:15px/1.4 -apple-system,system-ui,sans-serif;margin:0}
blockquote{margin:16px 0;padding:4px 16px;border-left:3px solid var(--accent);color:var(--fg)}a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--rule);margin:24px 0}footer{margin-top:40px;color:var(--muted);font:14px/1.4 -apple-system,system-ui,sans-serif}`;

const page = (status: number, title: string, inner: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>${STYLE}</style></head><body><main>${inner}<footer>Written in the CyberJudah app.</footer></main></body></html>`,
  { status, headers: {
    "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  } },
);

/** The public page anyone with the link opens. Mounted at /app/published. */
export const publishedStudyPage = new Hono<{ Bindings: Env }>();
publishedStudyPage.get("/:id", async c => {
  const id = c.req.param("id");
  const missing = () => page(404, "Study not found", "<h1>Study not found</h1><p>This study is not published, or its writer took it down.</p>");
  if (!ID.test(id)) return missing();
  await schema(c.env);
  const row = await c.env.DB.prepare("SELECT id,owner,title,author,body,updated FROM published_studies WHERE id=?").bind(id).first<Row>();
  if (!row) return missing();
  const date = new Date(row.updated).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const by = [row.author, date].filter(Boolean).map(escape).join(" · ");
  return page(200, row.title, `<header><h1>${escape(row.title)}</h1><p class="by">${by}</p></header><article>${renderStudy(row.body)}</article>`);
});
