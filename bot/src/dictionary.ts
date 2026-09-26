import { Hono } from "hono";

import entries from "../data/easton.json";
// data/easton.json is fetched by scripts/fetch-dictionary.mjs (from the cyberjudah repo) before build.

/**
 * Easton's Bible Dictionary (1897, public domain; provenance in data/provenance.json): 3,963
 * entries, served a page at a time so the app never downloads the whole book. Lookup is by
 * term prefix first, then substring, then a word inside a definition, so tapping a word in
 * the reader finds its entry.
 */
type Entry = { slug: string; term: string; definitions: string[] };
const all = entries as Entry[];
const byTerm = new Map(all.map((e) => [e.term.toLowerCase(), e]));

/** The entry a word in the text most likely means: exact, then singular, then prefix. */
export function lookup(word: string): Entry | null {
  const w = word.toLowerCase().replace(/[^a-z' -]/g, "").trim();
  if (!w) return null;
  const candidates = [w, w.replace(/'s$/, ""), w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, ""), w.replace(/eth$/, ""), w.replace(/ed$/, ""), w.replace(/ing$/, "")];
  for (const c of candidates) { const e = byTerm.get(c); if (e) return e; }
  const cap = w[0].toUpperCase() + w.slice(1);
  return all.find((e) => e.term.startsWith(cap) && e.term.length <= w.length + 3) ?? null;
}

export const dictionary = new Hono();

dictionary.get("/", (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 80).toLowerCase();
  const letter = /^[A-Z]$/.test(c.req.query("letter") ?? "") ? c.req.query("letter")! : "";
  const page = Math.max(1, Math.floor(Number(c.req.query("page")) || 1));
  const rows = all.filter((e) => (!letter || e.term.toUpperCase().startsWith(letter)) && (!q || e.term.toLowerCase().includes(q)));
  // A word that is not a term still finds the entries that define it.
  const inText = q.length >= 4 && rows.length < 5 ? all.filter((e) => !rows.includes(e) && e.definitions.some((d) => d.toLowerCase().includes(q))).slice(0, 20) : [];
  const PAGE = 60;
  c.header("cache-control", "public, max-age=3600");
  return c.json({ count: rows.length, page, pages: Math.max(1, Math.ceil(rows.length / PAGE)), rows: rows.slice((page - 1) * PAGE, page * PAGE).map(({ slug, term }) => ({ slug, term })), related: inText.map(({ slug, term }) => ({ slug, term })), total: all.length });
});

dictionary.get("/lookup", (c) => {
  const e = lookup(c.req.query("word") ?? "");
  c.header("cache-control", "public, max-age=3600");
  return e ? c.json(e) : c.json({ error: "not-found" }, 404);
});

dictionary.get("/:slug", (c) => {
  const e = all.find((x) => x.slug === c.req.param("slug"));
  if (!e) return c.json({ error: "not-found" }, 404);
  c.header("cache-control", "public, max-age=86400");
  return c.json(e);
});
