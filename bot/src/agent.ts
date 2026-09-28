import Anthropic from "@anthropic-ai/sdk";

import { books, chapter } from "./data";
import type { Env, Exec } from "./env";
import { answerCandidates, RESEARCH, SYSTEM, type Passage, type Turn } from "./ai.mjs";
import { parseReference } from "./refs.mjs";
import { unitsOf } from "./billing.mjs";

/**
 * Ask CyberJudah with Claude doing its own research: it starts from the passages retrieval
 * found for the question, then searches the library again in its own words and reads the
 * verses it will quote, as many times as the question needs (up to a few rounds), before it
 * writes. Every passage and verse it saw is numbered once, across all its searches, so its
 * [n] citations map to one list of sources.
 */
export type Numbered = Passage & { n: number };
export type AgentEvent = { status: string } | { passages: Numbered[] } | { delta: string } | { reset: true };

const MAX_ROUNDS = 6;
const MAX_SOURCES = 48;
const CLAUDE_DEFAULT = "claude-opus-5";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_library",
    description: "Search CyberJudah's library: the Sabbath classes and other recordings (what was said, with the moment), the study notes, the law handbook, the precepts, the case studies and the encyclopedia. Returns the closest passages, numbered for citation. Use different words, names, feasts, books or doctrines to look from another side.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to look for, in a few words or a short question." } }, required: ["query"] },
  },
  {
    name: "read_scripture",
    description: "Read the exact King James text (the Apocrypha included) of a reference: a chapter (\"Sirach 43\"), a verse (\"Exodus 12:14\") or a range (\"Deuteronomy 16:1-8\"). Returns the verses, numbered for citation. Quote Scripture only from what this returns or from the passages.",
    input_schema: { type: "object", properties: { reference: { type: "string", description: "Book, chapter and optional verse or range." } }, required: ["reference"] },
  },
];

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
): Promise<{ text: string; passages: Numbered[]; units: number; calls: number }> {
  // ANTHROPIC_BASE_URL is for tests against a stand-in server; production leaves it unset.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
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
    return { content: `No tool named ${name}.`, error: true };
  };

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-6).map((m) => ({ role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user", content: String(m.content ?? "").slice(0, 3000) || "…" })),
    { role: "user", content: `${passages.length ? `Passages already found for this question:\n\n${passages.map(listed).join("\n\n")}` : "The first search found nothing close; search the library yourself."}\n\nQuestion: ${question}` },
  ];

  let text = "";
  // What the answer cost, measured from every call's usage, so the person is charged what it used.
  let units = 0, calls = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS - 1;
    if (round === 0) emit({ status: "Studying the question" });
    let said = "";
    const stream = client.messages.stream({
      model: env.CLAUDE_MODEL || CLAUDE_DEFAULT,
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: `${SYSTEM}\n\n${RESEARCH}`,
      tools: TOOLS,
      ...(last ? { tool_choice: { type: "none" as const } } : {}),
      messages,
    });
    stream.on("text", (d) => { said += d; emit({ delta: d }); });
    const message = await stream.finalMessage();
    units += unitsOf(message.usage); calls++;
    const uses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // Anything but a request for a tool ends the turn: the answer, a refusal, or the token cap.
    if (message.stop_reason !== "tool_use" || !uses.length) { text = said; break; }
    // Words written before a search are not the answer; the answer starts again after it.
    if (said) emit({ reset: true });
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = (u.input && typeof u.input === "object" ? u.input : {}) as Record<string, unknown>;
      try { const r = await run(u.name, input); results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.error ? { is_error: true } : {}) }); }
      catch (e) { results.push({ type: "tool_result", tool_use_id: u.id, content: `That failed: ${(e as Error).message?.slice(0, 120)}`, is_error: true }); }
    }
    messages.push({ role: "user", content: results });
    emit({ status: "Writing the answer" });
  }
  return { text, passages, units, calls };
}
