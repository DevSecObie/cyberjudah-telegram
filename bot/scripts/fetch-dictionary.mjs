#!/usr/bin/env node
// Fetches Easton's Bible Dictionary from the cyberjudah repository (site/src/data/dictionary),
// where it is kept with its provenance, into bot/data so the worker can bundle it. Run before
// `wrangler dev` or `wrangler deploy`; the deploy workflow does.
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.DICTIONARY_BASE ?? "https://raw.githubusercontent.com/DevSecObie/cyberjudah/main/site/src/data/dictionary";
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
for (const name of ["easton.json", "provenance.json"]) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) { console.error(`${name}: ${res.status}`); process.exit(1); }
  writeFileSync(new URL(`../data/${name}`, import.meta.url), await res.text());
  console.log(`fetched ${name}`);
}
