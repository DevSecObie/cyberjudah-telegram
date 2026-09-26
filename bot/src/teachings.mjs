/**
 * The teachings search, as the site's /teachings page has it: the spoken passages of every
 * recording (teaching_passages, built by the cyberjudah repository's corpus indexer into the
 * site's D1 database) searched for words together or a quoted phrase, and each hit's
 * excerpt cut around the first match with the second it was said.
 * Pure parts, shared with the tests; the queries are in src/teachings.ts.
 */
export const OPEN = "", CLOSE = "";
export const FEEDS = ["classes", "captains", "history"];
export const FEED_LABEL = { classes: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };

/** The excerpt around the first match, the same match choosing the second to open the video at. */
export function passageExcerpt(marked, cuesJson, passageStart) {
  let text = "", cursor = 0;
  const spans = [];
  for (const match of marked.matchAll(/([^]*)/g)) {
    text += marked.slice(cursor, match.index);
    const start = text.length;
    text += match[1];
    spans.push([start, text.length]);
    cursor = match.index + match[0].length;
  }
  text += marked.slice(cursor);
  const words = [...text.matchAll(/\S+/g)];
  const firstMatch = spans[0]?.[0];
  const matchWord = firstMatch === undefined ? 0 : Math.max(0, words.findIndex((w) => w.index + w[0].length > firstMatch));
  const fromWord = Math.max(0, matchWord - 12);
  const from = words[fromWord]?.index ?? 0;
  const toWord = Math.min(words.length, fromWord + 48);
  const to = Math.max(toWord < words.length ? words[toWord].index : text.length, spans[0]?.[1] ?? 0);
  let excerpt = from > 0 ? "… " : "";
  let position = from;
  for (const [start, end] of spans) {
    if (end <= from || start >= to) continue;
    const left = Math.max(start, from), right = Math.min(end, to);
    excerpt += text.slice(position, left) + OPEN + text.slice(left, right) + CLOSE;
    position = right;
  }
  excerpt += text.slice(position, to).trimEnd() + (to < text.length ? " …" : "");
  let start = Number(passageStart) || 0, exact = false;
  if (firstMatch !== undefined && cuesJson) {
    try {
      const cues = JSON.parse(cuesJson);
      if (Array.isArray(cues)) for (const cue of cues) {
        if (!Array.isArray(cue) || !Number.isFinite(cue[0]) || !Number.isFinite(cue[1]) || cue[1] < 0) continue;
        if (cue[0] > firstMatch) break;
        start = cue[1]; exact = true;
      }
    } catch { /* an older index without cue offsets keeps the passage start */ }
  }
  return { excerpt, start, timing: exact ? "caption" : "passage" };
}

/** The marked text as plain runs and matches: [{ text, match }] */
export function runs(marked) {
  return marked.split(/([^]*)/g).filter(Boolean).map((part) => part.startsWith(OPEN) && part.endsWith(CLOSE) ? { text: part.slice(1, -1), match: true } : { text: part, match: false });
}
