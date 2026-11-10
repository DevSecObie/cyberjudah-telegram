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
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS published_studies (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, updated TEXT NOT NULL)"),
    // The ids an admin took down (takeDownStudy): only the id and when, so nothing can be published under it again.
    env.DB.prepare("CREATE TABLE IF NOT EXISTS published_takedowns (id TEXT PRIMARY KEY, at TEXT NOT NULL)"),
  ]);
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
  if (row) return c.json({ published: true, updated: row.updated });
  return c.json(await takenDown(c.env, id) ? { published: false, taken_down: true } : { published: false }, 404);
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
  // One statement checks the takedowns too, so a takedown landing mid-request cannot be undone.
  const result = await c.env.DB.prepare(
    "INSERT INTO published_studies(id,owner,title,author,body,updated) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM published_takedowns WHERE id=?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,author=excluded.author,body=excluded.body,updated=excluded.updated WHERE published_studies.owner=excluded.owner",
  ).bind(id, owner, title, author, body, updated, id).run();
  if (!result.meta.changes) return c.json({ error: await takenDown(c.env, id) ? "taken_down" : "not_your_study" }, 403);
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

/** The study id in what an admin sent: the id itself, or its /app/published/ link (a trailing slash, query or fragment is fine). */
export const studyIdIn = (text: string): string | null =>
  /(?:^|\/app\/published\/)([A-Za-z0-9_-]{6,64})\/?(?:[?#]\S*)?$/.exec(text.trim().split(/\s+/)[0] ?? "")?.[1] ?? null;

const takenDown = async (env: Env, id: string) => !!(await env.DB.prepare("SELECT 1 FROM published_takedowns WHERE id=?").bind(id).first());

/**
 * An admin takes a study down (the bot's /takedown, ADMIN_IDS only): its row goes, so its page shows
 * that it was taken down, and its id is kept in published_takedowns, even when the writer had already
 * unpublished it, so nothing can be published under it again. Only that one study is touched; the
 * writer keeps their own copy in the app. Reports reach the admins by email (the page's "Report this
 * study" link); nothing here records them.
 * "removed": it was published and is now down; "blocked": it was not published, its id is now
 * blocked; "already": it was taken down before; "invalid": not a study id.
 */
export async function takeDownStudy(env: Env, id: string): Promise<"removed" | "blocked" | "already" | "invalid"> {
  if (!ID.test(id)) return "invalid";
  await schema(env);
  // One transaction: the id is kept, then its row goes.
  const [kept, removed] = await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO published_takedowns(id,at) VALUES(?,?)").bind(id, new Date().toISOString()),
    env.DB.prepare("DELETE FROM published_studies WHERE id=?").bind(id),
  ]);
  return (removed.meta.changes ?? 0) > 0 ? "removed" : (kept.meta.changes ?? 0) > 0 ? "blocked" : "already";
}

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
hr{border:0;border-top:1px solid var(--rule);margin:24px 0}footer{margin-top:40px;color:var(--muted);font:14px/1.4 -apple-system,system-ui,sans-serif}footer p{margin:0 0 8px}
.credit{margin-top:48px;text-align:center;font-size:13px}.credit img{height:24px;width:24px;vertical-align:middle;margin-left:6px}.credit a{display:inline-block;margin-top:16px}`;

/** Where a reader reports a study, as the Terms say (Bible Strong's wording): by email with its link. Bible Strong's page itself has no report line; the link is the owner's addition. */
export const REPORT_ADDRESS = "privacy@cyberjudah.io";

/**
 * A plain mailto link: the study's public link and title, nothing else (no author, no owner hash,
 * no tracking). The reader's own mail app sends it; the page runs no script and records nothing.
 */
export const reportLink = (link: string, title: string) =>
  `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(`Report: ${Array.from(title).slice(0, 150).join("")}`)}&body=${encodeURIComponent(`Study: ${link}\n\nReason:\n`)}`;

/** The app's own icon, a static same-origin file (no third-party request), light or dark with the page. */
const LOGO = `<picture><source srcset="/app/icons/dark-64.png" media="(prefers-color-scheme:dark)"><img src="/app/icons/light-64.png" alt="CyberJudah" width="24" height="24"></picture>`;
/**
 * Bible Strong's study-page footer (apps/site/pages/studies/[id]/index.tsx), in English with our
 * names: under a rule, "Study written by {author} with" and the logo, then a link to the site.
 * The author is the name the writer gave when publishing (row.author, already shown above), escaped;
 * with none, the "by" part is left out.
 */
export const studyFooter = (author: string) =>
  `<hr><footer class="credit"><p>Study written ${author ? `by ${escape(author)} ` : ""}with ${LOGO}</p><a href="https://cyberjudah.io">cyberjudah.io</a>`;

const page = (status: number, title: string, inner: string, footer = "<footer><p>Written in the CyberJudah app.</p>") => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>${STYLE}</style></head><body><main>${inner}${footer}</footer></main></body></html>`,
  { status, headers: {
    "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer", "cache-control": status === 200 ? "public, max-age=60" : "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
  if (!row) return await takenDown(c.env, id) ? page(404, "Study not found", "<h1>Study not found</h1><p>This study was taken down.</p>") : missing();
  const date = new Date(row.updated).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const by = [row.author, date].filter(Boolean).map(escape).join(" · ");
  const link = `${new URL(c.req.url).origin}/app/published/${id}`;
  return page(200, row.title, `<header><h1>${escape(row.title)}</h1><p class="by">${by}</p></header><article>${renderStudy(row.body)}</article>`,
    `${studyFooter(row.author)}<p><a href="${escape(reportLink(link, row.title))}">Report this study</a></p>`);
});
