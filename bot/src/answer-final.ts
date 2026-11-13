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
  /** Set false when the verse check couldn't read the King James text (the answer then isn't kept as final). */
  status?: { verified: boolean };
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
// HTML, removed whole: a closed comment, or anything from "<" then a letter, "/", "!" or "?" to the next
// ">" on the same line (whatever its attributes hold, "<" and "/" separators included). Kept: an exact <br>
// and a markdown autolink (<https://...>, <mailto:...>, <name@host>), never in a picture's caption. A run of
// "<" left before a letter etc. with no ">" on its line (an unfinished tag, or "Jacob<Israel") is removed, so
// nothing tag-like reaches a reader and no text past the line is touched; "a < b" with a space is untouched.
// An unclosed comment hides the rest of its own line (never more).
// While markup is removed every "<" stands as one private-use character (LT), which no entity or text around
// it can spell, so a removal can't join pieces into a new "<"; each one left goes back to "<" at the end.
const LT = "\uE002";
const PRIVATE = /[\uE000-\uE002]/g;
const HTML_TAG = /<[A-Za-z/!?][^>\n]*>/g;
const KEEP_TAG = /^(?:<br\s*\/?>|<https?:\/\/[^\s<>"]+>|<mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>|<[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>)$/i;
const LT_COMMENT = /\uE002!--[\s\S]*?-->|\uE002!--[^\n]*/g;
const LT_TAG = /\uE002[A-Za-z/!?][^>\n]*>/g;
// The whole run, so removing it can't leave another "<" before the letter.
const LT_OPEN = /\uE002+(?=[A-Za-z/!?])/g;

// Any other image written whole on one line (titled, empty, angle-bracketed, by reference): its alt text.
const OTHER_IMAGE = /!\[([^\[\]\n]*)\](?:\([^()\n]*(?:\([^()\n]*\)[^()\n]*)*\)|\[[^\[\]\n]*\])/g;

/**
 * The answer with only allowed pictures as images: an allowed ![alt](src) stays; any other image
 * written that way becomes its alt text; any other "![" loses its "!" (so no form of image, inline,
 * titled, nested or by reference, can render); raw HTML tags are removed, except a plain <br> and autolinks.
 */
export function onlyGivenPictures(answer: string, allowed: Set<string>): { text: string; dropped: number } {
  return withoutMarkup(answer, allowed, false);
}

function withoutMarkup(answer: string, allowed: Set<string>, caption: boolean): { text: string; dropped: number } {
  let dropped = 0;
  const kept: string[] = [], tagLike = new Set<number>();
  // Kept pieces stand aside under a mark no answer can hold (private-use characters, removed from the
  // answer first, and a nonce). A fresh nonce for each call (Workers don't allow random values at global scope).
  const nonce = crypto.randomUUID().slice(0, 8), marked = new RegExp(`\uE000${nonce}:(\\d+)\uE001`, "g");
  const beforeMark = new RegExp(`\uE002+(?=\uE000${nonce}:(\\d+)\uE001)`, "g");
  const mark = (whole: string) => {
    kept.push(whole);
    if (/^[A-Za-z/!?]/.test(whole)) tagLike.add(kept.length - 1);
    return `\uE000${nonce}:${kept.length - 1}\uE001`;
  };
  const noImages = (t: string) => t
    .replace(OTHER_IMAGE, (_whole, alt: string) => { dropped++; return alt.trim(); })
    .replace(/!+\[/g, () => { dropped++; return "["; });   // the whole run: "!!![" leaves no "!["
  const noOpeners = (t: string) => t.replace(LT_OPEN, () => { dropped++; return ""; });
  let text = answer.replace(PRIVATE, () => { dropped++; return ""; });
  text = text.replace(KEEPABLE, (whole, alt: string, src: string) => {
    if (!caption && allowed.has(src) && isAppPicture(src)) {
      // The caption passes the same rule with no tags kept, so "1 < 2" stays and markup goes.
      const c = withoutMarkup(alt, new Set(), true);
      dropped += c.dropped;
      return mark(`![${c.text}](${src})`);
    }
    dropped++;
    return alt.trim();
  });
  text = noImages(text);
  if (!caption) text = text.replace(HTML_TAG, (tag) => (KEEP_TAG.test(tag) ? mark(tag) : tag));
  text = text.replace(/</g, LT);
  text = text.replace(LT_COMMENT, () => { dropped++; return ""; });
  text = text.replace(LT_TAG, () => { dropped++; return ""; });
  text = noOpeners(text);
  // A removed tag can join "!" and "[" into an image ("!<b>[x](…)"): the image rules again, then any
  // "<" that now stands before what an image became.
  text = noOpeners(noImages(text));
  // A "<" right before a kept picture ("<" then "![…](…)" reads as "<!") goes too.
  text = text.replace(beforeMark, (run, i: string) => (tagLike.has(Number(i)) ? (dropped++, "") : run));
  text = text.split(LT).join("<");
  text = text.replace(marked, (_m, i: string) => kept[Number(i)]);
  return { text, dropped };
}

/** The answer with every quoted verse checked against the King James text (verse-guard.mjs), and
 *  whether the check could read what it needed. It fails open: when the books or a chapter can't be
 *  read, the quote stays as written and `verified` is false (so the answer isn't kept as final). */
export async function checkedVerses(env: Env, answer: string): Promise<{ text: string; verified: boolean }> {
  if (!/^>/m.test(answer)) return { text: answer, verified: true };
  let failed = false;
  try {
    const list = await books(env).catch(() => null);
    if (!list) return { text: answer, verified: false };
    const r = await guardVerses(answer, list, (slug, ch) => chapter(env, slug, ch).catch((e) => { failed = true; throw e; }));
    if (r.fixed || r.removed) console.log(JSON.stringify({ event: "ask_verse_guard", checked: r.checked, fixed: r.fixed, removed: r.removed }));
    if (failed) console.log(JSON.stringify({ event: "ask_verse_guard_unread" }));
    return { text: r.text, verified: !failed };
  } catch { return { text: answer, verified: false }; }
}

const ownPictures = (answer: string) => [...answer.matchAll(KEEPABLE)].map((m) => `Picture: ${m[2]}`);

/** The final step's version: a kept answer marked with it has passed this very step (answer-cache.ts). */
export const FINAL_STEP = 3;

/** The answer as readers may see it and as it may be kept: pictures limited, verses checked. */
export async function finalAnswer(env: Env, answer: string, options: FinalOptions = {}): Promise<string> {
  if (!answer) return answer;
  const evidence = [...(options.evidence ?? []), ...(options.trustOwnPictures ? ownPictures(answer) : [])];
  const { text, dropped } = /!\[|<[A-Za-z!/?]/.test(answer) ? onlyGivenPictures(answer, picturesIn(evidence)) : { text: answer, dropped: 0 };
  if (dropped) console.log(JSON.stringify({ event: "ask_picture_guard", dropped }));
  const r = await checkedVerses(env, text);
  if (options.status && !r.verified) options.status.verified = false;
  return r.text;
}

/** Evidence for finalAnswer from a run's passages (their text and title). */
export const passageEvidence = (passages: readonly { title?: string; text?: string; kind?: string }[] = []) =>
  passages.filter((p) => !OUTSIDE.has(p.kind ?? "")).flatMap((p) => [p.title, p.text]);
/** Passages from outside the app (outside_source's web pages): their text never allows a picture. */
const OUTSIDE = new Set(["web"]);

/**
 * Guards a streamed answer as it is sent: text goes out as it comes, except from where an image ("![")
 * or a tag ("<" then a letter, "/", "!" or "?") may start to the end of its line, which is held until the
 * line is complete and then sent through onlyGivenPictures with the pictures
 * known so far. `push` takes each delta and returns what may be sent now; `flush` returns the rest at
 * the end; `reset` forgets a draft the reader was told to clear.
 */
export function pictureStream(evidence: () => Iterable<string | undefined | null>) {
  let held = "", dropped = 0;
  // The allowed pictures, worked out again only when the evidence has grown.
  let seen = -1, allowed = new Set<string>();
  const known = () => {
    const all = [...evidence()];
    const size = all.reduce((n, t) => n + (typeof t === "string" ? t.length + 1 : 1), 0);
    if (size !== seen) { seen = size; allowed = picturesIn(all); }
    return allowed;
  };
  const clean = (s: string) => { const r = onlyGivenPictures(s, known()); dropped += r.dropped; return r.text; };
  // Where something that may be an image or a tag starts ("!" or "<" last in the text may be one, too).
  const start = (t: string) => {
    for (let i = 0; i < t.length; i++) {
      const c = t[i], next = t[i + 1];
      if (c === "!") {
        // A run of "!": held from its first, as "<" below ("!![" cleaned to "[" after a sent "!" is "!["), and
        // "!<" too: a tag removed between "!" and "[" would join them.
        let j = i;
        while (t[j + 1] === "!") j++;
        const after = t[j + 1];
        if (after === undefined || after === "[" || after === "<") return i;
        i = j;
        continue;
      }
      if (c === "<") {
        // A run of "<": held from its first, so what is sent can't join what the held part becomes.
        let j = i;
        while (t[j + 1] === "<") j++;
        const after = t[j + 1];
        if (after === undefined || /[A-Za-z/!?]/.test(after)) return i;
        i = j;
      }
    }
    return -1;
  };
  // Held text is complete at the end of its line. A tag left open there loses its "<" (onlyGivenPictures),
  // so what follows on the next line is only words. A comment ("<!--") is held until its "-->" (at most
  // 4,000 characters), so what it hides never streams out line by line.
  const done = (h: string) => h.endsWith("\n") && (!/<!--(?![\s\S]*-->)/.test(h) || h.length > 4000);
  return {
    /** How many images or tags the stream has held back from the reader so far. */
    get dropped() { return dropped; },
    push(delta: string): string {
      let out = "";
      for (const part of delta.split(/(?<=\n)/)) {
        if (held) {
          held += part;
          if (done(held)) { out += clean(held); held = ""; }
          continue;
        }
        const at = start(part);
        if (at < 0) { out += part; continue; }
        out += part.slice(0, at);
        held = part.slice(at);
        if (done(held)) { out += clean(held); held = ""; }
      }
      return out;
    },
    flush(): string { const rest = held ? clean(held) : ""; held = ""; return rest; },
    reset(): void { held = ""; },
  };
}

type Delta = { delta?: unknown; reset?: unknown; passages?: unknown; passages_delta?: unknown };

/**
 * A stream's events with every delta guarded (pictureStream), and `settle(final, draft)` for the end:
 * when the final text differs from the draft, or the guard held anything back, the reader's draft is
 * replaced by the final text (reset, then one delta); otherwise whatever is still held is sent.
 */
export function guardedStream<E>(send: (event: E) => void, evidence: () => Iterable<string | undefined | null>) {
  // Passages the stream itself announces (a research run's "passages" events) count as evidence too.
  const announced: (string | undefined)[] = [];
  const guard = pictureStream(() => [...evidence(), ...announced]);
  const emit = (event: E) => {
    const e = event as Delta;
    for (const list of [e?.passages, e?.passages_delta]) if (Array.isArray(list)) announced.push(...passageEvidence(list as { title?: string; text?: string }[]));
    if (e && e.reset === true) { guard.reset(); send(event); return; }
    if (e && typeof e.delta === "string") {
      const out = guard.push(e.delta);
      if (out) send({ ...event, delta: out } as E);
      return;
    }
    send(event);
  };
  /** `force`: the reader's draft is replaced whatever it held (e.g. it carried a second, retried draft). */
  const settle = (final: string, draft: string, force = false) => {
    const rest = guard.flush();
    if (force || final !== draft || guard.dropped) { guard.reset(); send({ reset: true } as E); send({ delta: final } as E); }
    else if (rest) send({ delta: rest } as E);
  };
  return { emit, settle };
}
