/**
 * What an Ask stream line may carry. The Mini App drops any line over 256 KiB (its MAX_FRAME), so a
 * final line with every cited note's full text (read_note parts run to about 40,000 characters)
 * showed a finished answer as interrupted. Streamed sources carry a preview instead: the first
 * SOURCE_PREVIEW_CHARS of the text (as `text` and `excerpt`, which both clients show clamped), its
 * full length, and whether it was cut. The full text stays on the server, in the saved
 * conversation and behind each source's own page.
 */
export const SOURCE_PREVIEW_CHARS = 1000;
/** A stream line is kept under this, well below the Mini App's 256 KiB limit. */
export const FRAME_BUDGET_BYTES = 200 * 1024;
/** Fields that are text bodies, not labels: bounded like `text`. */
const BODY_FIELDS = ["text", "excerpt"] as const;

type Src = { text?: unknown; excerpt?: unknown; [key: string]: unknown };

const previewOf = (source: Src, chars: number): Src => {
  const full = typeof source.text === "string" ? source.text : typeof source.excerpt === "string" ? source.excerpt : "";
  const out: Src = { ...source };
  for (const k of BODY_FIELDS) delete out[k];
  if (chars <= 0) return { ...out, text_chars: full.length, truncated: full.length > 0 };
  const preview = full.slice(0, chars);
  return { ...out, text: preview, excerpt: preview, text_chars: full.length, ...(full.length > chars ? { truncated: true } : {}) };
};

const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

/**
 * The frame with its `sources` (and `passages`) as previews, shrunk further if the line would still
 * pass FRAME_BUDGET_BYTES: shorter previews, then none, so the reader always gets the answer.
 */
export function boundedFrame<T extends { sources?: unknown; passages?: unknown }>(frame: T): T {
  for (const chars of [SOURCE_PREVIEW_CHARS, 300, 0]) {
    const out = { ...frame } as T & { sources?: Src[]; passages?: Src[] };
    for (const key of ["sources", "passages"] as const) {
      const list = (frame as { [k: string]: unknown })[key];
      if (Array.isArray(list)) out[key] = list.map((s) => (s && typeof s === "object" ? previewOf(s as Src, chars) : s)) as Src[];
    }
    if (bytes(out) <= FRAME_BUDGET_BYTES || chars === 0) return out;
  }
  return frame;
}
