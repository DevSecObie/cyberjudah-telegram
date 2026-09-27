import { useMemo, useState } from "react";

import type { Note } from "@/api/data";
import { Sheet } from "@/bible/ui/Sheet";
import { useTeachings } from "@/screens/Home";
import { alert, app, haptic } from "@/tg/sdk";

/**
 * Editing a note from the app: the teacher's name, the title, and spelling fixes (every
 * occurrence of a word or phrase becomes another). Saving is one commit to the library;
 * the site and the app pick it up when it rebuilds, a few minutes later.
 */
type Pair = { from: string; to: string };
export function NoteEditSheet({ open, onClose, note, onSaved }: { open: boolean; onClose: () => void; note: Note; onSaved: (changed: string[], commit: string) => void }) {
  const [teacher, setTeacher] = useState(note.teacher ?? "");
  const [title, setTitle] = useState(note.title);
  const [pairs, setPairs] = useState<Pair[]>([{ from: "", to: "" }]);
  const [busy, setBusy] = useState(false);
  const teachings = useTeachings();
  const teachers = useMemo(() => { const n = new Map<string, number>(); for (const t of teachings.data ?? []) if (t.teacher) n.set(t.teacher, (n.get(t.teacher) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12); }, [teachings.data]);
  const count = (from: string) => (from ? note.body.split(from).length - 1 : 0);
  const changes = { teacher: teacher.trim() !== (note.teacher ?? "").trim(), title: title.trim() && title.trim() !== note.title, replace: pairs.filter((p) => p.from.trim() && p.from !== p.to) };
  const dirty = changes.teacher || changes.title || changes.replace.length > 0;

  const save = async () => {
    if (!dirty || !note.file) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { file: note.file };
      if (changes.teacher) body.teacher = teacher.trim();
      if (changes.title) body.title = title.trim();
      if (changes.replace.length) body.replace = changes.replace;
      // The Worker says why an edit was refused; the reason reaches the person, not a generic line.
      const r = await fetch("/api/notes/edit", { method: "POST", headers: { "content-type": "application/json", authorization: `tma ${app?.initData ?? ""}` }, body: JSON.stringify(body) });
      const res = (await r.json().catch(() => null)) as { ok: true; commit: string; changed: string[] } | { ok: false; error: string } | null;
      if (r.status === 401) { void alert("Your Telegram session has expired. Close CyberJudah, open it again, and the edit will save."); return; }
      if (!res) { void alert(r.status >= 500 ? "The server is being updated right now. Wait a minute and tap Save again; your changes are still here." : `The edit did not save (${r.status}). Try again in a moment.`); return; }
      if (!res.ok) { void alert(res.error ?? "The edit was refused."); return; }
      haptic("success"); onSaved(res.changed, res.commit);
    } catch { void alert("The edit did not reach the server. Check the connection and try again."); }
    finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={onClose} height="full" title="Edit this note" subTitle="Saved as a commit to the library" className="edit-sheet" footer={
      <div className="edit__footer"><button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>
    }>
      <div className="edit">
        <label className="edit__field"><span>Teacher</span><input type="text" value={teacher} placeholder="Who taught this class" onChange={(e) => setTeacher(e.target.value)} /></label>
        {teachers.length ? <div className="edit__chips">{teachers.map((t) => <button key={t} type="button" className="chip" aria-pressed={t === teacher} onClick={() => setTeacher(t)}><span>{t}</span></button>)}</div> : null}
        <label className="edit__field"><span>Title</span><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <p className="edit__label">Spelling and wording</p>
        <p className="hint">Every occurrence of the left side becomes the right side, front matter included.</p>
        {pairs.map((p, i) => (
          <div key={i} className="edit__pair">
            <input type="text" value={p.from} placeholder="Find" onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <span className="edit__arrow">→</span>
            <input type="text" value={p.to} placeholder="Replace with" onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <small className={count(p.from) ? "" : "edit__none"}>{p.from ? `${count(p.from)}×` : ""}</small>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setPairs([...pairs, { from: "", to: "" }])}>+ Another fix</button>
        {!note.file ? <p className="hint">This note has no source file in the library, so it cannot be edited here.</p> : null}
      </div>
    </Sheet>
  );
}
