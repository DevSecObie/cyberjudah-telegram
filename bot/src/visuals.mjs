// The moments a teacher points at something on the screen: "look at this picture", "next
// slide", "pull that up", "as you can see". Found in the captions, they say where a frame
// of the recording belongs in the notes. Pure, so it is tested on its own.
const CUES = [
  /\blook at (this|that|the|these|those) (picture|image|photo|screen|slide|map|chart|graph|diagram|article|headline|video|clip|post|tweet|meme|screenshot|board|painting|drawing|list|table|quote|page)\b/,
  /\b(this|that|the next|next|the first|the second|the last|the other) (picture|image|photo|slide|map|chart|graph|diagram|screenshot|meme|painting|drawing|clip|video|article|headline)\b/,
  /\b(on|onto|up on) the screen\b/,
  /\bpull (that|this|it|the \w+) up\b/,
  /\bput (that|this|it) (up|on the screen)\b/,
  /\bas you can see\b/,
  /\byou can see (here|right here|it here|in this)\b/,
  /\blook (right )?here\b/,
  /\bzoom in\b/,
  /\b(play|roll|run) the (clip|video|tape)\b/,
  /\bshow (them|you|us|y'all|everybody) the (picture|image|photo|slide|map|chart|screen|clip|video)\b/,
  /\bgo to the next (one|slide|picture|image|page)\b/,
];
const LEAD = 5; // seconds after the words, for the slide to be up
const MERGE = 25; // cues this close are one visual

/** Whether a caption line points at something shown. */
export const isCue = (text) => { const t = String(text).toLowerCase(); return CUES.some((re) => re.test(t)); };

/**
 * The visual moments of a transcript: each a time (a few seconds after the words, when the
 * picture is up) and the words themselves as caption. Segments are [[t, text], ...].
 */
export function findVisuals(segments, limit = 80) {
  const out = [];
  for (const [t, text] of segments) {
    if (!isCue(text)) continue;
    const last = out[out.length - 1];
    if (last && t - last.said <= MERGE) { last.text = `${last.text} ${text}`.trim().slice(0, 240); continue; }
    out.push({ said: t, t: Math.max(0, Math.round(t + LEAD)), text: String(text).trim().slice(0, 240) });
  }
  return out.slice(0, limit).map(({ t, text, said }) => ({ t, said: Math.round(said), text }));
}
