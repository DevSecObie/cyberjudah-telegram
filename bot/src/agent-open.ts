import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { checkInput } from "./assistant.mjs";
import { unitsFor, type AskModel } from "../../shared/ask-models.mjs";
import type { AgentEvent } from "./agent";

/**
 * Ask's research with any model other than Claude, through Cloudflare's AI binding and the AI
 * Gateway (Unified Billing for third-party models, Workers AI for Cloudflare-hosted ones). The
 * model gets the same instructions, the same tools and the same numbered sources as Claude does
 * in agent.ts; only the wire format differs (shared/ask-models.mjs, `format`):
 * - "chat": chat completions with function tools (OpenAI, Google, xAI, DeepSeek, Qwen, the
 *   Workers AI models that take tools, and others);
 * - "responses": OpenAI's Responses API with function tools;
 * - "messages": the Messages format, through Cloudflare;
 * - "plain": no tools; it answers from the passages already found.
 * Each round is one request (not streamed); the finished answer is sent as one piece.
 */
type Run = (name: string, input: Record<string, unknown>) => Promise<{ content: string; error?: boolean }>;
type Msg = { role: "user" | "assistant"; content: string };
type Result = { text: string; units: number; calls: number; cut: boolean; refused: boolean };
type Ai = { run: (model: string, input: unknown, options?: unknown) => Promise<unknown> };
type ToolCall = { id: string; name: string; arguments: string };

/** A failure from the model's side: shaped as an API connection error, so Ask's backup answers instead (providers.ts claudeUnavailable). */
const unavailable = (e: unknown) => new Anthropic.APIConnectionError({ message: `Model unavailable: ${(e as Error)?.message?.slice(0, 160) ?? "no answer"}` });

