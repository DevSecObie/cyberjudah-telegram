import type { Env } from "./env";
import { books, chapter } from "./data";
import { guardVerses } from "./verse-guard.mjs";

/**
 * The one last step every Ask answer passes through before a reader sees it or it is kept, on every
 * path (askStream, ask, answerApp, answerAppAgent, owner-approved answers):
 *
 * 1. Pictures: a markdown image is kept only when its address is exactly a "Picture: <path>" that
 *    a tool or library passage gave in this answer's own run. Any other image (an address the model
 *    wrote, or one planted in a source to carry data out in its URL) becomes its alt text, and raw
 *    <img> tags and reference-style images are removed the same way (OWASP LLM05, LLM02).
 * 2. Scripture: every quoted verse is checked against the King James text and corrected or removed
 *    (verse-guard.mjs), so no answer misquotes Scripture (OWASP LLM09).
 *
 * Text that has neither images nor quotes is returned unchanged, without any lookup.
 */
export type FinalOptions = {
  /** Text the run's tools and passages returned: the only place an allowed picture address can come from. */
  evidence?: Iterable<string | undefined | null>;
};

const PICTURE = /Picture:\s*(\S+)/g;

/** The picture addresses the run's own tools and passages gave ("Picture: /path"). */
export function picturesIn(evidence: Iterable<string | undefined | null> = []): Set<string> {
  const out = new Set<string>();
  for (const text of evidence) {
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(PICTURE)) out.add(m[1].replace(/[),.;]+$/, ""));
  }
  return out;
}

// ![alt](src) or ![alt](<src> "title"); reference-style ![alt][ref]; raw <img ...>.
const INLINE_IMAGE = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
const REFERENCE_IMAGE = /!\[([^\]\n]*)\]\[[^\]\n]*\]/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;

const altText = (alt: string) => alt.replace(/[[\]]/g, "").trim();

/** The answer with every image not given by a tool turned into its alt text. */
export function onlyGivenPictures(answer: string, allowed: Set<string>): { text: string; dropped: number } {
  let dropped = 0;
  const text = answer
    .replace(INLINE_IMAGE, (whole, alt: string, src: string) => {
      if (src && allowed.has(src)) return whole;
      dropped++;
      return altText(alt);
    })
    .replace(REFERENCE_IMAGE, (_whole, alt: string) => { dropped++; return altText(alt); })
    .replace(HTML_IMAGE, () => { dropped++; return ""; });
  return { text, dropped };
}

/** The answer with every quoted verse checked against the King James text (verse-guard.mjs). */
export async function checkedVerses(env: Env, answer: string): Promise<string> {
  if (!/^>/m.test(answer)) return answer;
  try {
    const r = await guardVerses(answer, await books(env).catch(() => null), (slug, ch) => chapter(env, slug, ch));
    if (r.fixed || r.removed) console.log(JSON.stringify({ event: "ask_verse_guard", checked: r.checked, fixed: r.fixed, removed: r.removed }));
    return r.text;
  } catch { return answer; }
}

/** The answer as readers may see it and as it may be kept: pictures limited, verses checked. */
export async function finalAnswer(env: Env, answer: string, options: FinalOptions = {}): Promise<string> {
  if (!answer) return answer;
  const { text, dropped } = /!\[|<img/i.test(answer) ? onlyGivenPictures(answer, picturesIn(options.evidence)) : { text: answer, dropped: 0 };
  if (dropped) console.log(JSON.stringify({ event: "ask_picture_guard", dropped }));
  return checkedVerses(env, text);
}

/** Evidence for finalAnswer from a run's passages (their text and title). */
export const passageEvidence = (passages: readonly { title?: string; text?: string }[] = []) => passages.flatMap((p) => [p.title, p.text]);
