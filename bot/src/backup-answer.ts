import type { Env } from "./env";
import { ANSWER_MODEL } from "./ai.mjs";
import type { Passage } from "./ai.mjs";
import { modelOf } from "../../shared/ask-models.mjs";
import { MC_USD } from "../../shared/credits.mjs";
import { creditsConfig } from "./credits";
import { reserveFreeBudget, settleFreeBudget } from "./free-budget";
import { makeSpend } from "./spend";
import { modelOutputLimit } from "./model-capacity.mjs";
import { viaGateway } from "./providers";
import { MAX_OPEN_OUTPUT, adminBudgetPool } from "./research-policy.mjs";

type Msg = { role: "system" | "user" | "assistant"; content: string };
class BackupBudgetUnavailable extends Error {}

/** A longer backup still has to fit the sponsor's allowance before any provider call. */
async function prepare(env: Env, messages: Msg[], admin: boolean) {
  const model = modelOf(ANSWER_MODEL), cfg = creditsConfig(env);
  const budget = admin ? cfg.maxRequestMc * MC_USD : Math.max(0.001, Number(env.ASK_FREE_MAX_USD ?? 0.05));
  const reservation = await reserveFreeBudget(env, crypto.randomUUID(), budget, Date.now(), admin ? adminBudgetPool(env) : undefined).catch(() => { throw new BackupBudgetUnavailable("The backup answer allowance is unavailable."); });
  if (!reservation) throw new BackupBudgetUnavailable("The backup answer allowance is exhausted.");
  const spend = makeSpend({ budgetUsd: budget, rates: cfg.research });
  const input = new TextEncoder().encode(JSON.stringify({ messages })).length + 1024;
  const room = spend.outputTokensLeft(model, spend.inputUsd({ input_tokens: input }, model));
  const maxTokens = Math.floor(Math.min(MAX_OPEN_OUTPUT, modelOutputLimit(model, { messages }) ?? room, room));
  if (maxTokens < 64) {
    if (reservation) await settleFreeBudget(env, reservation, 0);
    throw new BackupBudgetUnavailable("The backup has no room for an answer within its context or spending allowance.");
  }
  let closed = false;
  return { maxTokens, async finish(usage: object | undefined, complete: boolean) {
    if (closed) return;
    closed = true;
    spend.call(usage, model);
    const cost = complete && !spend.unreported ? spend.total() : Math.max(spend.total(), budget);
    // A failed settlement leaves the reservation held, so it can never fund another answer.
    if (reservation) await settleFreeBudget(env, reservation, cost).catch(() => { console.error(JSON.stringify({ event: "ask_backup_settle_failed" })); });
    console.log(JSON.stringify({ event: "ask_backup_usage", model: model.id, cost_usd: cost, reported: !spend.unreported, complete }));
  } };
}

async function admit(env: Env, messages: Msg[], admin: boolean, sources: Passage[]): Promise<Awaited<ReturnType<typeof prepare>> | string> {
  try { return await prepare(env, messages, admin); }
  catch (error) {
    if (!(error instanceof BackupBudgetUnavailable)) throw error;
    const excerpts = sources.slice(0, 4).map((source, index) => {
      const text = source.text.trim().slice(0, 1000);
      if (!text) return "";
      const title = source.title.replace(/[*_\[\]]/g, "");
      return `**${title}** [${index + 1}]\n\n> ${text.replace(/\n/g, "\n> ")}`;
    }).filter(Boolean);
    if (!excerpts.length) throw error;
    // No new inference or teaching after the sponsor's cap: show only attributed source text.
    return `I can't generate a new answer right now. Here are the retrieved source excerpts:\n\n${excerpts.join("\n\n")}`;
  }
}

export async function backupOnce(env: Env, messages: Msg[], admin = false, sources: Passage[] = [], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const budget = await admit(env, messages, admin, sources);
  if (typeof budget === "string") return budget;
  let usage: object | undefined, complete = false;
  try {
    const res = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: budget.maxTokens, temperature: 0.3 }, { ...viaGateway(env), ...(signal ? { signal } : {}) }) as { response?: string; usage?: object };
    usage = res.usage;
    complete = true;
    return (res.response ?? "").trim();
  } finally { await budget.finish(usage, complete); }
}

/**
 * `wrote.model` is set only when a model actually writes the answer. With no budget left, the
 * answer is a fixed notice with the passages' own words, which no model wrote, and it stays unset.
 */
export async function* backupPieces(env: Env, messages: Msg[], admin = false, sources: Passage[] = [], signal?: AbortSignal, wrote: { model?: string } = {}): AsyncGenerator<string> {
  signal?.throwIfAborted();
  const budget = await admit(env, messages, admin, sources);
  if (typeof budget === "string") { yield budget; return; }
  let usage: object | undefined, complete = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const out = await env.AI.run(ANSWER_MODEL, { messages, max_tokens: budget.maxTokens, temperature: 0.3, stream: true }, { ...viaGateway(env), ...(signal ? { signal } : {}) }) as ReadableStream<Uint8Array>;
    reader = out.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    function* events(frames: string[]) {
      for (const frame of frames) for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const value = JSON.parse(data) as { response?: string; usage?: object; choices?: { delta?: { content?: string } }[] };
          if (value.usage) usage = value.usage;
          const text = value.response ?? value.choices?.[0]?.delta?.content;
          if (text) { wrote.model = ANSWER_MODEL; yield text; }
        } catch { /* Ignore a non-JSON provider frame, without exposing it to the reader. */ }
      }
    }
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split("\n\n"); buffer = frames.pop() ?? "";
      yield* events(frames);
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield* events([buffer]);
    complete = true;
  } finally {
    if (reader) { if (!complete) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    await budget.finish(usage, complete);
  }
}
