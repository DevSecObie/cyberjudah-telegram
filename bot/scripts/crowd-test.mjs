// A practice crowd on STAGING only: each pretend visit makes the calls the app's home screen
// makes (measured on web.cyberjudah.io, 2026-11-03), then opens a Bible chapter. Reports how many
// calls failed and how long they took. Run by .github/workflows/crowd-test.yml.
//   node bot/scripts/crowd-test.mjs <staging origin> [visits=1000] [at once=50]
const [origin, visitsArg = "1000", parallelArg = "50"] = process.argv.slice(2);
if (!origin || !/^https:\/\/cyberjudah-telegram-staging\.[a-z0-9-]+\.workers\.dev$/.test(origin)) {
  console.error("Give the staging Worker's address (https://cyberjudah-telegram-staging.<account>.workers.dev). Production is never tested.");
  process.exit(2);
}
const visits = Math.min(5000, Number(visitsArg)), parallel = Math.min(200, Number(parallelArg));
const letters = "abcdefghijklmnopqrstuvwxyz";
const visit = i => [
  "/bs/v1/bibles/KJV/coverage",
  `/bs/v1/bibles/KJV/verses?references=${1 + (i % 66)}-1-1`,
  "/bs/v1/strong-lexicon/modules/simple-en",
  "/bs/v1/strong-lexicon/random?language=en&lexicalLanguage=greek&level=simple",
  "/bs/v1/strong-lexicon/random?language=en&lexicalLanguage=hebrew&level=simple",
  "/bs/v1/naves/en/random",
  `/bs/v1/dictionaries/easton-webster/en/entries?initial=${letters[i % 26]}&limit=100`,
  "/api/app/channel/live",
  "/api/app/channel/recent",
  `/bs/v1/bibles/KJV/books/${1 + (i % 66)}/chapters/1`,
];
const times = [], failures = new Map();
async function call(path) {
  const t = performance.now();
  try {
    const r = await fetch(origin + path, { headers: { "user-agent": "cyberjudah-crowd-test" }, signal: AbortSignal.timeout(30000) });
    await r.arrayBuffer();
    if (!r.ok) failures.set(`${r.status} ${path.split("?")[0]}`, (failures.get(`${r.status} ${path.split("?")[0]}`) ?? 0) + 1);
  } catch (e) { failures.set(`${e.name} ${path.split("?")[0]}`, (failures.get(`${e.name} ${path.split("?")[0]}`) ?? 0) + 1); }
  times.push(performance.now() - t);
}
let next = 0;
const started = performance.now();
await Promise.all(Array.from({ length: parallel }, async () => {
  while (next < visits) { const i = next++; await Promise.all(visit(i).map(call)); }
}));
times.sort((a, b) => a - b);
const pct = p => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
const failed = [...failures.values()].reduce((a, b) => a + b, 0);
console.log(`${visits} visits, ${parallel} at once, ${times.length} calls in ${Math.round((performance.now() - started) / 1000)} s`);
console.log(`Time per call: median ${pct(0.5)} ms, 95% under ${pct(0.95)} ms, slowest ${pct(1)} ms`);
console.log(`Failed calls: ${failed} (${(100 * failed / times.length).toFixed(2)}%)`);
for (const [what, n] of [...failures].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${what}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Practice crowd on staging\n\n- ${visits} visits, ${parallel} at once, ${times.length} calls\n- Median ${pct(0.5)} ms, 95% under ${pct(0.95)} ms, slowest ${pct(1)} ms\n- Failed calls: ${failed} (${(100 * failed / times.length).toFixed(2)}%)\n${[...failures].map(([w, n]) => `  - ${n} × ${w}`).join("\n")}\n`);
}
process.exit(failed / times.length > 0.01 ? 1 : 0);
