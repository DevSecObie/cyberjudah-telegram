import { resolveResourcePins } from "./resource-tools";
import type { ResourcePins } from "../../shared/resources";
import Anthropic from "@anthropic-ai/sdk";

import { books, chapter, dataJson } from "./data";
import { claude } from "./providers";
import type { Env, Exec } from "./env";
import { MORE_RUN, MORE_TOOLS } from "./ask-tools";
import { answerCandidates, APP, promptHistory, RESEARCH, SYSTEM, retrievalText, notInTheClasses, type Passage, type Turn } from "./ai.mjs";
import { checkInput, describeReminder, findCases, findChats, findFeatures, findPeople, proposeReminder } from "./assistant.mjs";
import { FEATURES } from "../../shared/app-features.mjs";
import { listChats, type SavedAction } from "./chats";
import { loadReminder, tgRid } from "./remind";
import { publicView } from "./reminders.mjs";
import { parseReference } from "./refs.mjs";
import { modelOf, unitsFor, type AskModel } from "../../shared/ask-models.mjs";
import { researchOpen } from "./agent-open";
import { freeSpend, type Spend } from "./spend";
import { DEEP_TOOLS, readForAsk } from "./ask-readers";
import { claudeThinking } from "./model-capacity.mjs";
import { MAX_RESEARCH_ROUNDS, MAX_CLAUDE_OUTPUT, MAX_RESEARCH_MS, MAX_RESEARCH_SOURCES, WRITING_RESERVE_MS, writingDue, withinPhase, researchRounds, researchSignal, type ResearchControl } from "./research-policy.mjs";
import { classAttributor } from "./class-attribution";
import { groundedSystem, libraryData, untrustedData, assessCoverage, hasControlText } from "./grounding.mjs";

/**
 * Ask CyberJudah with Claude doing its own research: it starts from the passages retrieval
 * found for the question, then searches the library again in its own words and reads the
 * verses it will quote, as many times as the question needs (up to a few rounds), before it
 * writes. Every passage and verse it saw is numbered once, across all its searches, so its
 * [n] citations map to one list of sources.
 */
export type Numbered = Passage & { n: number };
export type AgentEvent = { status: string } | { passages: Numbered[] } | { passages_delta: Numbered[] } | { delta: string } | { reset: true } | { action: SavedAction };

const CLAUDE_DEFAULT = "claude-sonnet-5-5";

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
    description: "Read the exact King James text (the Apocrypha included) of a reference: a chapter (\"Sirach 43\"), a verse (\"Exodus 12:14\") or a range (\"Deuteronomy 16:1-8\"). Returns the verses, numbered for citation. A chapter comes 40 verses at a time with its verse count and what to read next; a longer chapter is read in full only when every part has been read. Call it for every verse you will quote that is not already in the passages: quote Scripture only from what this returns or from the passages.",
    input_schema: { type: "object", properties: { reference: { type: "string", description: "Book, chapter and optional verse or range." } }, required: ["reference"] },
  },
  ...MORE_TOOLS,
  ...DEEP_TOOLS,
];

/**
 * The answer is streamed, so each tool's input streams as it is written (eager input
 * streaming, as the Claude docs advise for streamed requests with client tools). The API
 * then no longer checks the input, so every input is checked here before a tool runs.
 */
const TOOLS: Anthropic.Tool[] = TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true }));
const SCHEMAS = new Map(TOOL_DEFS.map((t) => [t.name, t.input_schema]));

// A Scripture reading is keyed by what it read ("Psalms 119:41-80"; retrieval adds " (KJV)"): every
// part of a chapter links to the same chapter page, and each part must stay its own source.
const keyOf = (p: Passage) => (p.video ? `v|${p.video}|${Math.round((p.t ?? 0) / 90)}` : p.kind === "verse" ? `verse|${p.title.replace(/ \(KJV\)$/, "")}` : `${p.kind}|${p.url}|${p.sub ?? ""}`);
const sourceLabel = (p: Numbered) => `[${p.n}] ${p.title}${p.sub ? ` · ${p.sub}` : ""}${p.date ? ` (${p.date})` : ""}${p.teacher ? ` (taught by ${p.teacher})` : ""}`;
const listed = (p: Numbered) => `${sourceLabel(p)}\n${p.text}`;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Verses one read_scripture call returns for a chapter without a range. */
export const CHAPTER_READ_VERSES = 40;

