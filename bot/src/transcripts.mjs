/**
 * The transcripts: every recording's captions, cut into chunks the embedding job and the
 * "captions around a moment" excerpt can point into. Shared by the Worker (src/teachings.ts),
 * the embedding job (scripts/embed.mjs) and the tests.
 *
 * A chunk is a run of caption segments of about 45 seconds or 70 words, whichever comes
 * first, that starts at its first segment's time. Chunks overlap by their last three
 * segments so a phrase that straddles a cut is still found once. A hit's time is the
 * chunk's start, so the recording opens a few seconds before the words. The one exception is
 * a sparse stretch of more than 45 seconds joined to the chunk after it (see chunkSegments):
 * that chunk keeps its own time, so its sparse first words were said before it opens.
 */
export const CHUNK_SECONDS = 45;
export const CHUNK_WORDS = 70;
export const OVERLAP_SEGMENTS = 3;
/** A chunk with fewer words than this says nothing on its own ("do", "yeah so"); it joins another chunk, or is left out if it is a recording's only one. */
export const MIN_WORDS = 25;

/** An embedding-job switch: only `on` (any case or spacing) turns it on; anything else is `off`, with a warning if it is not `off` either. */
function envSwitch(name, value, on, off, note) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v && v !== on && v !== off) console.error(`::warning::${name}=${JSON.stringify(String(value))} is not "${on}" or "${off}"; ${note}`);
  return v === on ? on : off;
}

/**
 * How a short last chunk joins the one before: "whole" keeps every word said (the overlap is left
 * out by position); "legacy" is the old fold, which also dropped any of the tail's first 24 words
 * found anywhere in the chunk before. The embedding job keeps "legacy" until EMBED_CHUNK_TAIL=whole
 * (re-embedding the changed chunks needs the owner's OK); everything else uses "whole".
 */
export const embedTailMode = (value) => envSwitch("EMBED_CHUNK_TAIL", value, "whole", "legacy", "the old fold is kept");

/**
 * What happens to a short chunk in the middle of a recording: "fold" joins it to the next one, so
 * its words are kept; "drop" is the old rule, which left it out (when captions are sparse, its
 * words were in no other chunk). The embedding job keeps "drop" until EMBED_CHUNK_MIDDLE=fold
 * (re-embedding the changed chunks needs the owner's OK); everything else uses "fold".
 */
export const embedMiddleMode = (value) => envSwitch("EMBED_CHUNK_MIDDLE", value, "fold", "drop", "short middle chunks are still left out");

/**
 * The embedding job's chunk rules from its environment. The middle fold applies only with the
 * whole-words tail fold: the old tail fold can drop common words from a short last chunk that now
 * begins with a folded run, and turning them on one at a time would re-embed twice.
 */
export function embedChunkModes(env) {
  const tail = embedTailMode(env?.EMBED_CHUNK_TAIL);
  let middle = embedMiddleMode(env?.EMBED_CHUNK_MIDDLE);
  if (middle === "fold" && tail !== "whole") {
    console.error("::warning::EMBED_CHUNK_MIDDLE=fold needs EMBED_CHUNK_TAIL=whole too; short middle chunks are still left out");
    middle = "drop";
  }
  return { tail, middle };
}

/** [[t, text], ...] -> [{ t, text }, ...] */
export function chunkSegments(segments, options) {
  const tail = options?.tail ?? "whole";
  if (tail !== "whole" && tail !== "legacy") throw new Error(`chunkSegments: unknown tail mode ${JSON.stringify(tail)}`);
  const middle = options?.middle ?? "fold";
  if (middle !== "fold" && middle !== "drop") throw new Error(`chunkSegments: unknown middle mode ${JSON.stringify(middle)}`);
  const segs = (segments ?? []).filter((s) => Array.isArray(s) && typeof s[0] === "number" && typeof s[1] === "string" && s[1].trim()).map(([t, text]) => [t, text.replace(/\s+/g, " ").trim()]);
  // Words before each segment, so a run's word count is one subtraction.
  const before = [0];
  for (const s of segs) before.push(before[before.length - 1] + s[1].split(" ").length);
  const at = (i) => Math.max(0, Math.round((segs[i][0] - 3) * 10) / 10);
  const join = (from, to) => segs.slice(from, to).map((s) => s[1]).join(" ");
  // Each chunk keeps where its segments start (`from`) and end (`to`, exclusive) until the end.
  let out = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i][0];
    let j = i;
    while (j < segs.length && (j === i || (segs[j][0] - start < CHUNK_SECONDS && before[j] - before[i] < CHUNK_WORDS))) j++;
    out.push({ t: at(i), text: join(i, j), from: i, to: j });
    if (j >= segs.length) break;
    i = Math.max(i + 1, j - OVERLAP_SEGMENTS);
  }
  const words = (c) => c.text.split(" ").length;
  // A short chunk before the last joins the next one, which then runs from the short one's first
  // segment to its own end (chunks overlap, so that is one unbroken run, every word once). A run of
  // short chunks is carried forward until a chunk holds MIN_WORDS words or the last is reached.
  // The joined chunk opens where the run began only when that is at most CHUNK_SECONDS before its
  // own first segment, and its time would not round to the same second as the chunk before (the
  // index id is the video and the rounded second); otherwise it keeps its own time.
  if (middle === "fold") {
    const kept = [];
    let run = -1;
    out.forEach((c, k) => {
      const from = run >= 0 ? run : c.from;
      if (k < out.length - 1 && before[c.to] - before[from] < MIN_WORDS) { run = from; return; }
      if (run >= 0) {
        const t = at(run);
        if (segs[c.from][0] - segs[run][0] <= CHUNK_SECONDS && Math.round(t) !== Math.round(kept[kept.length - 1]?.t ?? -1)) c.t = t;
        c.from = run;
        c.text = join(c.from, c.to);
        run = -1;
      }
      kept.push(c);
    });
    out = kept;
  }
  // A short last chunk joins the one before it; a short only chunk is left out. Only the segments
  // the one before does not already hold are added (the overlap, by position): every word said is
  // kept, in order, and none twice.
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
      const extra = join(prev.to, last.to);
      if (extra) prev.text = `${prev.text} ${extra}`;
    }
    prev.to = last.to;
  }
  // With "drop", a short chunk before the last is left out here.
  return out.filter((c) => words(c) >= MIN_WORDS).map(({ t, text }) => ({ t, text }));
}

/** The video id in a YouTube thumbnail URL, which the feeds carry instead of the id. */
export const videoOfThumb = (thumb) => /(?:\/vi\/|\/img\/[a-z]+\/)([A-Za-z0-9_-]{11})(?=[/.])/.exec(thumb ?? "")?.[1] ?? null;
