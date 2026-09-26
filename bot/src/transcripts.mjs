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

/** [[t, text], ...] -> [{ t, text }, ...] */
export function chunkSegments(segments) {
  const segs = (segments ?? []).filter((s) => Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "string" && s[1].trim()).map(([t, text]) => [t, text.replace(/\s+/g, " ").trim()]);
  const out = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i][0];
    let words = 0, j = i;
    while (j < segs.length && (j === i || (segs[j][0] - start < CHUNK_SECONDS && words < CHUNK_WORDS))) { words += segs[j][1].split(" ").length; j++; }
    out.push({ t: Math.max(0, Math.round((start - 3) * 10) / 10), text: segs.slice(i, j).map((s) => s[1]).join(" ") });
    if (j >= segs.length) break;
    i = Math.max(i + 1, j - OVERLAP_SEGMENTS);
  }
  return out;
}

/** The video id in a YouTube thumbnail URL, which the feeds carry instead of the id. */
export const videoOfThumb = (thumb) => /\/vi\/([A-Za-z0-9_-]{6,})\//.exec(thumb ?? "")?.[1] ?? null;
