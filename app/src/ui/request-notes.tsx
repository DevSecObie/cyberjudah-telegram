import type { CSSProperties } from "react";

import { useNoteRequest } from "@/lib/requests";
import { haptic } from "@/tg/sdk";

/**
 * "Request notes" for a class that has none: one ask per reader, how many have asked beside it.
 * Once asked it says so, and stays asked.
 */
export function RequestNotes({ video, title, className, style }: { video: string; title: string; className?: string; style?: CSSProperties }) {
  const { state, ask, enabled } = useNoteRequest(video);
  if (!enabled) return null;
  const count = ask.data?.count ?? state.data?.count ?? 0;
  const mine = ask.data?.mine ?? state.data?.mine ?? false;
  const others = mine ? count - 1 : count;
  const label = ask.isPending ? "Sending…"
    : mine ? (others > 0 ? `Notes requested · you and ${others} ${others === 1 ? "other" : "others"}` : "Notes requested")
    : ask.isError ? "Couldn't send. Try again"
    : count > 0 ? `Request notes · ${count} asked` : "Request notes";
  return (
    <button type="button" className={`request-notes${className ? ` ${className}` : ""}`} style={style} data-done={mine ? "" : undefined}
      aria-pressed={mine} disabled={mine || ask.isPending}
      onClick={(e) => { e.stopPropagation(); haptic("select"); ask.mutate(title, { onSuccess: () => haptic("success"), onError: () => haptic("error") }); }}>
      {label}
    </button>
  );
}
