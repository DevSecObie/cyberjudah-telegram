import { FakeGithub } from "../../bot/tests/fixtures/cms-github.mjs";
import http from "node:http";
import { claude } from "./claude";

/**
 * What the local Worker talks to beyond itself, on loopback: the Telegram Bot API and a
 * browser push service. The Worker is started pointed at them (TELEGRAM_API_ROOT and
 * PUSH_TEST_ORIGIN in playwright.config.ts), so the reminder run is the real one, end to
 * end; only the far side of its two network calls is stood in for, and every request is
 * kept for the tests to read at GET /__log.
 *
 *   POST /bot<token>/<method>   answers as the Bot API does (sendMessage, editMessageText, getMe)
 *   POST /push/<id>             answers 201 Created, as a push service does
 *   POST /push/gone-<id>        410 Gone (the browser unsubscribed)
 *   POST /push/refuse-<id>      403 Forbidden (the VAPID signature was refused)
 *   POST /anthropic/v1/messages the Claude Messages API, streamed (claude.ts): a scripted model
 */
export const STAND_IN_PORT = 8791;
export const STAND_IN = `http://127.0.0.1:${STAND_IN_PORT}`;
export type Logged = { at: number; method: string; path: string; headers: Record<string, string>; body: unknown };

export default async function globalSetup() {
  const log: Logged[] = [];
  let github = new FakeGithub();
  let messageId = 1000;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url ?? "/";
      const json = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      if (path === "/__log") return json(200, log);
      let body: unknown = raw;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* form or empty */ }
      log.push({ at: Date.now(), method: req.method ?? "", path, headers: req.headers as Record<string, string>, body });
      if (path === "/__cms/reset") { github = new FakeGithub(); return json(200, { ok: true }); }
      if (path === "/__cms/checks") { github.checks = (body as { state: string }).state; return json(200, { ok: true }); }
      if (path === "/__cms/calls") return json(200, github.calls);
      if (path.startsWith("/github/")) { const result = github.respond(path, req.method, body, req.headers); return json(result.status, result.body); }
      const bot = /^\/bot[^/]+\/(\w+)$/.exec(path);
      if (bot) {
        const p = (body ?? {}) as { chat_id?: number; text?: string };
        if (bot[1] === "getMe") return json(200, { ok: true, result: { id: 100000001, is_bot: true, first_name: "CyberJudah", username: "CyberJudah_bot" } });
        if (bot[1] === "createInvoiceLink") return json(200, { ok: true, result: `https://t.me/$e2e-invoice-${++messageId}` });
        if (bot[1] === "sendMessage") return json(200, { ok: true, result: { message_id: ++messageId, date: Math.floor(Date.now() / 1000), chat: { id: p.chat_id, type: "private" }, text: p.text } });
        return json(200, { ok: true, result: true });
      }
      if (path === "/anthropic/v1/messages" && req.method === "POST") return void claude(body as Parameters<typeof claude>[0], res);
      const push = /^\/push\/(gone-|refuse-)?[\w-]+$/.exec(path);
      if (push && req.method === "POST") { res.writeHead(push[1] === "gone-" ? 410 : push[1] === "refuse-" ? 403 : 201); return res.end(); }
      json(404, { ok: false });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(STAND_IN_PORT, "127.0.0.1", resolve); });
  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
