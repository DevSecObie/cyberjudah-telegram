import { pathToFileURL } from "node:url";
import { signInitData } from "../src/initdata.mjs";

/** A bounded live check: no messages, content writes or paid reader balance. */
/**
 * allowPaused: staging only. Its free answer budget is small and shared by every staging run, so a
 * day's budget spent is reported, not failed. Production leaves it off: there a paused budget means
 * readers get no answers.
 */
/**
 * answerWaitMs: how long one answer request may take. The Worker gives an answer 55 s
 * (bot/src/ai.ts SEARCH_ANSWER_DEADLINE_MS) and meters it before and after, so the check waits
 * longer than that: a slow meter is not a missing answer.
 */
export async function verifyRelease({ url, token, expectedModel, verifySync = false, bibleStrongApp = false, fetcher = fetch, log = console.log, allowPaused = false, retryMs = 5_000, answerWaitMs = 75_000 }) {
  if (!url || !token || !expectedModel) throw new Error("Set WORKER_URL, BOT_TOKEN and EXPECTED_SEARCH_MODEL for release verification.");
  const external = !expectedModel.startsWith("@cf/"), provider = external ? "Google" : "Cloudflare (Workers AI)";
  const origin = new URL(url).origin;
  const get = (path, headers = {}, waitMs = 60_000) => fetcher(`${origin}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(waitMs) });
  const requireStatus = (response, status, label) => {
    if (response.status !== status) throw new Error(`${label}: expected HTTP ${status}, received ${response.status}.`);
  };
  const health = await get("/api/health");
  requireStatus(health, 200, "Health");
  if (!(await health.json()).ok) throw new Error("Health: a search database is unavailable.");
  log("Search databases: healthy");
  // /app/ is the Mini App on both workers.dev and the production custom domain;
  // the custom domain's root belongs to the separate public website.
  for (const path of (bibleStrongApp ? ["/home", "/bible/kjv/genesis/1"] : ["/app/", "/app/read/genesis/1"])) {
    const shell = await get(path);
    requireStatus(shell, 200, "App shell");
    const html = await shell.text();
    if (!(shell.headers.get("content-type") ?? "").includes("text/html") || !html.includes('id="root"')) {
      throw new Error(`App shell: unexpected page at ${path}.`);
    }
  }
  log("App and Bible reader: available");
  if (bibleStrongApp) {
    const catalog = await get("/bs/v1/dictionaries?language=en");
    requireStatus(catalog, 200, "Bible Strong dictionaries");
    const dictionaries = (await catalog.json()).dictionaries;
    if (!Array.isArray(dictionaries) || !dictionaries.some(item => item.resource?.work === "easton-webster")) throw new Error("Bible Strong dictionaries: the original catalog is missing.");
    const entry = await get("/bs/v1/dictionaries/easton-webster/en/entries/Aaron");
    requireStatus(entry, 200, "Bible Strong dictionary entry");
    if (!(await entry.json()).entry?.definition) throw new Error("Bible Strong dictionary entry: definition is missing.");
    log("Bible Strong original dictionary catalog and entry: available");
    const nave = await get("/bs/v1/naves/en/topics/faith");
    requireStatus(nave, 200, "Bible Strong Nave");
    const topic = await nave.json();
    if (topic.resource?.kind !== "nave" || !topic.topic?.description || topic.topic?.normalizedName !== "faith" || topic.resource?.revision?.startsWith("cj-")) throw new Error("Bible Strong Nave: the original Faith topic is missing.");
    log("Bible Strong original Nave topic: available");
  }
  const query = "/api/search/answer?q=Melchizedek";
  requireStatus(await get(query), 401, "Unsigned search");
  // Same synthetic reader as the existing live browser suite; no real reader is impersonated.
  const launch = await signInitData({ user: { id: 1, first_name: "Release check" }, auth_date: String(Math.floor(Date.now() / 1000)) }, token);
  const headers = { authorization: `tma ${launch}` };
  if (verifySync) {
    const account = await get("/api/auth/status");
    requireStatus(account, 200, "Browser sign-in status");
    if (!(await account.json()).available) throw new Error("Browser sign-in: Telegram credentials are not configured on this Worker.");
    const bridge = await fetcher(`${origin}/api/firebase/token`, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
    requireStatus(bridge, 200, "Firebase identity bridge");
    const result = await bridge.json();
    if (result.uid !== "tg_1" || typeof result.token !== "string" || result.token.split(".").length !== 3) throw new Error("Firebase identity bridge: unexpected response.");
    // Mint only; never create a live Firebase account or expose the token in logs.
    log("Browser sign-in configured; Firebase identity bridge mints the stable Telegram UID");
  }
  for (const [path, field, label] of [["/api/resources/catalog", "resources", "Resource releases"], ["/api/recordings/catalog", "chapters", "Narration chapters"]]) {
    const response = await get(path, headers);
    requireStatus(response, 200, label);
    const body = await response.json();
    if (!Array.isArray(body[field])) throw new Error(`${label}: invalid catalog.`);
    log(`${label}: ${body[field].length} published`);
  }
  if (external) {
    const consent = await get(query, headers);
    requireStatus(consent, 428, "Provider consent");
    if ((await consent.json()).provider !== provider) throw new Error("Provider consent: unexpected provider.");
    log("External provider consent: enforced");
  }
  // One more try after a pause: a single slow or unavailable answer from the model is not a broken
  // release (the Worker gives up on an answer at 55 s and says it is unavailable). Two in a row fail.
  const ask = () => get(query, { ...headers, ...(external ? { "x-ai-consent": provider } : {}) }, answerWaitMs).catch(e => {
    if (e?.name === "TimeoutError") return null;
    throw e;
  });
  let response = await ask();
  if (!response || response.status === 503) {
    log(`Search answer: ${response ? "unavailable" : `no reply within ${answerWaitMs / 1000} s`}; trying once more`);
    await new Promise(r => setTimeout(r, retryMs));
    response = await ask();
    if (!response) throw new Error(`Search answer: no reply within ${answerWaitMs / 1000} s, twice. Check the provider's status and the Worker's search_answer logs.`);
  }
  if (response.status !== 200) {
    const body = await response.json().catch(() => ({}));
    const reason = ["free-paused", "limit", "unavailable", "empty"].includes(body.error) ? body.error : "unexpected-response";
    if (allowPaused && response.status === 429 && reason === "free-paused") { log("Search answer: today's free answer budget is spent; the provider was not called"); return; }
    throw new Error(`Search answer: HTTP ${response.status} (${reason}). Check the gateway funding, allowance and provider configuration.`);
  }
  const answer = await response.json();
  if (!answer.ok || answer.model !== expectedModel || answer.provider !== provider || !answer.answer?.trim() || !Array.isArray(answer.sources) || !answer.sources.length) {
    throw new Error("Search answer: the configured provider did not return a cited library answer.");
  }
  if (response.headers.get("cache-control") !== "private, no-store") throw new Error("Search answer: browser caching is not disabled.");
  // Reusing a cached question after withdrawing consent must still be refused.
  if (external) { requireStatus(await get(query, headers), 428, "Withdrawn consent"); log("External provider consent: enforced after caching"); }
  log(`Search answer: configured ${provider} provider verified, ${answer.sources.length} citations${Number.isFinite(answer.ms) ? `, ${Math.round(answer.ms / 1000)} s` : ""}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Expose safe results as check annotations as well as logs, without launch data or answers.
  const annotation = (level, message) => process.env.GITHUB_ACTIONS
    ? `::${level}::${String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}` : message;
  verifyRelease({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, expectedModel: process.env.EXPECTED_SEARCH_MODEL, verifySync: process.env.VERIFY_ACCOUNT_SYNC === "true", bibleStrongApp: process.env.BIBLE_STRONG_WEB === "1",
    allowPaused: process.env.ALLOW_FREE_PAUSED === "1", log: message => console.log(annotation("notice", message)) })
    .catch(error => { console.error(annotation("error", error.message)); process.exitCode = 1; });
}