export async function runAgent(
  env: Env,
  question: string,
  history: Turn[],
  first: Passage[],
  retrieve: (text: string, k: number, signal?: AbortSignal) => Promise<Passage[]>,
  emit: (e: AgentEvent) => void,
  ctx?: Exec,
  userId?: number,
  model: AskModel = modelOf(env.CLAUDE_MODEL || CLAUDE_DEFAULT),
  spend: Spend = freeSpend(),
  requestedResources?: ResourcePins,
  maxRounds = MAX_RESEARCH_ROUNDS,
  citeAppSources = false,
  control: ResearchControl = {},
): Promise<{ text: string; passages: Numbered[]; units: number; calls: number; actions: SavedAction[]; cut: boolean; refused: boolean; grounded: boolean }> {
  maxRounds = researchRounds(maxRounds);
  const deadlineAt = control.deadlineAt ?? Date.now() + MAX_RESEARCH_MS;
  const signal = researchSignal(control.signal, deadlineAt);
  const toolSignal = researchSignal(signal, deadlineAt - WRITING_RESERVE_MS);
  signal.throwIfAborted();
  // Directly, through the AI Gateway, or to the tests' stand-in (providers.ts).
  const resourcePins = await withinPhase(() => resolveResourcePins(env, requestedResources), signal);
  const client = await withinPhase(() => claude(env), signal);
  const attribute = await withinPhase(() => classAttributor(env), signal);
  const passages: Numbered[] = [];
  const seen = new Map<string, number>();
  const dirty = new Set<number>(), sent = new Map<number, string>();
  const publishPassages = (initial = false) => {
    const changed: Numbered[] = [];
    for (const n of dirty) {
      // The model retains full readings; phones need only a source preview while researching.
      const preview = { ...passages[n - 1], text: passages[n - 1].text.slice(0, 1000) };
      const packet = JSON.stringify(preview);
      if (sent.get(n) !== packet) { changed.push(preview); sent.set(n, packet); }
    }
    dirty.clear();
    if (changed.length) emit(initial ? { passages: changed } : { passages_delta: changed });
  };
  const add = (source: Passage, initial = false): { n: number; fresh: boolean } | null => {
    if (!initial && toolSignal.aborted) return null;
    const p = attribute(source);
    const k = keyOf(p);
    if (seen.has(k)) return { n: seen.get(k)!, fresh: false };
    if (passages.length >= MAX_RESEARCH_SOURCES) return null;
    const n = passages.length + 1;
    passages.push({ ...p, n }); seen.set(k, n); dirty.add(n);
    return { n, fresh: true };
  };
  for (const p of first) add(p, true);
  const actions: SavedAction[] = [];
  const line = (name: string, what: string, path: string) => {
    const kind = /^\/person\/[a-z0-9-]+$/.test(path) ? 'people' : /^\/timeline\/event\/[a-z0-9-]+$/.test(path) ? 'timeline' : undefined;
    // Telegram picture cards refer to the exact tool text already supplied, without new claims.
    const source = citeAppSources && kind ? add({ kind, title: name, text: what, url: path }) : null;
    return `${source ? `[${source.n}] ` : ''}${name}: ${what} Link: ${path}`;
  };
  publishPassages(true);

  const run = async (name: string, input: Record<string, unknown>): Promise<{ content: string; error?: boolean }> => {
    if (name === "search_library") {
      const query = str(input.query, 200);
      if (query.length < 2) return { content: "Give a query of a few words.", error: true };
      emit({ status: `Searching the teachings for “${query}”` });
      const found = answerCandidates(query, await retrieve(query, 10, toolSignal), 6);
      const lines: string[] = [];
      for (const p of found) { const a = add(p); if (a) lines.push(a.fresh ? listed(passages[a.n - 1]) : `[${a.n}] ${p.title} (already given above)`); }
      publishPassages();
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
      // A whole chapter is read CHAPTER_READ_VERSES at a time. Each reading says how many verses
      // the chapter has and which to read next, so a chapter is never taken as read when it is not.
      // Bounds come from the chapter's own first and last verse numbers.
      const first = c.verses[0]?.verse ?? 1, last = c.verses.at(-1)?.verse ?? 0, chapterName = `${ref.book} ${ref.chapter}`;
      const from = ref.verse ?? first, to = Math.min(ref.verseEnd ?? ref.verse ?? from + CHAPTER_READ_VERSES - 1, last);
      const verses = c.verses.filter((v) => v.verse >= from && v.verse <= to);
      if (!verses.length) return { content: `${ref.label} has no such verses. ${chapterName} ends at verse ${last}.`, error: true };
      const whole = from <= first && to === last;
      const label = whole ? chapterName : `${chapterName}:${from}${to > from ? `-${to}` : ""}`;
      const text = verses.map((v) => `${v.verse} ${v.text}`).join("\n");
      const next = `"${chapterName}:${to + 1}-${Math.min(to + CHAPTER_READ_VERSES, last)}"`;
      const note = whole ? (ref.verse ? "" : `All of ${chapterName}, verses ${first}-${last}.`)
        : !ref.verse ? `Verses ${from}-${to} of ${chapterName}, which ends at verse ${last}. The chapter is not finished: read ${next} next, and do not present ${chapterName} as read in full until every verse has been read.`
        : !ref.verseEnd ? ""
        : to === last ? `${chapterName} ends at verse ${last}.`
        : `${chapterName} ends at verse ${last}; to read on, read ${next}.`;
      const a = add({ kind: "verse", title: label, url: `/bible/${ref.slug}/${ref.chapter}`, sub: "", text });
      publishPassages();
      return { content: `${a ? `[${a.n}] ` : ""}${label} (KJV)\n${text}${note ? `\n\n(${note})` : ""}` };
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
    if (DEEP_TOOLS.some(tool => tool.name === name)) {
      emit({ status: name === "search_classes" ? `Searching classes for “${str(input.query, 200)}”` : `Reading ${str(input.path ?? input.reference ?? input.video, 200)}` });
      const reading = await readForAsk(name, input, env, ctx);
      if (toolSignal.aborted) return { content: "Research time is reserved for writing the final answer from the registered sources.", error: true };
      if (!reading) return { content: "That reading tool is unavailable.", error: true };
      const labels: string[] = [];
      for (const source of reading.sources ?? []) {
        const added = add(source);
        if (!added) continue;
        // A full reading can extend an already cited search snippet without renumbering it.
        if (!added.fresh && source.text.length > passages[added.n - 1].text.length) { passages[added.n - 1] = { ...passages[added.n - 1], ...attribute(source), n: added.n }; dirty.add(added.n); }
        labels.push(sourceLabel(passages[added.n - 1]));
      }
      publishPassages();
      return { content: `${labels.length ? `Sources for this reading: ${labels.join("; ")}\n\n` : ""}${reading.content.map(block => block.text).join("\n")}`, ...(reading.isError ? { error: true } : {}) };
    }
    const more = MORE_RUN[name];
    if (more) {
      const r = await more(env, input, ctx, emit, line, add, resourcePins);
      publishPassages();
      return r;
    }
    return { content: `No tool named ${name}.`, error: true };
  };

  let coverageVersion = 0;
  let checkedVersion = -1;
  let coverage: ReturnType<typeof assessCoverage>;
  const appTools = new Set(["app_help", "find_in_app", "my_saved_chats", "my_reminder", "propose_reminder_change"]);
  const toolEvidence: { kind: string; title: string; text: string }[] = [];
  const runWithEvidence = async (name: string, input: Record<string, unknown>) => {
    signal.throwIfAborted();
    if (writingDue(deadlineAt)) return { content: "Research time is reserved for writing the final answer from the registered sources.", error: true, source_registry: [] };
    const before = passages.length;
    try {
      let result;
      try { result = await withinPhase(() => run(name, input), toolSignal); }
      catch (error) {
        signal.throwIfAborted();
        if (!toolSignal.aborted) throw error;
        return { content: "Research time is reserved for writing the final answer from the registered sources.", error: true, source_registry: [] };
      }
      if (!result.error && appTools.has(name)) toolEvidence.push({ kind: "tool", title: name, text: result.content });
      return { ...result, source_registry: passages.slice(before).map(source => ({ source_n: source.n, title: source.title, url: source.url })) };
    } finally { coverageVersion++; }
  };
  const evidence = () => {
    if (checkedVersion !== coverageVersion) {
      coverage = assessCoverage(env, retrievalText(question, history), [...passages, ...toolEvidence]);
      checkedVersion = coverageVersion;
    }
    return coverage;
  };
  const modelEmit = (event: AgentEvent) => {
    if (signal.aborted) return;
    // A thin-evidence answer must not flash ungrounded prose before the final gap result.
    if ('delta' in event && evidence().blocked) return;
    emit(event);
  };
  const finish = (result: { text: string; units: number; calls: number; cut: boolean; refused: boolean }) => {
    if (!result.refused && evidence().blocked) {
      const gap = notInTheClasses(passages.filter(source => !hasControlText(`${source.title}\n${source.text}`)));
      emit({ reset: true }); emit({ delta: gap.answer });
      return { ...result, text: gap.answer, passages: gap.sources, actions, cut: false, grounded: false };
    }
    return { ...result, passages, actions, grounded: true };
  };
  const timedOut = () => {
    const excerpts = passages.filter(source => !hasControlText(`${source.title}\n${source.text}`)).slice(0, 3).map(source => `**${source.title.replace(/[*_\[\]]/g, '')}** [${source.n}]\n\n> ${source.text.slice(0, 1000).replace(/\n/g, '\n> ')}`);
    return excerpts.length ? `Research reached its time limit. Here are the recorded excerpts I found:\n\n${excerpts.join('\n\n')}` : notInTheClasses([]).answer;
  };
  const messages: Anthropic.MessageParam[] = [
    ...promptHistory(history).map((m) => ({ role: m.role as "assistant" | "user", content: m.content })),
    { role: "user", content: `${passages.length ? `Passages already found for this question:\n\n${libraryData(passages)}` : "The first search found nothing close; search the library yourself."}\n\nQuestion: ${question}` },
  ];

  // Every other model researches through Cloudflare, with the same tools and the same sources
  // (agent-open.ts); only Claude streams through the Messages API below.
  if (model.format !== "anthropic") {
    try {
      const r = await researchOpen(env, model, groundedSystem(`${SYSTEM}\n\n${RESEARCH}\n\n${APP}`), messages as { role: "user" | "assistant"; content: string }[], TOOL_DEFS, SCHEMAS, runWithEvidence, modelEmit, maxRounds, spend, false, undefined, { signal, deadlineAt });
      return finish(r);
    } catch (error) {
      if (!signal.aborted || signal.reason?.name !== 'TimeoutError') throw error;
      const text = timedOut();
      emit({ reset: true }); emit({ delta: text });
      return finish({ text, units: 0, calls: spend.calls, cut: true, refused: false });
    }
  }

  let text = "";
  let cut = false, refused = false;
  // What the answer cost, measured from every call's usage, so the person is charged what it used.
  let units = 0, calls = 0, badJson = 0;
  // The instructions and tools are the same for every question and every round: cached once
  // (a breakpoint on the system prompt), and the conversation so far cached as it grows (the
  // request's automatic breakpoint on its last block), so each research round re-reads it cheaply.
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: groundedSystem(`${SYSTEM}\n\n${RESEARCH}\n\n${APP}`), cache_control: { type: "ephemeral" } }];
  // A budgeted request sets aside each call's own input before choosing how much it may write, as
  // a strict upper bound on its tokens, priced as a prompt-cache write (the dearest way Claude bills
  // input): the first call's tokens are counted by the API; each later call's are the last call's
  // measured input plus the bytes added since (a token is never shorter than a byte), plus framing.
  const bytesOf = () => new TextEncoder().encode(JSON.stringify({ system, tools: TOOLS, messages })).length;
  let knownTokens = 0, bytesAtKnown = 0, bytesThisCall = 0;
  let attempts = 0;
  for (let round = 0; round < maxRounds && attempts < maxRounds; round++) {
    if (signal.aborted && signal.reason?.name === 'TimeoutError') { text = timedOut(); cut = true; break; }
    signal.throwIfAborted();
    // Without usage, another round cannot be proven to fit the money already reserved.
    if (spend.budgetUsd != null && spend.unreported) { cut = true; break; }
    // The request's budget (what was held from the balance for it): past 70% of it the research stops and the
    // answer is written, in no more words than what is left pays for.
    let inputUsd = 0;
    if (spend.budgetUsd != null) {
      const bytes = bytesOf();
      let tokens: number;
      if (round === 0) {
        try { tokens = (await client.messages.countTokens({ model: model.native ?? model.id, system, tools: TOOLS, messages }, { signal })).input_tokens + 64; }
        catch { signal.throwIfAborted(); tokens = bytes + 1024; }
      } else tokens = knownTokens + Math.max(0, bytes - bytesAtKnown) + 256;
      bytesThisCall = bytes;
      inputUsd = spend.inputUsd({ input_tokens: 0, cache_creation_input_tokens: tokens }, model);
    }
    const room = spend.outputTokensLeft(model, inputUsd);
    // Too little left for a reply the API accepts: the request stops here, inside what was set aside.
    if (room < 256) { cut = true; break; }
    // Close to the end of the budget the research stops and the answer is written.
    const last = round === maxRounds - 1 || spend.over(0.7) || room < 1024 || writingDue(deadlineAt);
    if (round === 0) emit({ status: "Studying the question" });
    let said = "";
    attempts++;
    const stream = client.messages.stream({
      // The reader's chosen Claude model (shared/ask-models.mjs), with adaptive thinking and an
      // effort level only where the model takes them.
      model: model.native ?? model.id,
      max_tokens: Math.min(MAX_CLAUDE_OUTPUT, model.maxOutput ?? MAX_CLAUDE_OUTPUT, room),
      ...claudeThinking(model),
      cache_control: { type: "ephemeral" },
      system,
      tools: TOOLS,
      ...(last ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    }, { signal });
    stream.on("text", (d) => { said += d; modelEmit({ delta: d }); });
    let message: Anthropic.Message;
    try { message = await stream.finalMessage(); badJson = 0; }
    catch (e) {
      if (signal.aborted) {
        // Snapshot counters are provider-reported lower bounds. Never invent tokens after abort.
        const usage = stream.currentMessage?.usage;
        if (usage) { units += unitsFor(usage, model); calls++; spend.call(usage, model); }
        spend.unreported = true;
        if (signal.reason?.name === 'TimeoutError') { text = last && said.trim() ? said : timedOut(); emit({ reset: true }); emit({ delta: text }); cut = true; break; }
      }
      signal.throwIfAborted();
      // A tool input that could not be parsed at all (eager streaming): the round is asked
      // again, twice at most. API errors (rate limits, overload, auth) are not retried here.
      if (e instanceof Anthropic.APIError || badJson++ >= 2) throw e;
      if (said) emit({ reset: true });
      round--;
      continue;
    }
    units += unitsFor(message.usage, model); calls++;
    spend.call(message.usage, model);
    { const u = (message.usage ?? {}) as unknown as Record<string, number | null | undefined>; knownTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0); bytesAtKnown = bytesThisCall; }
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
      if (why) { results.push({ type: "tool_result", tool_use_id: u.id, content: untrustedData({ INVALID_INPUT: why, input: JSON.stringify(u.input ?? null).slice(0, 400) }, "tool_output"), is_error: true }); continue; }
      const input = u.input as Record<string, unknown>;
      try { const r = await runWithEvidence(u.name, input); results.push({ type: "tool_result", tool_use_id: u.id, content: untrustedData(r, "tool_output"), ...(r.error ? { is_error: true } : {}) }); }
      catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: untrustedData({ error: (e as Error).message?.slice(0, 120) }, "tool_output"), is_error: true }); }
    }
    messages.push({ role: "user", content: results });
    emit({ status: "Writing the answer" });
  }
  return finish({ text, units, calls, cut, refused });
}
