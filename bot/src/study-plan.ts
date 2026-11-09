import type Anthropic from "@anthropic-ai/sdk";
import { coverageDecision, hasControlText } from "./grounding.mjs";

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
export type Coverage = { parts: { id: string; status: PartStatus; sources: number[] }[]; complete: boolean; stopped: StopReason };
type Ref = { slug: string; chapter: number; from?: number; to?: number; label: string };
type Source = { n: number; kind: string; title: string; text: string };
type Books = Parameters<typeof import("./refs.mjs").parseReference>[1];

export const PLAN_TOOL: Anthropic.Tool = {
  name: "plan_research",
  description: "For a question with more than one part, call this first, once: list each part the reader asked, in their own words (no quotations, no teaching, no Scripture they did not name), and the Scripture each part needs read. After every reading you are told which parts are covered and which are still missing; keep researching until every part is covered or you have found the library has nothing for it, and then say which parts were not found.",
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

const REFERENCE = /\b(?:[1-3]\s*)?[A-Za-z]+\.?\s+\d+(?::\d+(?:\s*[-–]\s*\d+)?)?/g;
const QUOTE = /["“”„«»>]|^\s*['‘’]|['‘’]\s*$/;

/** The parts the model listed, kept only when each is a short restatement of the reader's question. */
export function planFrom(question: string, input: unknown, books: Books | null, parseReference: (q: string, b: Books) => { slug: string; chapter: number; verse?: number; verseEnd?: number; label: string } | null): PlanPart[] | null {
  const raw = (input as { parts?: unknown })?.parts;
  if (!Array.isArray(raw)) return null;
  const named = new Set((question.match(REFERENCE) ?? []).map((r) => r.replace(/\s+/g, " ").toLowerCase()));
  const parts: PlanPart[] = [];
  for (const p of raw.slice(0, PLAN_MAX_PARTS)) {
    const ask = typeof (p as { ask?: unknown })?.ask === "string" ? (p as { ask: string }).ask.replace(/\s+/g, " ").trim() : "";
    if (!ask || ask.length > PLAN_ASK_CHARS || QUOTE.test(ask) || hasControlText(ask)) continue;
    // A reference the reader did not name would be the model's teaching, not the reader's part.
    // Only real Bible references count ("the 10 commandments" is not one).
    if ((ask.match(REFERENCE) ?? []).some((r) => !named.has(r.replace(/\s+/g, " ").toLowerCase()) && (!books || !!parseReference(r, books)))) continue;
    const refs: Ref[] = [];
    for (const r of Array.isArray((p as { refs?: unknown }).refs) ? (p as { refs: unknown[] }).refs.slice(0, 6) : []) {
      const ref = typeof r === "string" && books ? parseReference(r.slice(0, 80), books) : null;
      if (ref) refs.push({ slug: ref.slug, chapter: ref.chapter, from: ref.verse, to: ref.verseEnd ?? ref.verse, label: ref.label });
    }
    parts.push({ id: partId(parts.length), ask, refs });
  }
  return parts.length ? parts : null;
}

/** What of each chapter has been read: verse ranges, and the chapter's last verse once known. */
export class Readings {
  private read = new Map<string, { ranges: [number, number][]; first: number; last: number }>();
  record(slug: string, chapter: number, from: number, to: number, first: number, last: number) {
    const k = `${slug}|${chapter}`;
    const r = this.read.get(k) ?? { ranges: [], first, last };
    r.ranges.push([from, to]);
    this.read.set(k, r);
  }
  /** Whether every verse of the reference has been read. */
  covers(ref: Ref): boolean {
    const r = this.read.get(`${ref.slug}|${ref.chapter}`);
    if (!r) return false;
    const from = ref.from ?? r.first, to = Math.min(ref.to ?? r.last, r.last);
    let next = from;
    for (const [a, b] of [...r.ranges].sort((x, y) => x[0] - y[0])) if (a <= next && b >= next) next = b + 1;
    return next > to;
  }
  touched(ref: Ref): boolean { return this.read.has(`${ref.slug}|${ref.chapter}`); }
}

const usable = (s: Source) => s.kind !== "tool" && !!s.text?.trim() && !hasControlText(`${s.title}\n${s.text}`);

/** Each part's status from the passages read so far. */
export function checklist(parts: PlanPart[], sources: Source[], readings: Readings): Coverage["parts"] {
  const list = sources.filter(usable);
  return parts.map((part) => {
    const found = list.filter((s) => coverageDecision(part.ask, [s]).enough).map((s) => s.n);
    const evidence = found.length > 0;
    const refsRead = part.refs.every((r) => readings.covers(r));
    const someRead = part.refs.some((r) => readings.touched(r));
    const status: PartStatus = evidence && refsRead ? "covered" : evidence || someRead ? "partial" : "missing";
    return { id: part.id, status, sources: found.slice(0, PART_MAX_SOURCES) };
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

/**
 * What a finished answer carries about its research (only when it was tracked): the reader's parts,
 * each part's status, why research ended, and, when a part is not covered, `partial` with the
 * unfinished parts. Optional and additive; within the Mini App's bounds.
 */
export function studyFields(tracked: boolean, plan: PlanPart[], coverage: Coverage) {
  if (!tracked) return {};
  const open = coverage.parts.filter((p) => p.status !== "covered").map((p) => ({ id: p.id, ask: plan.find((x) => x.id === p.id)!.ask }));
  return {
    plan: { parts: plan.map(({ id, ask }) => ({ id, ask })) },
    coverage,
    ...(coverage.complete ? {} : { partial: true, unfinished: open }),
  };
}
export type StudyFields = ReturnType<typeof studyFields>;
