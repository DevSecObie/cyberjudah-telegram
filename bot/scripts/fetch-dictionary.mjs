#!/usr/bin/env node
// Refreshes Easton's Bible Dictionary in bot/data from the cyberjudah repository, pinned to the
// last commit that carried it (the site has since replaced Easton's with its own glossary).
// bot/data/easton.json and provenance.json are tracked here, so this only runs by hand.
import { mkdirSync, writeFileSync } from "node:fs";
const BASE = process.env.DICTIONARY_BASE ?? "https://raw.githubusercontent.com/DevSecObie/cyberjudah/9e26f72/site/src/data/dictionary";
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
for (const name of ["easton.json", "provenance.json"]) {
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) { console.error(`${name}: ${res.status}`); process.exit(1); }
  writeFileSync(new URL(`../data/${name}`, import.meta.url), await res.text());
  console.log(`fetched ${name}`);
}
