import { Hono } from "hono";
import { Parser } from "htmlparser2";
import type { Env } from "./env";
import { IdentityError } from "./account-links";
import { appReader } from "./app-identity";

/**
 * Link previews for the CyberJudah app (a study's or a verse's saved links): the page's title,
 * description, picture and site name, read from its Open Graph tags. The app's links screen reads
 * `{ data: { title, description, image, siteName, type } }`, the shape of the preview service it
 * was built against. Only a verified app sign-in may ask, each reader a bounded number of times a
 * minute; every page is fetched at most once a day (edge cache).
 *
 * It fetches addresses readers type, so it only reaches public web pages: http(s) on the default
 * ports, no user name or password, no IP-literal or internal host names, and every redirect is
 * checked the same way. It reads at most MAX_BYTES of HTML for at most TIMEOUT_MS.
 */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const CACHE_SECONDS = 86400;

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".arpa", ".test", ".invalid", ".example"];

/** True when the address is a public web page this endpoint may fetch. */
export function isPublicTarget(raw: string | URL): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || !host.includes(".")) return false;
  // Any IP literal (v4, v6, or a bare number the URL parser turned into one) is refused: a public
  // page has a name, and a number is how private and cloud-metadata addresses are reached.
  if (host.startsWith("[") || /^[\d.]+$/.test(host) || /^0x/i.test(host)) return false;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return false;
  // Not our own services: a preview of them is never needed and would loop through this Worker.
  if (host === "cyberjudah.io" || host.endsWith(".cyberjudah.io") || host.endsWith(".workers.dev")) return false;
  return true;
}

export type OgData = { title?: string; description?: string; image?: string; siteName?: string; type?: string };

const clean = (value: string | undefined, max: number) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
};

/** The Open Graph fields of a page (with the plain <title> and description as fallbacks). */
export function parseOpenGraph(html: string, pageUrl: string): OgData {
  const meta: Record<string, string> = {};
  let title = "";
  let inTitle = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "title") inTitle = true;
      if (name !== "meta") return;
      const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
      if (key && attrs.content != null && !(key in meta)) meta[key] = attrs.content;
    },
    ontext(text) { if (inTitle && title.length < 2000) title += text; },
    onclosetag(name) { if (name === "title") inTitle = false; },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  let image: string | undefined;
  const rawImage = meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"];
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, pageUrl);
      if (resolved.protocol === "https:" || resolved.protocol === "http:") image = resolved.href.slice(0, 2048);
    } catch { /* no picture */ }
  }
  const data: OgData = {
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? title, 300),
    description: clean(meta["og:description"] ?? meta["twitter:description"] ?? meta["description"], 600),
    image,
    siteName: clean(meta["og:site_name"], 120),
    type: clean(meta["og:type"], 40),
  };
  for (const key of Object.keys(data) as (keyof OgData)[]) if (data[key] === undefined) delete data[key];
  return data;
}

/** The page's HTML, following at most MAX_REDIRECTS checked redirects; null when it is not a public HTML page. */
export async function fetchPage(start: string, fetcher: typeof fetch = fetch): Promise<{ url: string; html: string } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPublicTarget(url)) return null;
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "CyberJudahLinkPreview/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) return null;
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) { await response.body.cancel(); return null; }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES * 8) { await response.body.cancel(); return null; }
    // Read at most MAX_BYTES: the tags a preview needs are in the <head>.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
    let at = 0;
    for (const chunk of chunks) {
      const part = chunk.subarray(0, Math.min(chunk.byteLength, bytes.byteLength - at));
      bytes.set(part, at);
      at += part.byteLength;
      if (at >= bytes.byteLength) break;
    }
    return { url, html: new TextDecoder().decode(bytes) };
  }
  return null;
}

type AppOg = { Bindings: Env; Variables: { uid: string } };
export const appOg = new Hono<AppOg>();
appOg.use("*", async (c, next) => {
  try {
    const identity = await appReader(c.req.raw, c.env);
    if (!identity) return c.json({ error: "sign_in_required" }, 401);
    c.set("uid", identity.uid);
  } catch (error) {
    return c.json({ error: error instanceof IdentityError ? error.reason : "sign_in_unavailable" }, error instanceof IdentityError ? error.status : 503);
  }
  return next();
});
appOg.get("/", async (c) => {
  const target = (c.req.query("url") ?? "").trim();
  if (!target || target.length > 2048 || !isPublicTarget(target)) return c.json({ error: "invalid_url" }, 400);
  if (!c.env.READER_LIMIT) return c.json({ error: "unavailable" }, 503, { "retry-after": "60" });
  if (!(await c.env.READER_LIMIT.limit({ key: `og:${c.get("uid")}` })).success) return c.json({ error: "rate_limited" }, 429, { "retry-after": "60" });
  const href = new URL(target).href;
  const key = new Request(`${new URL(c.req.url).origin}/__app-og?${new URLSearchParams({ u: href })}`);
  const edge = typeof caches === "undefined" ? undefined : caches.default;
  const cached = await edge?.match(key);
  if (cached) return new Response(cached.body, cached);
  let page: { url: string; html: string } | null = null;
  try { page = await fetchPage(href); } catch { page = null; }
  if (!page) return c.json({ error: "no_preview" }, 404);
  const response = c.json({ data: parseOpenGraph(page.html, page.url) });
  response.headers.set("cache-control", "private, max-age=3600");
  if (edge) c.executionCtx.waitUntil(edge.put(key, new Response(response.clone().body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_SECONDS}` } })));
  return response;
});
