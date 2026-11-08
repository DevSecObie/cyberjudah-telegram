/**
 * What an Ask stream line may carry. The Mini App drops any line over 256 KiB (its MAX_FRAME), so a
 * final line with every cited note's full text (read_note parts run to about 40,000 characters)
 * showed a finished answer as interrupted. A streamed source's `text` and `excerpt` are cut to the
 * first SOURCE_PREVIEW_CHARS (both clients show them clamped); a source that was cut also carries
 * `text_chars` (the length it had) and `truncated: true`. Sources that fit are sent as they were.
 * Nothing is lost: the full text stays behind each source's own page (its link). A saved conversation
 * keeps only each source's locator (title, link, moment; chats.ts slim()), as before.
 */
export const SOURCE_PREVIEW_CHARS = 1000;
/** A stream line is kept under this, well below the Mini App's 256 KiB limit. */
export const FRAME_BUDGET_BYTES = 200 * 1024;
/** Fields that are text bodies, not labels: each is cut on its own. */
const BODY_FIELDS = ["text", "excerpt"] as const;
/** Lines whose lists of sources are bounded: the final answer, and the agent's research passages. */
const LIST_KEYS = ["sources", "passages", "passages_delta"] as const;

type Src = { text?: unknown; excerpt?: unknown; [key: string]: unknown };

const previewOf = (source: Src, chars: number): Src => {
  const out: Src = { ...source };
  let longest = 0;
  for (const k of BODY_FIELDS) {
    const body = source[k];
    if (typeof body !== "string" || body.length <= chars) continue;
    longest = Math.max(longest, body.length);
    out[k] = body.slice(0, chars);
  }
  return longest ? { ...out, text_chars: typeof source.text === "string" ? source.text.length : longest, truncated: true } : out;
};

const bytes = (o: unknown) => new TextEncoder().encode(JSON.stringify(o)).length;

/** Whether a stream line carries a list of sources (answer deltas, pings and statuses do not). */
export const hasSourceList = (frame: unknown): boolean =>
  !!frame && typeof frame === "object" && LIST_KEYS.some((k) => Array.isArray((frame as Record<string, unknown>)[k]));

/**
 * The frame with its source lists as previews, shrunk further if the line would still pass
 * FRAME_BUDGET_BYTES: shorter previews, then none, so the reader always gets the answer and every
 * source's label and link.
 */
export function boundedFrame<T extends object>(frame: T): T {
  let out = frame;
  for (const chars of [SOURCE_PREVIEW_CHARS, 300, 0]) {
    const next: Record<string, unknown> = { ...(frame as Record<string, unknown>) };
    for (const key of LIST_KEYS) {
      const list = (frame as Record<string, unknown>)[key];
      if (Array.isArray(list)) next[key] = list.map((s) => (s && typeof s === "object" ? previewOf(s as Src, chars) : s));
    }
    out = next as T;
    if (bytes(out) <= FRAME_BUDGET_BYTES) break;
  }
  return out;
}
