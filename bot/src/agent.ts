import Anthropic from "@anthropic-ai/sdk";

import { books, chapter, dataJson } from "./data";
import { claude } from "./providers";
import type { Env, Exec } from "./env";
import { MORE_RUN, MORE_TOOLS } from "./ask-tools";
import { answerCandidates, APP, normalizeHistory, RESEARCH, SYSTEM, type Passage, type Turn } from "./ai.mjs";
import { checkInput, describeReminder, findCases, findChats, findFeatures, findPeople, proposeReminder } from "./assistant.mjs";
import { FEATURES } from "../../shared/app-features.mjs";
import { listChats, type SavedAction } from "./chats";
import { loadReminder, tgRid } from "./remind";
import { publicView } from "./reminders.mjs";
import { parseReference } from "./refs.mjs";
import { modelOf, unitsFor, type AskModel } from "../../shared/ask-models.mjs";
import { researchOpen } from "./agent-open";
import { freeSpend, type Spend } from "./spend";

/**
 * Ask CyberJudah with Claude doing its own research: it starts from the passages retrieval
 * found for the question, then searches the library again in its own words and reads the
 * verses it will quote, as many times as the question needs (up to a few rounds), before it
 * writes. Every passage and verse it saw is numbered once, across all its searches, so its
 * [n] citations map to one list of sources.
 */
export type Numbered = Passage & { n: number };
export type AgentEvent = { status: string } | { passages: Numbered[] } | { delta: string } | { reset: true } | { action: SavedAction };

const MAX_ROUNDS = 6;
const MAX_SOURCES = 48;
const CLAUDE_DEFAULT = "claude-sonnet-5";

const TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "search_library",
    description: "Search CyberJudah's library: the Sabbath classes and other recordings (what was said, with the moment), the study notes, the law handbook, the precepts, the case studies and the encyclopedia. Returns the closest passages, numbered for citation. Call it for any question about the Scripture or the teachings that the passages already given do not fully answer, and again with different words, names, feasts, books or doctrines to look from another side.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to look for, in a few words or a short question." } }, required: ["query"] },
  },
  {
    name: "app_help",
    description: "What the CyberJudah app has and where: its screens and what each lets the person do, with the in-app link to each. Call it whenever the person asks how to do something in the app, where something is, or whether the app can do something. Answer only from what it returns.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What the person wants to do or find, in a few words. Empty lists the main screens." } }, required: [] },
  },
  {
    name: "find_in_app",
    description: "Find people (everyone named in the Bible, with what the classes say) and case studies (judgments and blessings in the Scripture) in the app, by name or subject, each with its in-app link. Call it when the person asks where to read about a person or a case in the app, or when a link to one would help them go further.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A name or a subject." } }, required: ["query"] },
  },
  {
    name: "my_saved_chats",
    description: "The person's own saved conversations with you, newest first, by title, with a link to reopen each. Call it when the person asks about something they asked before, or to find or reopen an earlier chat. Give a query to find one by its subject.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words from the conversation's subject; empty for the most recent." } }, required: [] },
  },
  {
    name: "my_reminder",
    description: "The person's daily reading reminder as it is now: on or off, the time and time zone, where it is sent, any pause, and what it points to. Call it when they ask about their reminder, and before proposing a change to it.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "propose_reminder_change",
    description: "Propose a change to the person's reading reminder: turn it on or off, move its time, pause or resume it. Call it when the person asks for such a change. Nothing changes until they tap Confirm on the card this puts under your answer. Give only what should change.",
    input_schema: {
      type: "object",
      properties: {
        on: { type: "boolean", description: "true to turn reminders on (by Telegram), false to turn them off." },
        hour: { type: "integer", description: "0 to 23, the person's own time." },
        minute: { type: "integer", enum: [0, 15, 30, 45] },
        pause: { type: "string", description: "\"1\" until tomorrow, \"7\" for a week, \"forever\" until resumed, or a date YYYY-MM-DD." },
        resume: { type: "boolean", description: "true to end a pause." },
        channel: { type: "string", enum: ["telegram", "push", "both"] },
      },
      required: [],
    },
  },
  {
    name: "read_scripture",
    description: "Read the exact King James text (the Apocrypha included) of a reference: a chapter (\"Sirach 43\"), a verse (\"Exodus 12:14\") or a range (\"Deuteronomy 16:1-8\"). Returns the verses, numbered for citation. Call it for every verse you will quote that is not already in the passages: quote Scripture only from what this returns or from the passages.",
    input_schema: { type: "object", properties: { reference: { type: "string", description: "Book, chapter and optional verse or range." } }, required: ["reference"] },
  },
  ...MORE_TOOLS,
];

