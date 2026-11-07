import type { Env, Exec } from "./env";
import type { BookRow } from "./refs.mjs";
import { appLink, startParamToPath } from "../../shared/links.mjs";

export type Chapter = { book: string; chapter: number; translation: string; url: string; verses: { verse: number; text: string }[] };

/**
 * The data set, read through the edge cache: the JSON files are immutable per publish and
 * change a few times a week, so an hour is plenty and keeps the bot off the origin.
 */
export async function dataJson<T>(env: Env, path: string, ctx?: Exec): Promise<T | null> {
  const url = `${env.DATA_ORIGIN}${path}`;
  const cache = caches.default;
  const hit = await cache.match(url);
  if (hit) return hit.json<T>();
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const copy = new Response(res.body, res);
  copy.headers.set("cache-control", "public, max-age=3600");
  const put = cache.put(url, copy.clone());
  if (ctx) ctx.waitUntil(put); else await put;
  return copy.json<T>();
}

export const books = (env: Env, ctx?: Exec) => dataJson<BookRow[]>(env, "/api/kjv/books.json", ctx);
export const chapter = (env: Env, slug: string, ch: number, ctx?: Exec) => dataJson<Chapter>(env, `/api/kjv/${slug}/${ch}.json`, ctx);

/** Where a link to a page (or a start param) should send a person: the Mini App when it exists, else the site. */
export function openLink(env: Env, startapp: string): string {
  if (env.APP_URL) return startapp ? `${env.APP_URL}?startapp=${startapp}` : env.APP_URL;
  const path = startParamToPath(startapp);
  return `${env.SITE_URL}${path === "/" ? "" : path}`;
}

export function verseLink(env: Env, slug: string, ch: number, verses?: string): string {
  return appLink(env.APP_URL, env.SITE_URL, `/bible/${slug}/${ch}`, verses);
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Verse text plus reference as a Telegram HTML message (the site link is the source line). */
export function verseMessage(env: Env, label: string, text: string, slug: string, ch: number, verses?: string): string {
  const site = `${env.SITE_URL}/bible/${slug}/${ch}${verses ? `?v=${verses}#v${verses.match(/^\d+/)?.[0] ?? ""}` : ""}`;
  return `${escapeHtml(text)}\n\n<b>${escapeHtml(label)}</b> (KJV) · <a href="${site}">cyberjudah.io</a>`;
}