export async function researchOpen(
  env: Env,
  model: AskModel,
  system: string,
  messages: Msg[],
  tools: Anthropic.Tool[],
  schemas: Map<string, unknown>,
  run: Run,
  emit: (e: AgentEvent) => void,
  maxRounds: number,
): Promise<Result> {
  if (!env.AI_GATEWAY) throw unavailable(new Error("No AI Gateway is configured for this model"));
  const ai = env.AI as unknown as Ai;
  const call = async (input: unknown): Promise<Record<string, unknown>> => {
    try {
      // Not logged: the request carries the reader's question (providers.ts viaGateway).
      const res = await ai.run(model.id, input, { gateway: { id: env.AI_GATEWAY, collectLog: false } });
      if (!res || typeof res !== "object") throw new Error("empty response");
      return res as Record<string, unknown>;
    } catch (e) { throw unavailable(e); }
  };
  // Cloudflare-hosted models answer briefly unless told how long they may write.
  const length = model.id.startsWith("@cf/") ? { max_tokens: 4096 } : {};
  /** Runs one tool call: its input checked against the tool's schema first, as for Claude. */
  const tool = async (name: string, raw: unknown): Promise<string> => {
    let input: unknown = raw;
    if (typeof raw === "string") { try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { return JSON.stringify({ INVALID_JSON: raw.slice(0, 400) }); } }
    const why = checkInput(schemas.get(name) as never, input);
    if (why) return JSON.stringify({ INVALID_INPUT: why });
    try { return (await run(name, input as Record<string, unknown>)).content; }
    catch (e) { return `That failed: ${(e as Error).message?.slice(0, 120)}`; }
  };
  let units = 0, calls = 0;
  emit({ status: "Studying the question" });

  if (model.format === "plain") {
    const res = await call({ messages: [{ role: "system", content: `${system}\n\nYou have no tools here: answer from the passages given, and cite them by their numbers.` }, ...messages], ...length });
    const { text, usage, cut } = chatText(res);
    units += unitsFor(usage, model); calls++;
    if (text) emit({ delta: text });
    return { text, units, calls, cut, refused: false };
  }

  if (model.format === "responses") {
    const defs = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema }));
    const input: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
    for (let round = 0; round < maxRounds; round++) {
      const last = round === maxRounds - 1;
      const res = await call({ instructions: system, input, tools: defs, ...(last ? { tool_choice: "none" } : {}) });
      units += unitsFor(res.usage as Record<string, unknown>, model); calls++;
      const output = Array.isArray(res.output) ? (res.output as Record<string, unknown>[]) : [];
      const uses = output.filter((o) => o.type === "function_call");
      const said = output.filter((o) => o.type === "message").flatMap((o) => (Array.isArray(o.content) ? (o.content as { type?: string; text?: string }[]) : [])).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
      if (!uses.length || last) {
        if (said) emit({ delta: said });
        return { text: said, units, calls, cut: res.status === "incomplete", refused: false };
      }
      input.push(...output);
      for (const u of uses) input.push({ type: "function_call_output", call_id: u.call_id, output: await tool(String(u.name), u.arguments) });
      emit({ status: "Writing the answer" });
    }
    return { text: "", units, calls, cut: true, refused: false };
  }

  if (model.format === "messages") {
    const convo: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
    for (let round = 0; round < maxRounds; round++) {
      const last = round === maxRounds - 1;
      const res = await call({ system, messages: convo, tools, max_tokens: 8000, ...(last ? { tool_choice: { type: "none" } } : {}) });
      units += unitsFor(res.usage as Record<string, unknown>, model); calls++;
      const content = Array.isArray(res.content) ? (res.content as Record<string, unknown>[]) : [];
      const said = content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
      const uses = content.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) {
        if (said) emit({ delta: said });
        return { text: said, units, calls, cut: res.stop_reason === "max_tokens", refused: res.stop_reason === "refusal" };
      }
      convo.push({ role: "assistant", content });
      const results = [];
      for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await tool(String(u.name), u.input) });
      convo.push({ role: "user", content: results });
      emit({ status: "Writing the answer" });
    }
    return { text: "", units, calls, cut: true, refused: false };
  }

  // "chat": chat completions with function tools.
  const defs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  const convo: unknown[] = [{ role: "system", content: system }, ...messages];
  for (let round = 0; round < maxRounds; round++) {
    const last = round === maxRounds - 1;
    const res = await call({ messages: convo, tools: defs, ...(last ? { tool_choice: "none" } : {}), ...length });
    const { text, usage, cut, toolCalls } = chatText(res);
    units += unitsFor(usage, model); calls++;
    if (!toolCalls.length || last) {
      if (text) emit({ delta: text });
      return { text, units, calls, cut, refused: false };
    }
    convo.push({ role: "assistant", content: text || "", tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
    for (const c of toolCalls) convo.push({ role: "tool", tool_call_id: c.id, content: await tool(c.name, c.arguments) });
    emit({ status: "Writing the answer" });
  }
  return { text: "", units, calls, cut: true, refused: false };
}

/**
 * The text, tool calls and usage of a chat answer, in either shape Cloudflare returns: OpenAI's
 * (`choices[0].message`) or Workers AI's own (`response`, `tool_calls`).
 */
export function chatText(res: Record<string, unknown>): { text: string; toolCalls: ToolCall[]; usage: Record<string, unknown> | undefined; cut: boolean } {
  const usage = res.usage as Record<string, unknown> | undefined;
  const choice = Array.isArray(res.choices) ? (res.choices[0] as Record<string, unknown> | undefined) : undefined;
  if (choice) {
    const msg = (choice.message ?? {}) as Record<string, unknown>;
    const calls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Record<string, unknown>[]) : [];
    return {
      text: typeof msg.content === "string" ? msg.content : "",
      toolCalls: calls.map((c, i) => { const f = (c.function ?? {}) as Record<string, unknown>; return { id: String(c.id ?? `call_${i}`), name: String(f.name ?? ""), arguments: typeof f.arguments === "string" ? f.arguments : JSON.stringify(f.arguments ?? {}) }; }),
      usage,
      cut: choice.finish_reason === "length",
    };
  }
  if ("response" in res || "tool_calls" in res) {
    const calls = Array.isArray(res.tool_calls) ? (res.tool_calls as Record<string, unknown>[]) : [];
    return {
      text: typeof res.response === "string" ? res.response : res.response == null ? "" : JSON.stringify(res.response),
      toolCalls: calls.map((c, i) => ({ id: String(c.id ?? `call_${i}`), name: String(c.name ?? (c.function as { name?: string } | undefined)?.name ?? ""), arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}) })),
      usage,
      cut: false,
    };
  }
  throw unavailable(new Error("unrecognised response"));
}
