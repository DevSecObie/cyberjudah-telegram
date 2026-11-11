import type Anthropic from "@anthropic-ai/sdk";
import { coverageDecision, hasControlText, topicOverlap } from "./grounding.mjs";

/**
 * Deep Study step 1: a research plan and a coverage checklist. Before researching a question with
 * several parts, the model lists them (plan_research); after every reading the server works out,
 * part by part, what has been found and what is still missing, and tells the model. Research ends
 * because every part is covered, or because a limit was reached, and the answer says which.
 *
 * A part's `ask` restates part of the reader's own question; the Mini App shows it only as the
 * reader's part with an app-owned status, never as teaching. So an ask carries no quotation and no
 * Scripture reference the question did not name, and is at most PLAN_ASK_CHARS long.
 */
export const PLAN_MAX_PARTS = 8;
export const PLAN_ASK_CHARS = 200;
/** Sources listed per part, and failures listed per answer: bounds the Mini App mirrors. */
export const PART_MAX_SOURCES = 20;
/** A part's id: "p1" to "p8", unique within its plan (at most 16 characters, the Mini App's bound). */
export const partId = (index: number) => `p${index + 1}`;

export type PartStatus = "covered" | "partial" | "missing";
/** Why research ended: every part covered, or a limit (rounds, deadline, budget), or the model wrote the answer with parts still not found. */
export type StopReason = "covered" | "rounds" | "deadline" | "budget" | "not_found";
export type PlanPart = { id: string; ask: string; refs: Ref[] };
export type Coverage = { parts: { id: string; status: PartStatus; sources: number[] }[]; complete: boolean; stopped: StopReason;
  /** The research's own coverage only (agent.ts), not yet checked against an answer: the limit that ended it,
   *  if one did, so the checked coverage names it when the answer leaves a part open (studyFields). Never sent. */
  limit?: StopReason };
type Ref = { slug: string; chapter: number; from?: number; to?: number; label: string };
type Source = { n: number; kind: string; title: string; text: string };
type Books = Parameters<typeof import("./refs.mjs").parseReference>[1];

export const PLAN_TOOL: Anthropic.Tool = {
  name: "plan_research",
  description: "For a question with more than one part, call this first: list each part the reader asked, in their own words (no quotations, no teaching, no Scripture they did not name), and the Scripture each part needs read. If a part is refused, you are told why and may list the parts again. After every reading you are told which parts are covered and which are still missing; keep researching until every part is covered or you have found the library has nothing for it, and then say which parts were not found.",
  input_schema: {
    type: "object",
    properties: {
      parts: {
        type: "array", maxItems: PLAN_MAX_PARTS,
        items: {
          type: "object",
          properties: {
            ask: { type: "string", description: "One part of the reader's question, restated briefly in their words." },
            refs: { type: "array", items: { type: "string" }, maxItems: 6, description: "Scripture this part needs read in full, like \"Exodus 12\" or \"Leviticus 23:1-8\"." },
          },
          required: ["ask"],
        },
      },
    },
    required: ["parts"],
  },
};

