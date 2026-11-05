/**
 * A runner for bluegreen-load.mjs over D1's REST /query endpoint: sends SQL, retries what D1 says
 * is passing (overloaded, rate limited, a 5xx) with growing pauses, and resolves to the result
 * array (one entry per statement).
 */
const PASSING = /overloaded|queued for too long|try again|timed? ?out|reset|Network connection lost/i;

export function d1Query(url, headers, { tries = 6, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async (sql) => {
    for (let attempt = 1; ; attempt++) {
      let status = 0, body = null;
      try {
        const res = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify({ sql }) });
        status = res.status;
        body = await res.json().catch(() => null);
        if (res.ok && body?.success) return body.result;
      } catch (e) {
        body = { errors: [{ message: String(e?.message ?? e) }] };
      }
      const message = (body?.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${status}`;
      const passing = status === 429 || status >= 500 || status === 0 || PASSING.test(message);
      if (!passing || attempt >= tries) throw new Error(`D1 query failed (${message.slice(0, 300)})`);
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  };
}
