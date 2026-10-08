import { pathToFileURL } from "node:url";
import { verifyRelease } from "./verify-release.mjs";

/** Only this synthetic request's existing, bounded provider error; never request headers. */
export function providerFailures(event, marker) {
  if (event?.event?.request?.headers?.["x-release-check"] !== marker) return [];
  return (event.logs ?? []).flatMap(log => (log.message ?? []).flatMap(message => {
    try {
      const row = JSON.parse(message);
      return row.event === "search_answer_failed" && typeof row.message === "string" ? [row.message.slice(0, 160)] : [];
    } catch { return []; }
  }));
}
const annotate = (level, message) => console.log(`::${level}::${String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`);

async function diagnose() {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account) throw new Error("Cloudflare credentials are required for staging diagnostics.");
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/cyberjudah-telegram-staging/tails`;
  const call = async (url, method, body) => {
    const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body && JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(`Staging diagnostic API: HTTP ${response.status}; codes ${(result.errors ?? []).map(e => e.code).join(",")}.`);
    return result.result;
  };
  const tail = await call(base, "POST", {});
  const marker = crypto.randomUUID(), messages = new Set();
  const socket = new WebSocket(tail.url, "trace-v1");
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", event => {
    try {
      const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
      for (const message of providerFailures(JSON.parse(text), marker)) messages.add(message);
    } catch { /* discard everything except recognized console events */ }
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Staging diagnostic stream timed out.")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timer); socket.send(JSON.stringify({ debug: false })); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Staging diagnostic stream unavailable.")); }, { once: true });
    });
    try {
      await verifyRelease({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, expectedModel: process.env.EXPECTED_SEARCH_MODEL, verifySync: process.env.VERIFY_ACCOUNT_SYNC === "true",
        fetcher: (url, options) => fetch(url, { ...options, headers: { ...options.headers, "x-release-check": marker } }), log: message => annotate("notice", message) });
    } finally {
      await new Promise(resolve => setTimeout(resolve, 5000));
      for (const message of messages) annotate("warning", `Staging provider diagnostic: ${message}`);
    }
  } finally {
    socket.close();
    await call(`${base}/${tail.id}`, "DELETE").catch(() => annotate("warning", "Staging diagnostic stream cleanup failed; the stream will expire automatically."));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A closed diagnostic WebSocket can otherwise keep Node alive after the result and cleanup.
  const finish = code => process.stdout.write("", () => process.exit(code));
  diagnose().then(() => finish(0), error => { annotate("error", error.message); finish(1); });
}