// Scripture named in text: "Exodus 20", "1 John 4:1-3", "II Kings 2:11", "Song of Solomon 2". The
// matches are checked against the Bible's books before they count, so "the 10 commandments" is not one.
const REFERENCE = /\b(?:(?:[1-3]|I{1,3})\s*)?[A-Za-z]+(?: of [A-Za-z]+)*\.?\s+\d{1,3}(?:\s*:\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?/g;
const QUOTE = /["“”„«»>]|^\s*['‘’]|['‘’]\s*$/;
type Parse = (q: string, b: Books) => { slug: string; chapter: number; verse?: number; verseEnd?: number; label: string } | null;
const toRef = (p: NonNullable<ReturnType<Parse>>): Ref => ({ slug: p.slug, chapter: p.chapter, from: p.verse, to: p.verseEnd ?? p.verse, label: p.label });
const key = (r: Ref) => `${r.slug}|${r.chapter}|${r.from ?? ""}|${r.to ?? ""}`;

/**
 * The references a text names, as written. A match like "does 1" before "John 4" is the number of a
 * numbered book, so the search starts again at that number ("1 John 4"). "John 3.16" is not read
 * as all of John 3: a chapter followed by ".16" is left out rather than tracked as the whole chapter.
 */
function references(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(REFERENCE.source, "g");
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length, rest = text.slice(end);
    if (/\s[1-3]$/.test(m[0]) && /^\s+(?:of\s+)?[A-Za-z]+\.?\s+\d/.test(rest)) { re.lastIndex = end - 1; continue; }
    if (/^\.\d/.test(rest)) continue;
    out.push(m[0].replace(/\s+/g, " ").trim());
  }
  return out;
}
const chapterOf = (r: Ref) => `${r.slug}|${r.chapter}`;

// (Not before "the", "a" and the like, which name no book; not "the rest of", part of "Rest of Esther".)
const HOW_MUCH = /\b(?:all|the\s+whole|the\s+end|the\s+beginning|the\s+start|the\s+middle|part|most|each|every\s+verse)\s+of\s+(?!(?:the|a|an|his|her|its|their|our|my|your|this|that|these|those)\b)(?=[A-Za-z0-9])/gi;

/** The Scripture a text names, as references this Bible has (at most `max`). */
export function namedRefs(text: string, books: Books | null, parseReference: Parse, max = 6): Ref[] {
  if (!books) return [];
  const out: Ref[] = [];
  // "All of Psalms 119" names Psalms 119: words that say how much of a passage are dropped first, since
  // the pattern (which allows "Song of Solomon") would otherwise read "All of Psalms" as one name.
  // (Replaced by a comma, so the words on either side never join: "Psalm 2 all of John 1".)
  for (const m of references(text.replace(HOW_MUCH, ", "))) {
    const p = parseReference(m, books);
    if (p && !out.some((r) => key(r) === key(toRef(p)))) out.push(toRef(p));
    if (out.length === max) break;
  }
  return out;
}

/**
 * The parts the model listed, or why they were refused. A plan is taken whole or not at all, so a
 * part of the reader's question is never dropped without the model knowing: each part must be a
 * short restatement with no quotation and no Scripture the reader did not name.
 */
export function planFrom(question: string, input: unknown, books: Books | null, parseReference: Parse): { parts: PlanPart[] } | { refused: string[] } {
  const raw = (input as { parts?: unknown })?.parts;
  if (!Array.isArray(raw) || !raw.length) return { refused: ["no parts were listed"] };
  if (raw.length > PLAN_MAX_PARTS) return { refused: [`at most ${PLAN_MAX_PARTS} parts`] };
  // A part may name a chapter the reader named, in any form ("Exodus 12" for "Exodus 12:1-8").
  const readerRefs = namedRefs(question, books, parseReference, 50);
  const named = new Set(readerRefs.map(chapterOf));
  const parts: PlanPart[] = [], refused: string[] = [];
  raw.forEach((p, i) => {
    const ask = typeof (p as { ask?: unknown })?.ask === "string" ? (p as { ask: string }).ask.replace(/\s+/g, " ").trim() : "";
    const own = ask && ask.length <= PLAN_ASK_CHARS ? namedRefs(ask, books, parseReference, 50) : [];
    const why = !ask ? "it is empty" : ask.length > PLAN_ASK_CHARS ? `it is longer than ${PLAN_ASK_CHARS} characters` : QUOTE.test(ask) || hasControlText(ask) ? "it has a quotation"
      // A reference the reader did not name would be the model's teaching, not the reader's part.
      : (books ? own.some((r) => !named.has(chapterOf(r))) : references(ask).length > 0) ? "it names Scripture the reader did not name" : "";
    if (why) { refused.push(`part ${i + 1}: ${why}`); return; }
    // What must be read for a part is never left to the model: the Scripture its own ask names, and
    // the reader's ranges that meet it (so the widest range the reader gave). The model's own refs
    // may only add to that.
    const refs: Ref[] = [];
    const push = (r: Ref) => { if (!refs.some((x) => key(x) === key(r))) refs.push(r); };
    // (A part that reads a whole chapter already reads every range in it.)
    const meets = (wide: Ref, r: Ref) => chapterOf(wide) === chapterOf(r) && r.from != null && (wide.from == null || (wide.from <= (r.to ?? r.from) && (wide.to ?? wide.from) >= r.from));
    for (const r of own) { push(r); for (const w of readerRefs) if (meets(w, r)) push(w); }
    for (const r of Array.isArray((p as { refs?: unknown }).refs) ? (p as { refs: unknown[] }).refs.slice(0, 6) : []) {
      const ref = typeof r === "string" && books ? parseReference(r.slice(0, 80), books) : null;
      if (ref) push(toRef(ref));
    }
    parts.push({ id: partId(i), ask, refs });
  });
  return refused.length ? { refused } : { parts };
}

/** What of each chapter has been read: verse ranges, and the chapter's first and last verse once known. */
export class Readings {
  private read = new Map<string, { ranges: [number, number][]; first?: number; last?: number }>();
  /** A reading of verses `from`-`to`; `first`/`last` when the whole chapter was in hand (read_scripture). */
  record(slug: string, chapter: number, from: number, to: number, first?: number, last?: number) {
    const k = `${slug}|${chapter}`;
    const r = this.read.get(k) ?? { ranges: [] };
    r.ranges.push([from, to]);
    if (first != null) r.first = first;
    if (last != null) r.last = last;
    this.read.set(k, r);
  }
  /** Whether every verse of the reference has been read (a whole chapter only once its bounds are known). */
  covers(ref: Ref): boolean {
    const r = this.read.get(`${ref.slug}|${ref.chapter}`);
    if (!r) return false;
    const from = ref.from ?? r.first, end = ref.to ?? r.last;
    if (from == null || end == null) return false;
    // A range that starts past the chapter's end was never read, however much of the chapter was.
    if (r.last != null && from > r.last) return false;
    const to = r.last != null ? Math.min(end, r.last) : end;
    let next = from;
    for (const [a, b] of [...r.ranges].sort((x, y) => x[0] - y[0])) if (a <= next && b >= next) next = b + 1;
    return next > to;
  }
  touched(ref: Ref): boolean { return this.read.has(`${ref.slug}|${ref.chapter}`); }
}

const usable = (s: Source) => s.kind !== "tool" && !!s.text?.trim() && !hasControlText(`${s.title}\n${s.text}`);

/**
 * Each part's status from the passages read so far. `memo` keeps each part-and-source decision
 * across rounds (a source's text only grows when a longer reading replaces it).
 */
export function checklist(parts: PlanPart[], sources: Source[], readings: Readings, memo: Map<string, boolean> = new Map()): Coverage["parts"] {
  const list = sources.filter(usable);
  return parts.map((part) => {
    const found = list.filter((s) => {
      // Keyed by the part's words, so a plan that replaces the parts never reuses an old decision.
      const k = `${part.ask}|${s.n}|${s.text.length}`;
      // Judged on the words alone: a source's retrieval score belongs to the search that found it,
      // not to this part, so one close match never marks every part covered.
      if (!memo.has(k)) memo.set(k, coverageDecision(part.ask, [{ kind: s.kind, title: s.title, text: s.text }]).enough);
      return memo.get(k);
    }).map((s) => s.n);
    const evidence = found.length > 0;
    const refsRead = part.refs.every((r) => readings.covers(r));
    const someRead = part.refs.some((r) => readings.touched(r));
    const status: PartStatus = evidence && refsRead ? "covered" : evidence || someRead ? "partial" : "missing";
    return { id: part.id, status, sources: found };
  });
}

/** Conservative answer check, not a semantic judge: reading evidence alone is not answering a part. */
export function verifyAnswer(parts: PlanPart[], state: Coverage["parts"], answer: string): Coverage["parts"] {
  const blocks = answer.split(/\n\s*\n/);
  return state.map(p => {
    if (p.status !== "covered") return p;
    const part = parts.find(part => part.id === p.id)!;
    const answered = blocks.some(text => {
      const cited = [...text.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)].flatMap(m => m[1].split(/\s*,\s*/).map(Number));
      return cited.some(n => p.sources.includes(n)) && topicOverlap(part.ask, text) >= 0.25;
    });
    return answered ? p : { ...p, status: "partial" };
  });
}

