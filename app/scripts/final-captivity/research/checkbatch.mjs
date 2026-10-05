// Checks one research batch file against the Final Captivity checker (with the transcript corpus).
// Usage: node app/scripts/final-captivity/research/checkbatch.mjs <batch.json>
import fs from "node:fs";
const W = "app/scripts/final-captivity/";
const { checkEvent, loadCorpus } = await import(W + "check.mjs");
const periods = JSON.parse(fs.readFileSync(W + "periods.json", "utf8")).periods;
const existing = new Set(JSON.parse(fs.readFileSync(W + "events.json", "utf8")).map((e) => e.slug));
const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const corpus = loadCorpus("/home/user/cyberjudah");
const p = [];
const seen = new Set();
for (const e of b.events ?? []) {
  p.push(...checkEvent(e, periods, { corpus }));
  if (existing.has(e.slug)) p.push(e.slug + ": slug already exists in events.json (pick another or drop the duplicate)");
  if (seen.has(e.slug)) p.push(e.slug + ": slug repeated in this batch"); seen.add(e.slug);
  if (!e.tribes?.length && e.period !== "israel-united-in-christ") p.push(e.slug + ": name the tribes it concerns");
  if (e.answer?.length && !e.answer.every((a) => a.why)) p.push(e.slug + ": each answer verse needs its why");
}
for (const e of b.drafts ?? []) p.push(...checkEvent(e, periods, { corpus, draft: true }));
console.log((b.events ?? []).length + " event(s), " + (b.drafts ?? []).length + " draft(s), " + p.length + " problem(s)");
for (const x of p) console.log("  " + x);
