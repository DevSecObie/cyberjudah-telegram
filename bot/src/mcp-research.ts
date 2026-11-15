import type { Env, Exec } from "./env";
import { retrieve } from "./ai";
import { answer, failure, linkOn, searchClasses, type Reading } from "./public-reading";

const KIND_LABEL: Record<string, string> = { spoken: "transcript", class: "class note", classes: "class note", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "study note", verse: "scripture", law: "law", case: "case study", precept: "precept", book: "library book" };

/**
 * A question answered from the whole library: the closest passages by meaning (the transcripts
 * of every class, notes or none, the notes, studies, law, cases and verses) and the best keyword
 * matches, reranked by whether they answer it. Falls back to the class search when the meaning
 * index is unavailable.
 */
export async function findTeaching(env: Env, question: string, limit: number, ctx?: Exec): Promise<Reading> {
  const q = question.trim();
  if (q.length < 3) return failure("Ask a question or give a subject, like \"what is the mark of the beast\".");
  let found: Awaited<ReturnType<typeof retrieve>> = [];
  try { found = await retrieve(env, q, Math.max(1, Math.min(20, limit))); } catch { found = []; }
  if (!found.length) {
    const classes = await searchClasses(env, q, "", 0);
    if (classes.isError) return failure("The library search is not answering just now. Try search_classes or search_library.");
    return answer(`(Searched by keyword only: the meaning index did not answer.)\n\n${classes.content[0].text}`, classes.sources);
  }
  const rows = found.map((p, i) => {
    const kind = KIND_LABEL[p.kind] ?? p.kind;
    const at = p.video ? `\n   Video: https://www.youtube.com/watch?v=${p.video}${p.t ? `&t=${Math.floor(p.t)}s` : ""}${p.t != null ? ` (read on with read_transcript video "${p.video}" at ${Math.floor(p.t)})` : ""}` : "";
    const meta = [kind, p.teacher, p.date, p.sub && p.sub !== kind ? p.sub : ""].filter(Boolean).join(" · ");
    return `${i + 1}. ${p.title} (${meta})\n   “${p.text.replace(/\s+/g, " ").trim().slice(0, 600)}”\n   Link: ${linkOn(env, p.url)}${at}`;
  });
  return answer(`${found.length} passages for “${q}”, the closest first. A transcript passage is the class's own words; read more of it before quoting.\n\n${rows.join("\n\n")}`, found);
}
