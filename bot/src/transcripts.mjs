/**
 * The transcripts: every recording's captions, cut into chunks the embedding job and the
 * "captions around a moment" excerpt can point into. Shared by the Worker (src/teachings.ts),
 * the embedding job (scripts/embed.mjs) and the tests.
 *
 * A chunk is a run of caption segments of about 45 seconds or 70 words, whichever comes
 * first, that starts at its first segment's time. Chunks overlap by their last three
 * segments so a phrase that straddles a cut is still found once. A hit's time is the
 * chunk's start, so the recording opens a few seconds before the words.
 */
export const CHUNK_SECONDS = 45;
export const CHUNK_WORDS = 70;
export const OVERLAP_SEGMENTS = 3;
/** A chunk with fewer words than this says nothing on its own ("do", "yeah so"); it joins the one before, or is left out. */
export const MIN_WORDS = 25;

/**
 * How a short last chunk joins the one before: "whole" keeps every word said (the overlap is left
 * out by position); "legacy" is the old fold, which also dropped any of the tail's first 24 words
 * found anywhere in the chunk before. The embedding job keeps "legacy" until EMBED_CHUNK_TAIL=whole
 * (re-embedding the changed chunks needs the owner's OK); everything else uses "whole".
 */
export function embedTailMode(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v && v !== "whole" && v !== "legacy") console.error(`::warning::EMBED_CHUNK_TAIL=${JSON.stringify(String(value))} is not "whole" or "legacy"; the old fold is kept`);
  return v === "whole" ? "whole" : "legacy";
}

/** [[t, text], ...] -> [{ t, text }, ...] */
export function chunkSegments(segments, options) {
  const tail = options?.tail ?? "whole";
  if (tail !== "whole" && tail !== "legacy") throw new Error(`chunkSegments: unknown tail mode ${JSON.stringify(tail)}`);
  const segs = (segments ?? []).filter((s) => Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "string" && s[1].trim()).map(([t, text]) => [t, text.replace(/\s+/g, " ").trim()]);
  // Each chunk keeps where its segments end (`to`, exclusive) until the end.
  const out = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i][0];
    let words = 0, j = i;
    while (j < segs.length && (j === i || (segs[j][0] - start < CHUNK_SECONDS && words < CHUNK_WORDS))) { words += segs[j][1].split(" ").length; j++; }
    out.push({ t: Math.max(0, Math.round((start - 3) * 10) / 10), text: segs.slice(i, j).map((s) => s[1]).join(" "), to: j });
    if (j >= segs.length) break;
    i = Math.max(i + 1, j - OVERLAP_SEGMENTS);
  }
  // A short last chunk joins the one before it; a short only chunk is left out. Only the segments
  // the one before does not already hold are added (the overlap, by position): every word said is
  // kept, in order, and none twice.
  const words = (c) => c.text.split(" ").length;
  while (out.length > 1 && words(out[out.length - 1]) < MIN_WORDS) {
    const last = out.pop();
    const prev = out[out.length - 1];
    if (tail === "legacy") {
      const seen = prev.text.split(" ");
      const extra = last.text.split(" ").filter((w, k) => k >= OVERLAP_SEGMENTS * 8 || !seen.includes(w));
      prev.text = `${prev.text} ${extra.join(" ")}`.trim();
    } else {
      // A chunk starts at most three segments before the one before it ends, never after it: what
      // the one before does not hold is exactly its segments from there to the tail's end.
      const extra = segs.slice(prev.to, last.to).map((s) => s[1]).join(" ");
      if (extra) prev.text = `${prev.text} ${extra}`;
    }
    prev.to = last.to;
  }
  return out.filter((c) => words(c) >= MIN_WORDS).map(({ t, text }) => ({ t, text }));
}

/** The video id in a YouTube thumbnail URL, which the feeds carry instead of the id. */
export const videoOfThumb = (thumb) => /(?:\/vi\/|\/img\/[a-z]+\/)([A-Za-z0-9_-]{11})(?=[/.])/.exec(thumb ?? "")?.[1] ?? null;
