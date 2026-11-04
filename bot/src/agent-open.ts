import { readAIStream } from "./ai-stream.mjs";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { checkInput } from "./assistant.mjs";
import { unitsFor, type AskModel } from "../../shared/ask-models.mjs";
import type { AgentEvent } from "./agent";
import type { Spend } from "./spend";

const DEEPSEEK_V4 = /^@cf\/deepseek-ai\/deepseek-v4/;
const GEMMA_4 = /^@cf\/google\/gemma-4/;

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
  spend?: Spend,
  streamPlain = false,
  plainInstruction = 'You have no tools here: answer from the passages given, and cite them by their numbers.',
  /** think: false asks a reasoning model not to think first, for short mechanical steps such as a research plan. */
  options: { think?: boolean } = {},
): Promise<Result> {
  if (!env.AI_GATEWAY) throw unavailable(new Error("No AI Gateway is configured for this model"));
  const ai = env.AI as unknown as Ai;
  const call = async (input: unknown): Promise<Record<string, unknown>> => {
    if ((model.id.startsWith("@cf/") || model.format === "plain") && spend?.budgetUsd != null) {
      // Bound the output before starting a free call, including plain/chat models. Use
      // UTF-8 bytes plus framing headroom as a conservative input-token allowance.
      // A budget refusal must not turn into an unmetered provider fallback.
      const tokens = new TextEncoder().encode(JSON.stringify(input)).length + 1024;
      const room = spend.outputTokensLeft(model, spend.inputUsd({ input_tokens: tokens }, model));
      if (room < 64 || spend.unreported) throw new Error("The answer has used its reserved budget.");
      input = { ...(input as Record<string, unknown>), max_tokens: Math.min(4096, model.maxOutput ?? 4096, room) };
    } else if ((model.format === "messages" || model.format === "responses") && spend?.budgetUsd != null) {
      // A paid answer is held to what was set aside for it, as Claude's is (agent.ts): each call may
      // write only what the rest of the budget pays for, with enough room to finish a sentence.
      const tokens = new TextEncoder().encode(JSON.stringify(input)).length + 1024;
      const room = spend.outputTokensLeft(model, spend.inputUsd({ input_tokens: tokens }, model));
      const key = model.format === "responses" ? "max_output_tokens" : "max_tokens";
      const asked = Number((input as Record<string, unknown>)[key] ?? 8000);
      input = { ...(input as Record<string, unknown>), [key]: Math.max(256, Math.min(asked, model.maxOutput ?? asked, room)) };
    }
    // An answer keeps each model's full reasoning; only a short mechanical step (a research plan)
    // is asked not to think first, which saves its time without making the answer shallower.
    if (options.think === false && DEEPSEEK_V4.test(model.id)) input = { ...(input as Record<string, unknown>), reasoning_effort: "none" };
    else if (options.think === false && GEMMA_4.test(model.id)) input = { ...(input as Record<string, unknown>), chat_template_kwargs: { enable_thinking: false } };
    try {
      // Not logged: the request carries the reader's question (providers.ts viaGateway).
      const res = await ai.run(model.id, input, { gateway: { id: env.AI_GATEWAY, collectLog: false } });
      if (!res || typeof res !== "object") throw new Error("empty response");
      if (streamPlain && typeof (res as ReadableStream).getReader === "function") return readAIStream(res as ReadableStream<Uint8Array>, text => emit({ delta: text }));
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
    const res = await call({ messages: [{ role: "system", content: `${system}\n\n${plainInstruction}` }, ...messages], ...length, ...(streamPlain ? { stream: true } : {}) });
    const { text, usage, cut } = chatText(res);
    units += unitsFor(usage, model); calls++; spend?.call(usage, model);
    if (text && !streamPlain) emit({ delta: text });
    return { text, units, calls, cut, refused: false };
  }

  if (model.format === "responses") {
    const defs = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema }));
    const input: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
    for (let round = 0; round < maxRounds; round++) {
      // Past 70% of the request's budget the research stops and the answer is written (agent.ts).
      const last = round === maxRounds - 1 || !!spend?.over(0.7);
      const res = await call({ instructions: system, input, tools: defs, ...(last ? { tool_choice: "none" } : {}) });
      units += unitsFor(res.usage as Record<string, unknown>, model); calls++; spend?.call(res.usage as Record<string, unknown>, model);
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
      const last = round === maxRounds - 1 || !!spend?.over(0.7);
      const res = await call({ system, messages: convo, tools, max_tokens: 8000, ...(last ? { tool_choice: { type: "none" } } : {}) });
      units += unitsFor(res.usage as Record<string, unknown>, model); calls++; spend?.call(res.usage as Record<string, unknown>, model);
      const content = Array.isArray(res.content) ? (res.content as Record<string, unknown>[]) : [];
      const said = content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
      const uses = content.filter((b) => b.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length || last) {
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
    const last = round === maxRounds - 1 || !!spend?.over(0.7);
    const res = await call({ messages: convo, tools: defs, ...(last ? { tool_choice: "none" } : {}), ...length });
    const { text, usage, cut, toolCalls } = chatText(res);
    units += unitsFor(usage, model); calls++; spend?.call(usage, model);
    if (!toolCalls.length || last) {
      if (text || !hadToolMarkup(res)) {
        if (text) emit({ delta: text });
        return { text, units, calls, cut, refused: false };
      }
      // The model wrote only tool calls when it was told to answer: ask once more, with no tools
      // offered, so the reader gets prose and never the call markup.
      if (spend?.over(0.9)) return { text: "", units, calls, cut: true, refused: false };
      const again = chatText(await call({ messages: [...convo, { role: "user", content: "Write the answer now from what you have read, in plain prose, citing the sources by their numbers. Do not call any tools." }], ...length }));
      units += unitsFor(again.usage, model); calls++; spend?.call(again.usage, model);
      if (again.text) emit({ delta: again.text });
      return { text: again.text, units, calls, cut: again.cut, refused: false };
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
  const read = chatTextRaw(res);
  if (!hasToolMarkup(read.text)) return read;
  // Some models (DeepSeek V4 on Workers AI) can write their tool calls into the answer text as
  // DSML markup instead of the tool_calls field. Run those calls as tools, and never show the markup.
  const found = toolMarkupCalls(read.text);
  return { ...read, text: stripToolMarkup(read.text), toolCalls: read.toolCalls.length ? read.toolCalls : found };
}

/** Whether a chat reply's text carried tool-call markup (see chatText). */
function hadToolMarkup(res: Record<string, unknown>): boolean {
  try { return hasToolMarkup(chatTextRaw(res).text); } catch { return false; }
}

// DeepSeek's DSML: <｜DSML｜tool_calls> <｜DSML｜invoke name="…"> <｜DSML｜parameter name="…" string="true">…</｜DSML｜parameter> …
// The bars are U+FF5C (fullwidth) in the model's output; a plain "|" is accepted too.
const BAR = "[\\uFF5C|]\\s*";
const DSML = `<?\\s*${BAR}DSML\\s*${BAR}`;
const DSML_CLOSE = `<?\\s*/\\s*${BAR}DSML\\s*${BAR}`;
const MARKUP = new RegExp(`${DSML}(?:tool|function)_calls\\s*>[\\s\\S]*?(?:${DSML_CLOSE}(?:tool|function)_calls\\s*>|$)`, "g");
const INVOKE = new RegExp(`${DSML}invoke\\s+name\\s*=\\s*"([^"]+)"\\s*>([\\s\\S]*?)(?=${DSML_CLOSE}invoke\\s*>|${DSML}invoke\\b|${DSML_CLOSE}(?:tool|function)_calls|$)`, "g");
const PARAM = new RegExp(`${DSML}parameter\\s+name\\s*=\\s*"([^"]+)"(?:\\s+string\\s*=\\s*"(true|false)")?\\s*>([\\s\\S]*?)${DSML_CLOSE}parameter\\s*>`, "g");

export function hasToolMarkup(text: string): boolean {
  return new RegExp(`${DSML}(?:tool|function)_calls`).test(text);
}

/** The tool calls written as DSML markup in a model's text, as chat tool calls. */
export function toolMarkupCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const block of text.match(MARKUP) ?? []) {
    for (const [, name, body] of block.matchAll(INVOKE)) {
      const args: Record<string, unknown> = {};
      for (const [, key, isString, value] of body.matchAll(PARAM)) {
        if (isString === "false") { try { args[key] = JSON.parse(value.trim()); continue; } catch { /* kept as text */ } }
        args[key] = value.trim();
      }
      calls.push({ id: `dsml_${calls.length}`, name, arguments: JSON.stringify(args) });
    }
  }
  return calls;
}

/** A model's text without any tool-call markup in it. */
export function stripToolMarkup(text: string): string {
  return text.replace(MARKUP, "").trim();
}

function chatTextRaw(res: Record<string, unknown>): { text: string; toolCalls: ToolCall[]; usage: Record<string, unknown> | undefined; cut: boolean } {
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