/**
 * The answer is streamed, so each tool's input streams as it is written (eager input
 * streaming, as the Claude docs advise for streamed requests with client tools). The API
 * then no longer checks the input, so every input is checked here before a tool runs.
 */
const TOOLS: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }));
const SCHEMAS = new Map(TOOL_DEFS.map((t) => [t.name, t.input_schema]));

const keyOf = (p: Passage) => (p.video ? `v|${p.video}|${Math.round((p.t ?? 0) / 90)}` : `${p.kind}|${p.url}|${p.sub ?? ""}`);
const listed = (p: Numbered) => `[${p.n}] ${p.title}${p.sub ? ` · ${p.sub}` : ""}${p.date ? ` (${p.date})` : ""}\n${p.text}`;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function runAgent(
  env: Env,
  question: string,
  history: Turn[],
  first: Passage[],
  retrieve: (text: string, k: number) => Promise<Passage[]>,
  emit: (e: AgentEvent) => void,
  ctx?: Exec,
  userId?: number,
  model: AskModel = modelOf(env.CLAUDE_MODEL || CLAUDE_DEFAULT),
  spend: Spend = freeSpend(),
): Promise<{ text: string; passages: Numbered[]; units: number; calls: number; actions: SavedAction[]; cut: boolean; refused: boolean }> {
  // Directly, through the AI Gateway, or to the tests' stand-in (providers.ts).
  const client = await claude(env);
  const passages: Numbered[] = [];
  const seen = new Map<string, number>();
  const add = (p: Passage): { n: number; fresh: boolean } | null => {
    const k = keyOf(p);
    if (seen.has(k)) return { n: seen.get(k)!, fresh: false };
    if (passages.length >= MAX_SOURCES) return null;
    const n = passages.length + 1;
    passages.push({ ...p, n }); seen.set(k, n);
    return { n, fresh: true };
  };
  for (const p of first) add(p);
  const actions: SavedAction[] = [];
  const line = (name: string, what: string, path: string) => `${name}: ${what} Link: ${path}`;
  if (passages.length) emit({ passages: [...passages] });

  const run = async (name: string, input: Record<string, unknown>): Promise<{ content: string; error?: boolean }> => {
    if (name === "search_library") {
      const query = str(input.query, 200);
      if (query.length < 2) return { content: "Give a query of a few words.", error: true };
      emit({ status: `Searching the teachings for “${query}”` });
      const found = answerCandidates(query, await retrieve(query, 10), 6);
      const lines: string[] = [];
      for (const p of found) { const a = add(p); if (a) lines.push(a.fresh ? listed(passages[a.n - 1]) : `[${a.n}] ${p.title} (already given above)`); }
      emit({ passages: [...passages] });
      return { content: lines.length ? lines.join("\n\n") : "Nothing more in the library for that. Try other words." };
    }
    if (name === "read_scripture") {
      const reference = str(input.reference, 80);
      const list = await books(env, ctx);
      const ref = list ? parseReference(reference, list) : null;
      if (!ref) return { content: `"${reference}" is not a reference this Bible has. Use the book, chapter and verses, like "Exodus 12:14".`, error: true };
      emit({ status: `Reading ${ref.label}` });
      const c = await chapter(env, ref.slug, ref.chapter, ctx);
      if (!c) return { content: `${ref.label} could not be read just now.`, error: true };
      const from = ref.verse ?? 1, to = ref.verseEnd ?? ref.verse ?? Math.min(c.verses.length, 40);
      const verses = c.verses.filter((v) => v.verse >= from && v.verse <= to);
      if (!verses.length) return { content: `${ref.label} has no such verses.`, error: true };
      const label = ref.verse ? `${ref.book} ${ref.chapter}:${from}${to > from ? `-${to}` : ""}` : `${ref.book} ${ref.chapter}${to < c.verses.length ? `:1-${to}` : ""}`;
      const text = verses.map((v) => `${v.verse} ${v.text}`).join("\n");
      const a = add({ kind: "verse", title: label, url: `/bible/${ref.slug}/${ref.chapter}`, sub: "", text: text.slice(0, 1400) });
      emit({ passages: [...passages] });
      return { content: `${a ? `[${a.n}] ` : ""}${label} (KJV)\n${text}` };
    }
    if (name === "app_help") {
      const query = str(input.query, 120);
      emit({ status: query ? `Looking up “${query}” in the app` : "Looking up the app" });
      const hits = query ? findFeatures(FEATURES, query, 6) : FEATURES.filter((f) => f.main);
      return { content: hits.length ? hits.map((f) => line(f.name, `${f.what}${f.telegramOnly ? " (inside Telegram only)" : ""}`, f.path)).join("\n") : "The app has nothing that matches. Say so; do not describe a feature that is not listed." };
    }
    if (name === "find_in_app") {
      const query = str(input.query, 120);
      if (query.length < 2) return { content: "Give a name or a subject.", error: true };
      emit({ status: `Looking up “${query}” in the app` });
      const [people, cases] = await Promise.all([
        dataJson<{ id: string; name: string; names: string[]; description: string }[]>(env, "/api/people/index.json", ctx).catch(() => null),
        dataJson<{ cases: { slug: string; name: string; charge: string; url: string; themes?: string[]; topics?: string[] }[] }>(env, "/api/cases/index.json", ctx).catch(() => null),
      ]);
      const lines = [
        ...findPeople(people ?? [], query, 5).map((p) => line(`Person: ${p.name}`, `${p.description}.`, `/person/${encodeURIComponent(p.id)}`)),
        ...findCases(cases?.cases ?? [], query, 5).filter((c) => c.url?.startsWith("/cases/")).map((c) => line(`Case study: ${c.name}`, `${c.charge}.`, c.url)),
      ];
      return { content: lines.length ? lines.join("\n") : (people || cases ? "No person or case study by that name or subject." : "The people and case studies could not be read just now."), ...(people || cases ? {} : { error: true }) };
    }
    if (name === "my_saved_chats") {
      if (!userId) return { content: "The person is not signed in, so there are no saved chats to look at.", error: true };
      const query = str(input.query, 120);
      emit({ status: "Looking through your saved chats" });
      const hits = findChats(await listChats(env, userId), query, 8);
      return { content: hits.length ? hits.map((c) => line(c.title, `${c.count} ${c.count === 1 ? "question" : "questions"}, last on ${c.updated.slice(0, 10)}.`, `/ask?chat=${c.id}`)).join("\n") : query ? "No saved chat matches that." : "The person has no saved chats yet." };
    }
    if (name === "my_reminder") {
      if (!userId) return { content: "The person is not signed in.", error: true };
      emit({ status: "Looking at your reading reminder" });
      const rec = await loadReminder(env, await tgRid(env, userId));
      return { content: `${describeReminder(rec ? publicView(rec) : null)} Settings: /settings/reminders` };
    }
    if (name === "propose_reminder_change") {
      if (!userId) return { content: "The person is not signed in, so nothing can be proposed.", error: true };
      const p = proposeReminder(input, { inTelegram: true });
      if (p.error) return { content: p.error, error: true };
      const action: SavedAction = { id: crypto.randomUUID().replace(/-/g, "").slice(0, 16), kind: "reminder", summary: p.summary!, settings: p.settings as Record<string, unknown> };
      actions.push(action);
      emit({ action });
      return { content: `A card now sits under your answer: "${p.summary}" with Confirm and Cancel. Nothing has changed: it happens only if they tap Confirm. Do not say it is done.` };
    }
    const more = MORE_RUN[name];
    if (more) return more(env, input, ctx, emit, line);
    return { content: `No tool named ${name}.`, error: true };
  };

  const messages: Anthropic.MessageParam[] = [
    ...normalizeHistory(history, 6).map((m) => ({ role: m.role as "assistant" | "user", content: String(m.content).slice(0, 3000) })),
    { role: "user", content: `${passages.length ? `Passages already found for this question:\n\n${passages.map(listed).join("\n\n")}` : "The first search found nothing close; search the library yourself."}\n\nQuestion: ${question}` },
  ];

  // Every other model researches through Cloudflare, with the same tools and the same sources
  // (agent-open.ts); only Claude streams through the Messages API below.
  if (model.format !== "anthropic") {
    const r = await researchOpen(env, model, `${SYSTEM}\n\n${RESEARCH}\n\n${APP}`, messages as { role: "user" | "assistant"; content: string }[], TOOL_DEFS, SCHEMAS, run, emit, MAX_ROUNDS, spend);
    return { ...r, passages, actions };
  }

  let text = "";
  let cut = false, refused = false;
  // What the answer cost, measured from every call's usage, so the person is charged what it used.
  let units = 0, calls = 0, badJson = 0;
  // The instructions and tools are the same for every question and every round: cached once
  // (a breakpoint on the system prompt), and the conversation so far cached as it grows (the
  // request's automatic breakpoint on its last block), so each research round re-reads it cheaply.
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: `${SYSTEM}\n\n${RESEARCH}\n\n${APP}`, cache_control: { type: "ephemeral" } }];
  let lastInputUsd = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // The request's budget (what was held from the balance for it): past 70% of it the research stops and the
    // answer is written, in no more words than what is left pays for.
    const last = round === MAX_ROUNDS - 1 || spend.over(0.7);
    const room = spend.outputTokensLeft(model, lastInputUsd * 1.15);
    if (round === 0) emit({ status: "Studying the question" });
    let said = "";
    const stream = client.messages.stream({
      // The reader's chosen Claude model (shared/ask-models.mjs), with adaptive thinking and an
      // effort level only where the model takes them.
      model: model.native ?? model.id,
      max_tokens: Math.max(256, Math.min(12000, model.maxOutput ?? 12000, room)),
      ...(model.thinking ? { thinking: { type: "adaptive" as const } } : {}),
      ...(model.effort ? { output_config: { effort: "high" as const } } : {}),
      cache_control: { type: "ephemeral" },
      system,
      tools: TOOLS,
      ...(last ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    stream.on("text", (d) => { said += d; emit({ delta: d }); });
    let message: Anthropic.Message;
    try { message = await stream.finalMessage(); badJson = 0; }
    catch (e) {
      // A tool input that could not be parsed at all (eager streaming): the round is asked
      // again, twice at most. API errors (rate limits, overload, auth) are not retried here.
      if (e instanceof Anthropic.APIError || badJson++ >= 2) throw e;
      if (said) emit({ reset: true });
      round--;
      continue;
    }
    units += unitsFor(message.usage, model); calls++;
    spend.call(message.usage, model);
    lastInputUsd = spend.inputUsd(message.usage, model);
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // A refusal can cut a tool request off mid-input: no tool of that turn is run.
    if (message.stop_reason === "refusal") { text = said; refused = true; break; }
    // Anything but a request for a tool ends the turn. At the token cap the answer, or a tool
    // input, is unfinished: no tool is run on it, and the answer is marked as cut off.
    if (message.stop_reason !== "tool_use" || !uses.length || last) { text = said; cut = message.stop_reason === "max_tokens"; break; }
    // Words written before a search are not the answer; the answer starts again after it.
    if (said) emit({ reset: true });
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const why = checkInput(SCHEMAS.get(u.name), u.input);
      if (why) { results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ INVALID_INPUT: why, input: JSON.stringify(u.input ?? null).slice(0, 400) }), is_error: true }); continue; }
      const input = u.input as Record<string, unknown>;
      try { const r = await run(u.name, input); results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.error ? { is_error: true } : {}) }); }
      catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: `That failed: ${(e as Error).message?.slice(0, 120)}`, is_error: true }); }
    }
    messages.push({ role: "user", content: results });
    emit({ status: "Writing the answer" });
  }
  return { text, passages, units, calls, actions, cut, refused };
}
