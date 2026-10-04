import type { Env } from "./env";
import configured from "../data/ask-sources.json";
export const DEFAULT_SOURCES = ["israelunite.org", "wikipedia.org", "archive.org", "gutenberg.org", "loc.gov", "archives.gov", "nps.gov", "si.edu", "blackpast.org", "slavevoyages.org", "jewishencyclopedia.com", "sacred-texts.com", "ccel.org"];
export const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export async function approvedSources(env: Env): Promise<string[]> {
  if (configured.revision > 0) return configured.hosts;
  const kv = await env.SUBS.get("ask:sources", "json").catch(() => null);
  return Array.isArray(kv) && kv.every((h) => typeof h === "string" && HOST.test(h)) ? (kv as string[]) : DEFAULT_SOURCES;
}