/** The checklist as the model reads it after each tool result. */
export function checklistNote(parts: PlanPart[], state: Coverage["parts"], readings: Readings): string {
  const open = state.filter((p) => p.status !== "covered");
  if (!open.length) return "Checklist: every part of the question is covered. Write the answer from the sources.";
  return `Checklist: ${state.length - open.length} of ${state.length} parts covered. Still open:\n${open.map((p) => {
    const part = parts.find((x) => x.id === p.id)!;
    const unread = part.refs.filter((r) => !readings.covers(r)).map((r) => r.label);
    return `- Part ${parts.indexOf(part) + 1} (${p.status}): ${part.ask}${unread.length ? `; not yet read in full: ${unread.join(", ")}` : ""}`;
  }).join("\n")}\nResearch these, or, if the library has nothing for one, say so in the answer. Never fill a gap with teaching that was not found.`;
}

/** Every part missing, for an answer replaced by "not in the classes". */
export const nothingCovered = (plan: PlanPart[]): Coverage => ({ parts: plan.map((p) => ({ id: p.id, status: "missing", sources: [] })), complete: false, stopped: "not_found" });

/**
 * What a finished answer carries about its research (only when it was tracked): the reader's parts,
 * each part's status and the cited sources behind it (at most PART_MAX_SOURCES, only numbers the
 * answer's own sources carry), why research ended, and, when a part is not covered, `partial` with
 * the unfinished parts. Optional and additive; within the Mini App's bounds.
 */
export type StudyFields = { plan?: { parts: Pick<PlanPart, "id" | "ask">[] }; coverage?: Coverage; partial?: true; unfinished?: Pick<PlanPart, "id" | "ask">[] };

export function studyFields(tracked: boolean, plan: PlanPart[], coverage: Coverage, cited?: Iterable<number>, answer?: string): StudyFields {
  if (!tracked) return {};
  const keep = cited ? new Set(cited) : null;
  const checked = answer === undefined ? coverage.parts : verifyAnswer(plan, coverage.parts, answer);
  const parts = checked.map((p) => {
    const sources = (keep ? p.sources.filter((n) => keep.has(n)) : p.sources).slice(0, PART_MAX_SOURCES);
    return { ...p, sources, status: p.status === "covered" && !sources.length ? "partial" as const : p.status };
  });
  const open = parts.filter((p) => p.status !== "covered").map((p) => ({ id: p.id, ask: plan.find((x) => x.id === p.id)!.ask }));
  // Every part covered is complete, whatever stopped the research: an answer a limit cut short says so with
  // `cut` and its stop reason, never as partial with no unfinished part (and is never kept: answer-cache.ts).
  const complete = coverage.complete && !open.length;
  return {
    plan: { parts: plan.map(({ id, ask }) => ({ id, ask })) },
    coverage: { parts, complete, stopped: !complete && coverage.stopped === "covered" ? coverage.limit ?? "not_found" : coverage.stopped },
    ...(complete ? {} : { partial: true, unfinished: open }),
  };
}
