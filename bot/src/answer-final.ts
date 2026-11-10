import type { Env } from "./env";
import { books, chapter } from "./data";
import { guardVerses } from "./verse-guard.mjs";

/**
 * The one last step every Ask answer passes through before a reader sees it or it is kept, on every
 * path (askStream, ask, answerApp, answerAppAgent, owner-approved and cached answers):
 *
 * 1. Pictures: a markdown image is kept only when its address is exactly a "Picture: <path>" that
 *    a tool or library passage gave in this answer's own run, and that path is one of the app's own
 *    picture files (the same rule as the app's renderer, app/src/lib/safe-links.ts APP_PICTURE). Any
 *    other image is shown as its alt text; every other image syntax loses its "!", and raw HTML tags
 *    are removed, so nothing in an answer can make a reader's device fetch an outside address
 *    (OWASP LLM05, LLM02).
 * 2. Scripture: every quoted verse is checked against the King James text and corrected or removed
 *    (verse-guard.mjs), so no answer misquotes Scripture (OWASP LLM09).
 *
 * The stream a reader watches is guarded as it goes (pictureStream): no image or tag is sent before
 * it has been checked.
 */
export type FinalOptions = {
  /** Text the run's tools and passages returned: the only place an allowed picture address can come from. */
  evidence?: Iterable<string | undefined | null>;
  /** An owner-approved answer: its own app picture paths are trusted (still only the app's picture files). */
  trustOwnPictures?: boolean;
};

/** The app's own picture files (kept in step with app/src/lib/safe-links.ts APP_PICTURE). */
const APP_PICTURE = /^\/(people|timeline|library|brand)\/[A-Za-z0-9._/-]+\.(webp|png|jpe?g)$|^\/api\/photos\/file\/photos\/[a-z]+\/[a-z0-9-]+\/\d{13}\.(webp|png|jpe?g)$/;
export const isAppPicture = (src: string) => APP_PICTURE.test(src) && !src.includes("..") && !src.includes("//");

const PICTURE = /Picture:\s*(\S+)/g;

/** The app picture addresses the run's own tools and passages gave ("Picture: /path"). */
export function picturesIn(evidence: Iterable<string | undefined | null> = []): Set<string> {
  const out = new Set<string>();
  for (const text of evidence) {
    if (typeof text !== "string") continue;
    for (const m of text.matchAll(PICTURE)) {
      const src = m[1].replace(/[),.;]+$/, "");
      if (isAppPicture(src)) out.add(src);
    }
  }
  return out;
}

/** Only the "Picture:" lines of a tool's text, however long it is, for the run's evidence. */
export const pictureLines = (text: string) => text.match(PICTURE) ?? [];

// The one image form kept: ![alt](src) on one line, alt without brackets, src an exact allowed path.
const KEEPABLE = /!\[([^\[\]\n]*)\]\(([^()\s<>"']+)\)/g;
const HTML_TAG = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->/g;
// Any other image written whole on one line (titled, empty, angle-bracketed, by reference): its alt text.
const OTHER_IMAGE = /!\[([^\[\]\n]*)\](?:\([^()\n]*(?:\([^()\n]*\)[^()\n]*)*\)|\[[^\[\]\n]*\])/g;

/**
 * The answer with only allowed pictures as images: an allowed ![alt](src) stays; any other image
 * written that way becomes its alt text; any other "![" loses its "!" (so no form of image, inline,
 * titled, nested or by reference, can render); raw HTML tags are removed, except a plain <br>.
 */
export function onlyGivenPictures(answer: string, allowed: Set<string>): { text: string; dropped: number } {
  let dropped = 0;
  const kept: string[] = [];
  let text = answer.replace(KEEPABLE, (whole, alt: string, src: string) => {
    if (allowed.has(src) && isAppPicture(src)) { kept.push(whole); return `\u0000${kept.length - 1}\u0000`; }
    dropped++;
    return alt.trim();
  });
  text = text.replace(OTHER_IMAGE, (_whole, alt: string) => { dropped++; return alt.trim(); });
  text = text.replace(/!\[/g, () => { dropped++; return "["; });
  text = text.replace(HTML_TAG, (tag) => (/^<br\s*\/?>$/i.test(tag) ? tag : (dropped++, "")));
  text = text.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => kept[Number(i)]);
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

const ownPictures = (answer: string) => [...answer.matchAll(KEEPABLE)].map((m) => `Picture: ${m[2]}`);

/** The answer as readers may see it and as it may be kept: pictures limited, verses checked. */
export async function finalAnswer(env: Env, answer: string, options: FinalOptions = {}): Promise<string> {
  if (!answer) return answer;
  const evidence = [...(options.evidence ?? []), ...(options.trustOwnPictures ? ownPictures(answer) : [])];
  const { text, dropped } = /!\[|<[A-Za-z!/]/.test(answer) ? onlyGivenPictures(answer, picturesIn(evidence)) : { text: answer, dropped: 0 };
  if (dropped) console.log(JSON.stringify({ event: "ask_picture_guard", dropped }));
  return checkedVerses(env, text);
}

/** Evidence for finalAnswer from a run's passages (their text and title). */
export const passageEvidence = (passages: readonly { title?: string; text?: string }[] = []) => passages.flatMap((p) => [p.title, p.text]);

/**
 * Guards a streamed answer as it is sent: text goes out as it comes, except from a "!" or "<" to the
 * end of its line, which is held until the line is complete and then sent through onlyGivenPictures
 * with the pictures known so far. `push` takes each delta and returns what may be sent now; `flush`
 * returns the rest at the end; `reset` forgets a draft the reader was told to clear.
 */
export function pictureStream(evidence: () => Iterable<string | undefined | null>) {
  let held = "", dropped = 0;
  const clean = (s: string) => { const r = onlyGivenPictures(s, picturesIn(evidence())); dropped += r.dropped; return r.text; };
  return {
    /** How many images or tags the stream has held back from the reader so far. */
    get dropped() { return dropped; },
    push(delta: string): string {
      let out = "";
      for (const part of delta.split(/(?<=\n)/)) {
        if (held) {
          held += part;
          if (held.endsWith("\n")) { out += clean(held); held = ""; }
          continue;
        }
        const at = part.search(/[!<]/);
        if (at < 0) { out += part; continue; }
        out += part.slice(0, at);
        held = part.slice(at);
        if (held.endsWith("\n")) { out += clean(held); held = ""; }
      }
      return out;
    },
    flush(): string { const rest = held ? clean(held) : ""; held = ""; return rest; },
    reset(): void { held = ""; },
  };
}

type Delta = { delta?: unknown; reset?: unknown };

/**
 * A stream's events with every delta guarded (pictureStream), and `settle(final, draft)` for the end:
 * when the final text differs from the draft, or the guard held anything back, the reader's draft is
 * replaced by the final text (reset, then one delta); otherwise whatever is still held is sent.
 */
export function guardedStream<E>(send: (event: E) => void, evidence: () => Iterable<string | undefined | null>) {
  const guard = pictureStream(evidence);
  const emit = (event: E) => {
    const e = event as Delta;
    if (e && e.reset === true) { guard.reset(); send(event); return; }
    if (e && typeof e.delta === "string") {
      const out = guard.push(e.delta);
      if (out) send({ ...event, delta: out } as E);
      return;
    }
    send(event);
  };
  const settle = (final: string, draft: string) => {
    const rest = guard.flush();
    if (final !== draft || guard.dropped) { guard.reset(); send({ reset: true } as E); send({ delta: final } as E); }
    else if (rest) send({ delta: rest } as E);
  };
  return { emit, settle };
}
