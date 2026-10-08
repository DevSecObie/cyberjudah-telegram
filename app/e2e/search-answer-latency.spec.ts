import { expect, test } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

/**
 * How long the search's AI answer takes on the live app: from Enter to the first visible answer
 * text, each word twice in a row (the second inside the edge cache's two minutes, so it should
 * be near-instant). Live only: the answer needs Workers AI and the Worker's own launch-data
 * check, so this runs through the owner's live-smoke workflow against the production URL and
 * is skipped on pull requests. It prints a table, attaches the timings as JSON, and fails only
 * when an answer neither arrives nor is refused within the deadline.
 */
const live = process.env.RUN_LIVE_E2E ? test : test.skip;
const MOCK = fs.readFileSync(new URL("./telegram-mock.js", import.meta.url), "utf8");
/** Launch data signed with the workflow's bot token, exactly as telegram.spec.ts signs it. */
const BOT_TOKEN = process.env.BOT_TOKEN ?? "123456:ABC-DEF";
const signed = () => {
  const params: Record<string, string> = { query_id: "AAH", user: JSON.stringify({ id: 1, first_name: "Test" }), auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  return `#tgWebAppData=${encodeURIComponent(new URLSearchParams({ ...params, hash }).toString())}&tgWebAppVersion=9.1&tgWebAppPlatform=ios`;
};
const LAUNCH = signed();

const WORDS = ["Melchizedek", "Passover", "Sabbath", "Esau", "tithes", "baptism"];
/** Past this an answer counts as never arriving; two of those end the run so the job's budget is kept. */
const DEADLINE_MS = 60_000;

type Outcome = "answered" | "refused" | "timeout";
type Row = { word: string; attempt: 1 | 2; outcome: Outcome; ms: number };

live("the search answer's time from Enter to first visible content, each word twice", async ({ page }, testInfo) => {
  test.setTimeout(WORDS.length * 2 * (DEADLINE_MS + 15_000));
  await page.route("https://telegram.org/**", (r) => r.fulfill({ contentType: "application/javascript", body: MOCK }));
  // This synthetic reader opts in before timing; waiting for human consent is not latency.
  await page.addInitScript(() => localStorage.setItem("cj:ai-consent", JSON.stringify(["Google", "Cloudflare"])));
  const rows: Row[] = [];
  let timeouts = 0;
  for (const word of WORDS) {
    for (const attempt of [1, 2] as const) {
      await page.goto(`/search${LAUNCH}`);
      await page.fill("#q", word);
      // Timed inside the page: the clock starts at the Enter keydown and stops when the AI answer
      // block shows answer text (answered), or is taken down after it appeared (the Worker refused
      // or failed; the block renders nothing then), or the deadline passes.
      const watch = page.evaluate((deadline) => new Promise<{ outcome: Outcome; ms: number }>((resolve) => {
        let t0 = 0, seen = false, settled = false;
        const done = (outcome: Outcome) => { if (settled) return; settled = true; observer.disconnect(); resolve({ outcome, ms: Math.round(performance.now() - t0) }); };
        const look = () => {
          if (!t0) return;
          const block = document.querySelector(".srch__ai");
          if (block) { seen = true; if ((block.querySelector(".msg__text")?.textContent ?? "").trim()) done("answered"); }
          else if (seen) done("refused");
        };
        const observer = new MutationObserver(look);
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        document.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" || t0) return;
          t0 = performance.now();
          setTimeout(() => done("timeout"), deadline);
        }, { capture: true, once: true });
      }), DEADLINE_MS);
      await page.press("#q", "Enter");
      const r = await watch;
      rows.push({ word, attempt, ...r });
      if (r.outcome === "timeout" && ++timeouts >= 2) break;
    }
    if (timeouts >= 2) break;
  }
  const table = rows.map((r) => `${r.word.padEnd(12)} ${r.attempt}  ${r.outcome.padEnd(9)} ${String(r.ms).padStart(6)} ms`).join("\n");
  console.log(`search answer latency (${testInfo.project.name})\n${table}`);
  await testInfo.attach("search-answer-latency.json", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
  expect(rows.filter((r) => r.outcome === "timeout"), `every answer arrives or is refused within ${DEADLINE_MS / 1000} s:\n${table}`).toEqual([]);
});
