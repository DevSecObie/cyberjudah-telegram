import { useNavigate } from "react-router";

import { fmtDate } from "@/api/data";
import { useCloseRequest, useNoteRequests } from "@/lib/requests";
import { useBackButton } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { Empty, Screen, Section, Skeleton } from "@/ui/ui";

const WORKFLOW = "https://github.com/DevSecObie/cyberjudah-telegram/actions/workflows/draft-notes.yml";

/**
 * The admins' queue of classes readers asked notes for, the most asked first. Notes cost money to
 * write, so this is where the next ones are chosen: copy the video ids into the draft-notes
 * workflow, and mark a class done once its notes are in (or to turn it down).
 */
export function NoteRequests() {
  useBackButton(true);
  const navigate = useNavigate();
  const list = useNoteRequests(true);
  const close = useCloseRequest();
  const rows = list.data ?? [];
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => haptic("success")).catch(() => haptic("error")); };
  return (
    <Screen title="Requested notes" kicker="Admin">
      <p className="hint">Classes readers asked notes for, the most asked first. To write them, run the draft-notes workflow with their video ids; it opens a pull request with the drafts for review. Mark a class done when its notes are in.</p>
      {list.isPending ? <Skeleton rows={5} /> : list.isError ? <Empty title="The requests did not load" action={{ label: "Retry", onClick: () => void list.refetch() }} /> : !rows.length ? <Empty title="No requests yet">When readers ask for a class's notes, it shows here.</Empty> : (
        <>
          <div className="nreq__bar">
            <button type="button" className="nreq__btn" onClick={() => copy(rows.slice(0, 5).map((r) => r.video).join(" "))}>Copy the top {Math.min(5, rows.length)} ids</button>
            <button type="button" className="nreq__btn nreq__btn--quiet" onClick={() => { haptic("select"); openLink(WORKFLOW); }}>Open the workflow</button>
          </div>
          <Section title={`${rows.length} ${rows.length === 1 ? "class" : "classes"}`}>
            <ul className="nreq">
              {rows.map((r) => (
                <li key={r.video} className="nreq__row">
                  <button type="button" className="nreq__main" onClick={() => { haptic("select"); navigate(`/watch/${r.video}`); }}>
                    <b>{r.title || r.video}</b>
                    <small>{r.count} {r.count === 1 ? "request" : "requests"}{r.last ? ` · last ${fmtDate(r.last.slice(0, 10))}` : ""} · {r.video}</small>
                  </button>
                  <button type="button" className="nreq__btn nreq__btn--quiet" aria-label={`Copy the id of ${r.title || r.video}`} onClick={() => copy(r.video)}>Copy id</button>
                  <button type="button" className="nreq__btn nreq__btn--quiet" aria-label={`Mark ${r.title || r.video} done`} disabled={close.isPending} onClick={() => { haptic("select"); close.mutate(r.video); }}>Done</button>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </Screen>
  );
}
