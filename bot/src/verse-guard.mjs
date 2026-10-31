/**
 * Ask may quote Scripture only word for word. Every verse an answer quotes as a blockquote
 * ("> text **Reference**") is checked against the King James text: a quote that matches stays; one
 * that does not is replaced with the verse's real text when the reference names three verses or
 * fewer, and taken out otherwise. Shared by the Worker (ai.ts) and the Ask test set (scripts/eval-ask.mjs).
 */
import { parseReference } from "./refs.mjs";

const QUOTE = /^>\s*(.+?)\s*\*\*([^*]{3,60}?)\*\*\.?\s*$/;
const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * `{ text, checked, fixed, removed }` for an answer. `books` is books.json; `chapter(slug, ch)` gives
 * `{ verses: [{ verse, text }] }` or null. A chapter that cannot be read leaves its quote as it is.
 */
export async function guardVerses(answer, books, chapter) {
  const lines = String(answer).split("\n");
  let checked = 0, fixed = 0, removed = 0;
  const out = [];
  for (const line of lines) {
    const m = QUOTE.exec(line);
    const ref = m && books ? parseReference(m[2].replace(/\s*\(KJV\)\s*$/i, ""), books) : null;
    if (!m || !ref?.verse) { out.push(line); continue; }
    const c = await chapter(ref.slug, ref.chapter).catch(() => null);
    if (!c) { out.push(line); continue; }
    checked++;
    const from = ref.verse, to = ref.verseEnd ?? from;
    const verses = c.verses.filter((v) => v.verse >= from && v.verse <= to);
    const real = verses.map((v) => v.text).join(" ");
    // A quote may leave words out with an ellipsis: every piece must be in the verse, in order.
    const pieces = m[1].replace(/^["“]|["”]$/g, "").split(/\.\.\.|…/).map(norm).filter(Boolean);
    const hay = norm(real);
    let at = 0;
    const ok = verses.length > 0 && pieces.join(" ").length >= 8 && pieces.every((p) => { const i = hay.indexOf(p, at); if (i < 0) return false; at = i + p.length; return true; });
    if (ok) { out.push(line); continue; }
    if (verses.length && to - from < 3) { fixed++; out.push(`> ${real.trim()} **${ref.book} ${ref.chapter}:${from}${to > from ? `-${to}` : ""}**`); }
    else removed++;
  }
  return { text: out.join("\n"), checked, fixed, removed };
}
