import data from "../data/approved-answers.json";
import type { Passage, Turn } from "./ai.mjs";

/**
 * The owner's approved answers (data/approved-answers.json): when a new question, asked on its own,
 * is one of an entry's questions in other words, Ask gives that answer at once and no model writes
 * anything. Matching is by the question's words, never by meaning, so an answer is only ever given
 * to the question it was approved for.
 */
export type Approved = { id: string; questions: string[]; answer: string; sources?: { kind: string; title: string; url: string }[]; followups?: string[] };
const ENTRIES = (data as { answers: Approved[] }).answers;

const STOP = new Set(["a", "an", "the", "of", "to", "is", "are", "was", "were", "do", "does", "did", "we", "i", "you", "in", "on", "about", "what", "please", "tell", "me", "can"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));

/** The approved entry for a question, or null: only a first question, and only a near word-for-word match. */
export function approvedFor(question: string, history: Turn[] = [], entries: Approved[] = ENTRIES): Approved | null {
  if (history.length || !entries.length) return null;
  const asked = words(question);
  if (asked.size < 2) return null;
  for (const e of entries) for (const q of e.questions) {
    const known = words(q);
    const shared = [...asked].filter((w) => known.has(w)).length;
    if (shared / (asked.size + known.size - shared) >= 0.85) return e;
  }
  return null;
}

/** An approved entry's sources, numbered as Ask numbers its own. */
export const approvedSources = (e: Approved): (Passage & { n: number })[] => (e.sources ?? []).map((s, i) => ({ kind: s.kind, title: s.title, url: s.url, text: "", n: i + 1 }));
