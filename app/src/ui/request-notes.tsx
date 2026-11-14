import { useState, type CSSProperties } from "react";

import { Switch } from "@/bible/ui/Sheet";
import { useNoteRequest } from "@/lib/requests";
import { haptic, requestWriteAccess, user } from "@/tg/sdk";

/**
 * "Request notes" for a class that has none: one ask per reader, how many have asked beside it.
 * Once asked it says so, and stays asked. Beside it, "Tell me when they're ready": the bot
 * messages the reader once the notes are published, so it first asks Telegram for leave to write
 * to them; if they decline, the ask still counts and nobody is told. `compact` leaves the switch
 * out (an action row with no room for it), and those asks are counted only.
 */
export function RequestNotes({ video, title, className, style, compact }: { video: string; title: string; className?: string; style?: CSSProperties; compact?: boolean }) {
  const { state, ask, enabled } = useNoteRequest(video);
  // Off until the reader turns it on: being told is something they choose (#622).
  const [tell, setTell] = useState(false);
  const [noBot, setNoBot] = useState(false);
  if (!enabled) return null;
  const count = ask.data?.count ?? state.data?.count ?? 0;
  const mine = ask.data?.mine ?? state.data?.mine ?? false;
  const told = ask.data?.tell ?? state.data?.tell ?? false;
  const others = mine ? count - 1 : count;
  const label = ask.isPending ? "Sending…"
    : mine ? (others > 0 ? `Notes requested · you and ${others} ${others === 1 ? "other" : "others"}` : "Notes requested")
    : ask.isError ? "Couldn't send. Try again"
    : count > 0 ? `Request notes · ${count} asked` : "Request notes";
  const send = async (wish = tell) => {
    haptic("select");
    let wantTell = !compact && wish;
    // Telegram lets a bot write first only to readers who allowed it (Bot API 6.9 requestWriteAccess).
    if (wantTell && !user?.allows_write_to_pm) { wantTell = await requestWriteAccess(); setNoBot(!wantTell); }
    ask.mutate({ title, tell: wantTell }, { onSuccess: () => haptic("success"), onError: () => haptic("error") });
  };
  const button = (
    <button type="button" className={`request-notes${className ? ` ${className}` : ""}`} style={style} data-done={mine ? "" : undefined}
      aria-pressed={mine} disabled={mine || ask.isPending}
      onClick={(e) => { e.stopPropagation(); void send(); }}>
      {label}
    </button>
  );
  if (compact) return button;
  return (
    <>
      {button}
      {mine && told ? <p className="request-notes__after">We'll message you here when the notes are ready.</p>
        // Asked without it (or from the player's action row): turning it on now adds them to those told.
        : mine ? <Switch on={false} onChange={(v) => { if (v && !ask.isPending) void send(true); }} label="Tell me when they're ready" />
        : <Switch on={tell} onChange={(v) => { haptic("select"); setTell(v); }} label="Tell me when they're ready" />}
      {noBot && !told ? <p className="request-notes__after">Allow @CyberJudah_bot to message you, then turn this on again.</p> : null}
    </>
  );
}
