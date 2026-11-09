import { readAIStream } from "./ai-stream.mjs";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { checkInput } from "./assistant.mjs";
import { unitsFor, type AskModel } from "../../shared/ask-models.mjs";
import type { AgentEvent } from "./agent";
import type { Spend } from "./spend";
import { modelOutputLimit } from "./model-capacity.mjs";
import { DATA_POLICY, groundedSystem, untrustedData } from "./grounding.mjs";
import { MAX_OPEN_OUTPUT, MAX_RESEARCH_MS, WRITING_RESERVE_MS, writingDue, withinPhase, researchRounds, researchSignal } from "./research-policy.mjs";

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
type Result = { text: string; units: number; calls: number; cut: boolean; refused: boolean; stopped?: "rounds" | "budget" | "deadline" };
type Ai = { run: (model: string, input: unknown, options?: unknown) => Promise<unknown> };
type ToolCall = { id: string; name: string; arguments: string };

/** A failure from the model's side: shaped as an API connection error, so Ask's backup answers instead (providers.ts claudeUnavailable). */
const unavailable = (e: unknown) => Object.assign(new Anthropic.APIConnectionError({ message: `Model unavailable: ${(e as Error)?.message?.slice(0, 160) ?? "no answer"}` }), { providerStatus: (e as { status?: number })?.status ?? 0 });
/** Distinguish a local budget refusal from a failed provider request. */
export class ModelBudgetError extends Error {}
/** The conversation no longer leaves the model room to answer. */
class ContextFullError extends Error {}

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
  options: { think?: boolean; signal?: AbortSignal; deadlineAt?: number; researchNote?: () => string | undefined; reviewAnswer?: (answer: string) => string | undefined } = {},
): Promise<Result> {
  maxRounds = researchRounds(maxRounds);
  const deadlineAt = options.deadlineAt ?? Date.now() + MAX_RESEARCH_MS;
  const signal = researchSignal(options.signal, deadlineAt);
  const toolSignal = researchSignal(signal, deadlineAt - WRITING_RESERVE_MS);
  signal.throwIfAborted();
  if (!system.includes(DATA_POLICY)) system = groundedSystem(system);
  if (!env.AI_GATEWAY) throw unavailable(new Error("No AI Gateway is configured for this model"));
  const ai = env.AI as unknown as Ai;
  const call = async (input: unknown): Promise<Record<string, unknown>> => {
    signal.throwIfAborted();
    const outputKey = model.format === "responses" ? "max_output_tokens" : model.format === "chat" && model.id.startsWith("openai/") ? "max_completion_tokens" : "max_tokens";
    let outputLimit = Math.min(MAX_OPEN_OUTPUT, modelOutputLimit(model, input) ?? MAX_OPEN_OUTPUT);
    if (spend?.budgetUsd != null) {
      // Bound every wire format by its reserved budget, including paid chat completions.
      const tokens = new TextEncoder().encode(JSON.stringify(input)).length + 1024;
      const room = spend.outputTokensLeft(model, spend.inputUsd({ input_tokens: tokens }, model));
      if (room < 64 || spend.unreported) throw new ModelBudgetError("The answer has used its reserved budget.");
      outputLimit = outputLimit === null ? room : Math.min(outputLimit, room);
    }
    if (outputLimit !== null && outputLimit < 64) throw new ContextFullError("This model's context window is full. Use a model with a larger context window.");
    if (outputLimit !== null) input = { ...(input as Record<string, unknown>), [outputKey]: outputLimit };
    // An answer keeps each model's full reasoning; only a short mechanical step (a research plan)
    // is asked not to think first, which saves its time without making the answer shallower.
    if (options.think === false && DEEPSEEK_V4.test(model.id)) input = { ...(input as Record<string, unknown>), reasoning_effort: "none" };
    else if (options.think === false && GEMMA_4.test(model.id)) input = { ...(input as Record<string, unknown>), chat_template_kwargs: { enable_thinking: false } };
    try {
      // Not logged: the request carries the reader's question (providers.ts viaGateway).
      const res = await ai.run(model.id, input, { gateway: { id: env.AI_GATEWAY, collectLog: false }, signal });
      if (!res || typeof res !== "object") throw new Error("empty response");
      if (streamPlain && typeof (res as ReadableStream).getReader === "function") return readAIStream(res as ReadableStream<Uint8Array>, text => emit({ delta: text }));
      return res as Record<string, unknown>;
    } catch (e) { if (spend) spend.unreported = true; signal.throwIfAborted(); throw unavailable(e); }
  };
  /** Runs one tool call: its input checked against the tool's schema first, as for Claude. */
  const tool = async (name: string, raw: unknown): Promise<string> => {
    signal.throwIfAborted();
    if (writingDue(deadlineAt)) return untrustedData({ error: "Research time is reserved for writing the final answer from the registered sources." }, "tool_output");
    let input: unknown = raw;
    if (typeof raw === "string") { try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { return untrustedData({ INVALID_JSON: raw.slice(0, 400) }, "tool_output"); } }
    const why = checkInput(schemas.get(name) as never, input);
    if (why) return untrustedData({ INVALID_INPUT: why }, "tool_output");
    try { return untrustedData(await withinPhase(() => run(name, input as Record<string, unknown>), toolSignal), "tool_output"); }
    catch (e) { signal.throwIfAborted(); return untrustedData({ error: (e as Error).message?.slice(0, 120) }, "tool_output"); }
  };
  let units = 0, calls = 0;
  let draft = "";
  const stopReason = (round: number): Result["stopped"] => writingDue(deadlineAt) ? "deadline" : spend?.over(0.7) ? "budget" : round === maxRounds - 1 ? "rounds" : undefined;
  const finish = (text: string, cut: boolean, refused = false, stopped?: Result["stopped"]): Result => {
    if (draft && (!text.trim() || cut) && !refused) { text = draft; cut = false; }
    if (text) emit({ delta: text });
    return { text, units, calls, cut, refused, ...(stopped ? { stopped } : {}) };
  };
  emit({ status: "Studying the question" });

  if (model.format === "plain") {
    const res = await call({ messages: [{ role: "system", content: `${system}\n\n${plainInstruction}` }, ...messages], ...(streamPlain ? { stream: true } : {}) });
    const { text, usage, cut } = chatText(res);
    units += unitsFor(usage, model); calls++; spend?.call(usage, model);
    if (text && !streamPlain) emit({ delta: text });
    return { text, units, calls, cut, refused: false };
  }

  try {
    if (model.format === "responses") {
      const defs = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.input_schema }));
      const input: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
      for (let round = 0; round < maxRounds; round++) {
        // Past 70% of the request's budget the research stops and the answer is written (agent.ts).
        const stopped = stopReason(round), last = !!stopped;
        const res = await call({ instructions: system, input, tools: defs, ...(last ? { tool_choice: "none" } : {}) });
        units += unitsFor(res.usage as Record<string, unknown>, model); calls++; spend?.call(res.usage as Record<string, unknown>, model);
        const output = Array.isArray(res.output) ? (res.output as Record<string, unknown>[]) : [];
        const uses = output.filter((o) => o.type === "function_call");
        const said = output.filter((o) => o.type === "message").flatMap((o) => (Array.isArray(o.content) ? (o.content as { type?: string; text?: string }[]) : [])).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
        if (!uses.length || last) {
          const cut = res.status === "incomplete";
          const review = !last && !cut && said.trim() ? options.reviewAnswer?.(said) : undefined;
          if (review) { draft = said; input.push(...output, { role: "user", content: review }); continue; }
          return finish(said, cut, false, stopped);
        }
        input.push(...output);
        for (const u of uses) input.push({ type: "function_call_output", call_id: u.call_id, output: await tool(String(u.name), u.arguments) });
        const note = options.researchNote?.();
        if (note) input.push({ role: "user", content: note });
        emit({ status: "Writing the answer" });
      }
      return { text: "", units, calls, cut: true, refused: false };
    }

    if (model.format === "messages") {
      const convo: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
      for (let round = 0; round < maxRounds; round++) {
        const stopped = stopReason(round), last = !!stopped;
        const res = await call({ system, messages: convo, tools, ...(last ? { tool_choice: { type: "none" } } : {}) });
        units += unitsFor(res.usage as Record<string, unknown>, model); calls++; spend?.call(res.usage as Record<string, unknown>, model);
        const content = Array.isArray(res.content) ? (res.content as Record<string, unknown>[]) : [];
        const said = content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("");
        const uses = content.filter((b) => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !uses.length || last) {
          const cut = res.stop_reason === "max_tokens", refused = res.stop_reason === "refusal";
          const review = !last && !cut && !refused && said.trim() ? options.reviewAnswer?.(said) : undefined;
          if (review) { draft = said; convo.push({ role: "assistant", content }, { role: "user", content: review }); continue; }
          return finish(said, cut, refused, stopped);
        }
        convo.push({ role: "assistant", content });
        const results = [];
        for (const u of uses) results.push({ type: "tool_result", tool_use_id: u.id, content: await tool(String(u.name), u.input) });
        const note = options.researchNote?.();
        convo.push({ role: "user", content: note ? [...results, { type: "text", text: note }] : results });
        emit({ status: "Writing the answer" });
      }
      return { text: "", units, calls, cut: true, refused: false };
    }

    // "chat": chat completions with function tools.
    const defs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const convo: unknown[] = [{ role: "system", content: system }, ...messages];
    for (let round = 0; round < maxRounds; round++) {
      const stopped = stopReason(round), last = !!stopped;
      const res = await call({ messages: convo, tools: defs, ...(last ? { tool_choice: "none" } : {}) });
      const { text, usage, cut, toolCalls } = chatText(res);
      units += unitsFor(usage, model); calls++; spend?.call(usage, model);
      if (!toolCalls.length || last) {
        if (text || !hadToolMarkup(res)) {
          const review = !last && !cut && text.trim() ? options.reviewAnswer?.(text) : undefined;
          if (review) { draft = text; convo.push({ role: "assistant", content: text }, { role: "user", content: review }); continue; }
          return finish(text, cut, false, stopped);
        }
        // The model wrote only tool calls when it was told to answer: ask once more, with no tools
        // offered, so the reader gets prose and never the call markup.
        if (calls >= maxRounds || spend?.over(0.9)) return finish("", true, false, spend?.over(0.9) ? "budget" : "rounds");
        const again = chatText(await call({ messages: [...convo, { role: "user", content: "Write the answer now from what you have read, in plain prose, citing the sources by their numbers. Do not call any tools." }] }));
        units += unitsFor(again.usage, model); calls++; spend?.call(again.usage, model);
        return finish(again.text, again.cut, false, stopped);
      }
      convo.push({ role: "assistant", content: text || "", tool_calls: toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
      for (const c of toolCalls) convo.push({ role: "tool", tool_call_id: c.id, content: await tool(c.name, c.arguments) });
      const note = options.researchNote?.();
      if (note) convo.push({ role: "user", content: note });
      emit({ status: "Writing the answer" });
    }
    return finish("", true, false, "rounds");
  } catch (error) {
    if (!draft || (signal.aborted && signal.reason?.name !== "TimeoutError")) throw error;
    if (error instanceof ModelBudgetError) return finish(draft, false, false, "budget");
    if (signal.aborted && signal.reason?.name === "TimeoutError") return finish(draft, false, false, "deadline");
    // A failed provider call on the repair round (rate limit, overload, a bad reply), or a conversation
    // too long to answer in, never costs the reader the answer already written. Research ended on a
    // limit, not because the library had nothing ("rounds", so the reader may continue). Anything
    // else (a fault in this code) is still raised.
    if (error instanceof Anthropic.APIConnectionError || error instanceof ContextFullError) {
      console.error(JSON.stringify({ event: "ask_sendback_failed", status: (error as { providerStatus?: number }).providerStatus ?? 0 }));
      return finish(draft, false, false, "rounds");
    }
    throw error;
  }
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
