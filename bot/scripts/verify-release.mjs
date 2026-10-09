import { pathToFileURL } from "node:url";
import { signInitData } from "../src/initdata.mjs";

/** A bounded live check: no messages, content writes or paid reader balance. */
export async function verifyRelease({ url, token, expectedModel, verifySync = false, fetcher = fetch, log = console.log }) {
  if (!url || !token || !expectedModel) throw new Error("Set WORKER_URL, BOT_TOKEN and EXPECTED_SEARCH_MODEL for release verification.");
  const external = !expectedModel.startsWith("@cf/"), provider = external ? "Google" : "Cloudflare (Workers AI)";
  const origin = new URL(url).origin;
  const get = (path, headers = {}) => fetcher(`${origin}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
  const requireStatus = (response, status, label) => {
    if (response.status !== status) throw new Error(`${label}: expected HTTP ${status}, received ${response.status}.`);
  };
  const health = await get("/api/health");
  requireStatus(health, 200, "Health");
  if (!(await health.json()).ok) throw new Error("Health: a search database is unavailable.");
  log("Search databases: healthy");
  // /app/ is the Mini App on both workers.dev and the production custom domain;
  // the custom domain's root belongs to the separate public website.
  for (const path of ["/app/", "/app/read/genesis/1"]) {
    const shell = await get(path);
    requireStatus(shell, 200, "App shell");
    const html = await shell.text();
    if (!(shell.headers.get("content-type") ?? "").includes("text/html") || !html.includes('id="root"')) {
      throw new Error(`App shell: unexpected page at ${path}.`);
    }
  }
  log("App and Bible reader: available");
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
  const response = await get(query, { ...headers, ...(external ? { "x-ai-consent": provider } : {}) });
  if (response.status !== 200) {
    const body = await response.json().catch(() => ({}));
    const reason = ["free-paused", "limit", "unavailable", "empty"].includes(body.error) ? body.error : "unexpected-response";
    throw new Error(`Search answer: HTTP ${response.status} (${reason}). Check the gateway funding, allowance and provider configuration.`);
  }
  const answer = await response.json();
  if (!answer.ok || answer.model !== expectedModel || answer.provider !== provider || !answer.answer?.trim() || !Array.isArray(answer.sources) || !answer.sources.length) {
    throw new Error("Search answer: the configured provider did not return a cited library answer.");
  }
  if (response.headers.get("cache-control") !== "private, no-store") throw new Error("Search answer: browser caching is not disabled.");
  // Reusing a cached question after withdrawing consent must still be refused.
  if (external) { requireStatus(await get(query, headers), 428, "Withdrawn consent"); log("External provider consent: enforced after caching"); }
  log(`Search answer: configured ${provider} provider verified, ${answer.sources.length} citations`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Expose safe results as check annotations as well as logs, without launch data or answers.
  const annotation = (level, message) => process.env.GITHUB_ACTIONS
    ? `::${level}::${String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}` : message;
  verifyRelease({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, expectedModel: process.env.EXPECTED_SEARCH_MODEL, verifySync: process.env.VERIFY_ACCOUNT_SYNC === "true",
    log: message => console.log(annotation("notice", message)) })
    .catch(error => { console.error(annotation("error", error.message)); process.exitCode = 1; });
}
