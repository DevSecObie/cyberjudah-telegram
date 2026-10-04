import type http from "node:http";

/**
 * A scripted stand-in for the Claude Messages API, streamed as the API streams it (server-sent
 * events: message_start, content blocks with text or tool_use deltas, message_delta with the
 * stop reason). The Worker's real agent loop calls it through ANTHROPIC_BASE_URL and runs its
 * real tools on what it asks for; only the model's choices are scripted, from the question:
 *
 *   starts "How do I"      → app_help with the rest of the question, then links what it returned
 *   mentions "remind"      → my_reminder and propose_reminder_change (6:30), then an answer
 *   mentions "saved chats" → my_saved_chats, then an answer that links each chat it was given
 *   mentions "dangerous"   → an answer with a javascript: link and a link to another site
 *   mentions "refuse"      → stop_reason "refusal" with no text
 *   mentions "slowly"      → the answer after 10 seconds (to leave and come back mid-answer)
 *   mentions "overloaded"  → HTTP 529 overloaded_error, as the API answers when Claude is overloaded
 *   anything else          → a short answer
 *
 * After a tool, the answer is written from the tool results it was sent, so what the reader
 * sees came from the Worker's own data.
 */
type Block = { type: string; text?: string; content?: unknown; name?: string; tool_use_id?: string };
type Msg = { role: string; content: string | Block[] };
export type ClaudeRequest = { messages: Msg[]; tools?: { name: string; eager_input_streaming?: boolean }[]; system?: { text: string; cache_control?: unknown }[]; cache_control?: unknown; stream?: boolean };

const textOf = (m: Msg) => (typeof m.content === "string" ? m.content : m.content.map((b) => b.text ?? "").join(""));
let ids = 0;

export async function claude(req: ClaudeRequest, res: http.ServerResponse) {
  const first = req.messages.find((m) => m.role === "user" && /Question: /.test(textOf(m)))!;
  const question = (/Question: ([\s\S]*)$/.exec(textOf(first))?.[1] ?? "").trim();
  const last = req.messages[req.messages.length - 1];
  const results = typeof last.content === "string" ? [] : last.content.filter((b) => b.type === "tool_result");
  const out: { tools?: { name: string; input: unknown }[]; text?: string; stop: string } = (() => {
    if (results.length) {
      const said = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join("\n");
      const links = [...said.matchAll(/^(.*?): .*? Link: (\S+)$/gm)].map((m) => `- [${m[1].replace(/^(Person|Case study): /, "")}](${m[2]})`);
      if (/remind/i.test(question) && !/^How do I/i.test(question)) return { text: "I've put a card below to turn your reading reminder on at 6:30. It happens only when you tap Confirm.", stop: "end_turn" };
      const pics = [...said.matchAll(/Picture: (\/\S+)/g)].map((m) => `![A picture](${m[1]})`);
      return { text: links.length ? `Here is what I found:\n\n${links.join("\n")}${pics.length ? `\n\n${pics.slice(0, 1).join("\n")}` : ""}` : `I found nothing for that. ${said.slice(0, 120)}`, stop: "end_turn" };
    }
    if (/refuse/i.test(question)) return { stop: "refusal" };
    const how = /^How do I (.+?)\??$/i.exec(question);
    if (how) return { tools: [{ name: "app_help", input: { query: how[1] } }], stop: "tool_use" };
    if (/remind/i.test(question)) return { tools: [{ name: "my_reminder", input: {} }, { name: "propose_reminder_change", input: { on: true, hour: 6, minute: 30 } }], stop: "tool_use" };
    const all = /^Everything about (.+?)\??$/i.exec(question);
    if (all) return { tools: [{ name: "person", input: { name: all[1] } }, { name: "timeline", input: { query: all[1] } }, { name: "look_up_word", input: { word: all[1] } }, { name: "law", input: { query: "sabbath" } }, { name: "precepts", input: { topic: "adultery" } }, { name: "verse_study", input: { reference: "Genesis 12:1" } }], stop: "tool_use" };
    if (/saved chats/i.test(question)) return { tools: [{ name: "my_saved_chats", input: { query: "" } }], stop: "tool_use" };
    if (/dangerous/i.test(question)) return { text: "See [this](javascript:alert(document.domain)) or [that](https://evil.example/x) or [Reading reminders](/settings/reminders).", stop: "end_turn" };
    return { text: `A short answer to: ${question}`, stop: "end_turn" };
  })();

  if (/slowly/i.test(question)) await new Promise((r) => setTimeout(r, 10_000));
  if (/overloaded/i.test(question)) {
    res.writeHead(529, { "content-type": "application/json" });
    return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const ev = (type: string, data: Record<string, unknown>) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const usage = { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  ev("message_start", { message: { id: `msg_${++ids}`, type: "message", role: "assistant", model: "stand-in", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
  let i = 0;
  if (out.text) {
    ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
    for (const piece of out.text.match(/[\s\S]{1,40}/g) ?? []) ev("content_block_delta", { index: i, delta: { type: "text_delta", text: piece } });
    ev("content_block_stop", { index: i }); i++;
  }
  for (const t of out.tools ?? []) {
    ev("content_block_start", { index: i, content_block: { type: "tool_use", id: `toolu_${++ids}`, name: t.name, input: {} } });
    ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(t.input) } });
    ev("content_block_stop", { index: i }); i++;
  }
  ev("message_delta", { delta: { stop_reason: out.stop, stop_sequence: null }, usage });
  ev("message_stop", {});
  res.end();
}
