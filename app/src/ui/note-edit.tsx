import { useEffect, useMemo, useState, type FocusEvent } from "react";
import { createPortal } from "react-dom";

import type { Note } from "@/api/data";
import { Sheet } from "@/bible/ui/Sheet";
import { useTeachings } from "@/screens/Home";
import { alert, api, app, haptic } from "@/tg/sdk";
import { Segmented } from "@/ui/ui";

/** Every note edit uses the shared review flow and the loaded file SHA. */
type Pair = { from: string; to: string };
export function NoteEditSheet({ open, onClose, note, onSaved, initialSource }: { open: boolean; onClose: () => void; note: Note; initialSource?: { text: string; sha: string }; onSaved: (changed: string[], commit: string, id: string) => void }) {
  const [teacher, setTeacher] = useState(note.teacher ?? "");
  const [title, setTitle] = useState(note.title);
  const [pairs, setPairs] = useState<Pair[]>([{ from: "", to: "" }]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"text" | "quick">("text");
  const [source, setSource] = useState<{ text: string; sha: string } | null>(initialSource ?? null);
  const [draft, setDraft] = useState(initialSource?.text ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !note.file || source) return;
    void api<{ ok: true; text: string; sha: string } | { ok: false; error: string }>(`/api/notes/source?file=${encodeURIComponent(note.file)}`)
      .then((r) => { if (r.ok) { setSource({ text: r.text, sha: r.sha }); setDraft(r.text); } else setLoadError(r.error); })
      .catch((e: Error) => setLoadError(/401/.test(e.message) ? "Your Telegram session has expired. Close CyberJudah and open it again." : "The note's text could not be loaded. Check the connection and try again."));
  }, [open, note.file, source]);
  const teachings = useTeachings();
  const teachers = useMemo(() => { const n = new Map<string, number>(); for (const t of teachings.data ?? []) if (t.teacher) n.set(t.teacher, (n.get(t.teacher) ?? 0) + 1); return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12); }, [teachings.data]);
  const count = (from: string) => (from ? note.body.split(from).length - 1 : 0);
  const changes = { teacher: teacher.trim() !== (note.teacher ?? "").trim(), title: title.trim() && title.trim() !== note.title, replace: pairs.filter((p) => p.from.trim() && p.from !== p.to) };
  const textDirty = !!source && draft !== source.text;
  const dirty = mode === "text" ? textDirty : changes.teacher || changes.title || changes.replace.length > 0;

  const save = async () => {
    if (!dirty || !note.file || !source || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { file: note.file, sha: source.sha, reason };
      if (mode === "text" && source) { body.body = draft; body.sha = source.sha; }
      else {
        if (changes.teacher) body.teacher = teacher.trim();
        if (changes.title) body.title = title.trim();
        if (changes.replace.length) body.replace = changes.replace;
      }
      // The Worker says why an edit was refused; the reason reaches the person, not a generic line.
      const r = await fetch("/api/notes/edit", { method: "POST", headers: { "content-type": "application/json", authorization: `tma ${app?.initData ?? ""}` }, body: JSON.stringify(body) });
      const res = (await r.json().catch(() => null)) as { ok: true; commit: string; changed: string[]; change: { id: string } } | { ok: false; error: string } | null;
      if (r.status === 401) { void alert("Your Telegram session has expired. Close CyberJudah, open it again, and the edit will save."); return; }
      if (!res) { void alert(r.status >= 500 ? "The server is being updated right now. Wait a minute and tap Save again; your changes are still here." : `The edit did not save (${r.status}). Try again in a moment.`); return; }
      if (!res.ok) { void alert(res.error ?? "The edit was refused."); return; }
      haptic("success"); onSaved(res.changed, res.commit, res.change.id);
    } catch { void alert("The edit did not reach the server. Check the connection and try again."); }
    finally { setBusy(false); }
  };

  // Keep the field being typed in above the keyboard, which Telegram lays over the page.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.matches("input, textarea")) setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  };
  // Mounted at the app's root, so no screen or sheet around it can decide its size.
  const host = document.getElementById("root") ?? document.body;
  return createPortal(
    <Sheet open={open} onClose={onClose} height="full" title="Edit this note" subTitle="Saved for review before publication" className="edit-sheet" footer={
      <div className="edit__footer"><button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!dirty || !source || reason.trim().length < 3 || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save for review"}</button></div>
    }>
      <div className="edit" onFocus={onFocus} data-mode={mode}>
        <label className="edit__field"><span>Reason for this edit</span><input value={reason} onChange={e => setReason(e.target.value)} /></label>
        <Segmented label="What to edit" value={mode} onChange={setMode} options={[["text", "Text"], ["quick", "Quick fixes"]]} />
        {mode === "text" ? (
          loadError ? <p className="hint">{loadError}</p>
          : !source ? <p className="hint">Loading the note's text…</p>
          : <>
            <p className="hint">The whole note as it is written. Keep the lines between the <code>---</code> marks at the top; they hold the title, date and teacher.</p>
            <textarea className="edit__text" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck autoCapitalize="sentences" aria-label="The note's text" />
          </>
        ) : <>
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
        </>}
        {!note.file ? <p className="hint">This note has no source file in the library, so it cannot be edited here.</p> : null}
      </div>
    </Sheet>,
    host,
  );
}
