import { pathToFileURL } from "node:url";
import { signInitData } from "../src/initdata.mjs";

/** A bounded live check: no messages, content writes or paid reader balance. */
export async function verifyRelease({ url, token, expectedModel, fetcher = fetch, log = console.log }) {
  if (!url || !token || !expectedModel) throw new Error("Set WORKER_URL, BOT_TOKEN and EXPECTED_SEARCH_MODEL for release verification.");
  const origin = new URL(url).origin;
  const get = (path, headers = {}) => fetcher(`${origin}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(60_000) });
  const requireStatus = (response, status, label) => {
    if (response.status !== status) throw new Error(`${label}: expected HTTP ${status}, received ${response.status}.`);
  };
  const health = await get("/api/health");
  requireStatus(health, 200, "Health");
  if (!(await health.json()).ok) throw new Error("Health: a search database is unavailable.");
  log("Search databases: healthy");
  for (const path of ["/", "/app/strong/", "/app/strong/bible"]) {
    const shell = await get(path);
    requireStatus(shell, 200, "App shell");
    const html = await shell.text();
    if (!(shell.headers.get("content-type") ?? "").includes("text/html") || !html.includes(path === "/" ? 'id="root"' : "/app/strong/_expo/static/js/web/entry-")) {
      throw new Error(`App shell: unexpected page at ${path}.`);
    }
  }
  log("App and Bible reader: available");
  const query = "/api/search/answer?q=Melchizedek";
  requireStatus(await get(query), 401, "Unsigned search");
  // Same synthetic reader as the existing live browser suite; no real reader is impersonated.
  const launch = await signInitData({ user: { id: 1, first_name: "Release check" }, auth_date: String(Math.floor(Date.now() / 1000)) }, token);
  const headers = { authorization: `tma ${launch}` };
  const consent = await get(query, headers);
  requireStatus(consent, 428, "Provider consent");
  if ((await consent.json()).provider !== "Google") throw new Error("Provider consent: unexpected provider.");
  log("Authentication and provider consent: enforced");
  const response = await get(query, { ...headers, "x-ai-consent": "Google" });
  if (response.status !== 200) {
    const body = await response.json().catch(() => ({}));
    const reason = ["free-paused", "limit", "unavailable", "empty"].includes(body.error) ? body.error : "unexpected-response";
    throw new Error(`Search answer: HTTP ${response.status} (${reason}). Check the gateway funding, allowance and provider configuration.`);
  }
  const answer = await response.json();
  if (!answer.ok || answer.model !== expectedModel || answer.provider !== "Google" || !answer.answer?.trim() || !Array.isArray(answer.sources) || !answer.sources.length) {
    throw new Error("Search answer: the configured provider did not return a cited library answer.");
  }
  if (response.headers.get("cache-control") !== "private, no-store") throw new Error("Search answer: browser caching is not disabled.");
  // Reusing a cached question after withdrawing consent must still be refused.
  requireStatus(await get(query, headers), 428, "Withdrawn consent");
  log(`Search answer: configured provider verified, ${answer.sources.length} citations; consent enforced after caching`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRelease({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, expectedModel: process.env.EXPECTED_SEARCH_MODEL })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
