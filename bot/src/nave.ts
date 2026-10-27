import { Hono } from "hono";
import { NaveArticle, NaveLanguage, NavePage, NaveVerse } from "../../shared/nave";

const ORIGIN = "https://api.bible-strong.app";

/** Only the public online Nave API. No offline artifacts, credentials or user headers. */
export function createNave(fetcher: typeof fetch = fetch) {
  const api = new Hono();
  api.get("/:language/*", async (c) => {
    const language = NaveLanguage.safeParse(c.req.param("language"));
    if (!language.success) return c.json({ error: "unsupported-language" }, 400);
    const suffix = c.req.path.slice(c.req.path.indexOf(`/${language.data}/`) + language.data.length + 2);
    const path = suffix.split("/");
    let schema: typeof NavePage | typeof NaveArticle | typeof NaveVerse;
    let name: string | undefined;
    let verse: string | undefined;
    const params = new URLSearchParams();
    if (suffix === "topics") {
      schema = NavePage;
      for (const key of ["initial", "search", "cursor"]) {
        const value = c.req.query(key);
        if (value) params.set(key, value);
      }
      const limit = Number(c.req.query("limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) return c.json({ error: "invalid-limit" }, 400);
      params.set("limit", String(limit));
    } else if (path.length === 2 && path[0] === "topics") {
      schema = NaveArticle;
      try { name = decodeURIComponent(path[1]); } catch { return c.json({ error: "invalid-topic" }, 400); }
      if (!name.trim()) return c.json({ error: "invalid-topic" }, 400);
    } else if (path.length === 3 && path[0] === "verses" && path[2] === "topics" && /^[1-9]\d*-[1-9]\d*-[1-9]\d*$/.test(path[1])) {
      schema = NaveVerse;
      verse = path[1];
    } else if (suffix === "random") schema = NaveArticle;
    else return c.json({ error: "not-found" }, 404);
    const upstream = name !== undefined ? `topics/${encodeURIComponent(name)}` : suffix;
    const url = `${ORIGIN}/v1/naves/${language.data}/${upstream}${params.size ? `?${params}` : ""}`;
    try {
      const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (response.status === 404 && name !== undefined) return c.json({ error: "not-found" }, 404);
      if (!response.ok) return c.json({ error: "nave-unavailable" }, 503);
      const result = schema.safeParse(await response.json());
      if (!result.success || result.data.resource.language !== language.data || (name !== undefined && (!("topic" in result.data) || result.data.topic.normalizedName !== name)) || (verse !== undefined && (!("verseKey" in result.data) || result.data.verseKey !== verse))) return c.json({ error: "nave-integrity-failure" }, 502);
      c.header("x-content-type-options", "nosniff");
      return c.json(result.data);
    } catch { return c.json({ error: "nave-unavailable" }, 503); }
  });
  return api;
}

export const nave = createNave();
