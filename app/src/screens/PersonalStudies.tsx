import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Screen, Icon } from "@/ui/ui";
import { Button } from "@/ui/Button";
import { Feather } from "@/bible/icons";
import { useSheet } from "@/ui/sheet";
import { StudyFooter, headingAt, type WritingTarget } from "@/studies/StudyFooter";
import { StudyFilePicker, StudyNotice } from "@/studies/controls";
import { useBackButton } from "@/tg/hooks";
import { confirm } from "@/tg/sdk";
import { newStudy, importStudy, studyMarkdown, textBlock, type Study, type StudyBlock } from "@/studies/model";
import { deleteStudy, getStudy, listStudies, saveStudy, subscribeStudies } from "@/studies/storage";
import { saveFile } from "@/studies/files";
import "@/studies/studies.css";

export function PersonalStudies() {
  useBackButton();
  const { id } = useParams();
  return id ? <StudyEditor key={id} id={id} /> : <StudyList />;
}
function StudyList() {
  const [studies, setStudies] = useState<Study[]>([]), [query, setQuery] = useState(""), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const load = () => { void listStudies().then(setStudies).catch(() => setError("Study storage is unavailable. Allow site storage to save studies on this device.")).finally(() => setLoading(false)); };
  useEffect(() => { load(); return subscribeStudies(load); }, []);
  const create = async (study = newStudy([textBlock()])) => {
    try { const saved = await saveStudy(study); navigate(`/studies/${saved.id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the study."); }
  };
  const filtered = studies.filter(s => `${s.title} ${s.tags.join(" ")} ${s.blocks.map(b => b.kind === "text" ? b.text : b.kind === "scripture" ? b.reference : b.number).join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  return <Screen title="My studies" className="study-screen"><div className="personal-study">
    <div className="study-intro"><span className="study-eyebrow">Your personal library</span><h2>A place for deeper study.</h2><p>Bring Scripture, word studies and your own observations together.</p>
      <div className="study-toolbar"><Button onClick={() => void create()}><Icon name="plus" size={18} />New study</Button><StudyFilePicker label="Import study" onFile={async file => { try { if (file.size > 2_000_000) throw new Error("Choose a study smaller than 2 MB."); await create(importStudy(await file.text())); } catch (err) { setError(err instanceof Error ? err.message : "Invalid study file."); } }} /></div>
    </div>
    {error && <StudyNotice error>{error}</StudyNotice>}
    {studies.length > 0 && <><label className="study-search"><Icon name="search" size={20} /><span className="sr-only">Find a study</span><input type="search" placeholder="Search titles, tags and writing" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="study-section-heading"><h2>Your studies</h2><span>{filtered.length} {filtered.length === 1 ? "study" : "studies"}</span></div></>}
    <div className="study-library">{filtered.map(s => <Link className="study-entry" key={s.id} to={`/studies/${s.id}`}><span className="study-emblem"><Icon name="note" size={24} /></span><span className="study-entry__body"><strong>{s.title || "Untitled study"}</strong><span>{s.blocks.length} {s.blocks.length === 1 ? "block" : "blocks"} · {new Date(s.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>{s.tags.filter(Boolean).length > 0 && <span className="study-tags">{s.tags.filter(Boolean).slice(0, 3).map((tag, i) => <small key={i}>{tag}</small>)}</span>}</span><Icon name="chevron" size={18} /></Link>)}</div>
    {loading ? <StudyNotice>Loading your studies…</StudyNotice> : error ? null : !studies.length ? <div className="study-empty"><span className="study-emblem"><Icon name="book-open" size={32} /></span><h2>Begin with a passage or a thought.</h2><p>Create your first study above, or select a verse in the Bible and choose <strong>To study</strong>.</p><Link className="study-text-link" to="/read/genesis/1">Open the Bible <Icon name="chevron" size={16} /></Link></div> : !filtered.length && <div className="study-empty"><h2>No studies found</h2><p>Try another title, tag or phrase.</p></div>}
    <p className="study-footnote"><Icon name="shield" size={16} />Saved on this device. Export a copy to keep a backup.</p>
  </div></Screen>;
}

function StudyEditor({ id }: { id: string }) {
  const navigate = useNavigate();
  const [doc, setDoc] = useState<Study>(), [status, setStatus] = useState("Loading…"), [error, setError] = useState(""), [editing, setEditing] = useState(false), [exportError, setExportError] = useState("");
  const [target, setTarget] = useState<WritingTarget | null>(null), [header, setHeader] = useState(0);
  const sheet = useSheet();
  const draft = useRef<Study | undefined>(undefined), saved = useRef<Study | undefined>(undefined), pending = useRef<Promise<void> | null>(null), stopped = useRef(false);
  const persist = async (): Promise<void> => {
    if (pending.current) { await pending.current; if (!stopped.current) return persist(); return; }
    const snapshot = draft.current;
    if (!snapshot || snapshot === saved.current || stopped.current) return;
    setStatus("Saving…");
    pending.current = (async () => {
      try {
        const result = await saveStudy({ ...snapshot, revision: saved.current?.revision ?? snapshot.revision });
        saved.current = result;
        if (draft.current === snapshot) { draft.current = result; setDoc(result); setStatus("Saved on this device"); }
        else setStatus("Unsaved changes");
        setError("");
      } catch (e) { stopped.current = true; setStatus("Not saved"); setError(e instanceof Error ? e.message : "Storage is full or unavailable. Export your draft to keep your work."); }
    })();
    await pending.current; pending.current = null;
  };
  useEffect(() => {
    let active = true;
    void getStudy(id).then(s => { if (!active) return; draft.current = saved.current = s; setDoc(s); setStatus(s ? "Saved on this device" : "Study not found"); }).catch(() => { if (active) setError("This study could not be loaded. Check storage permissions and try again."); });
    const before = (e: BeforeUnloadEvent) => { if (draft.current && draft.current !== saved.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", before);
    return () => { active = false; window.removeEventListener("beforeunload", before); void persist(); };
  }, [id]);
  useEffect(() => { if (!doc || stopped.current) return; const timer = setTimeout(() => void persist(), 500); return () => clearTimeout(timer); }, [doc]);
  const change = (next: Study) => { draft.current = next; setDoc(next); setStatus("Unsaved changes"); };
  const blocks = (next: StudyBlock[]) => { if (doc) change({ ...doc, blocks: next }); };
  const exportDoc = async (format: "json" | "md") => { const current = draft.current; if (!current) return; try { await saveFile(`cyberjudah-study-${id}.${format}`, format === "json" ? JSON.stringify(current, null, 2) : studyMarkdown(current), format === "json" ? "application/json" : "text/markdown"); setExportError(""); } catch { setExportError("The export could not finish. Your draft is still here; please try again."); } };
  // Bible Strong's EditStudyScreen: a study opens to read, with the pencil to write in it; the
  // title is renamed from the header, and the ⋮ holds the rest (EditStudyHeader).
  const rename = async () => { if (!doc) return; const a = await sheet.open({ title: "Rename the study", text: { label: "Study title", value: doc.title, placeholder: "Study name", submit: "Save" } }); if (a?.value !== undefined) change({ ...doc, title: a.value.trim().slice(0, 160) }); };
  const editTags = async () => { if (!doc) return; const a = await sheet.open({ title: "Edit the tags", text: { label: "Tags, separated by commas", value: doc.tags.filter(Boolean).join(", "), submit: "Save" } }); if (a?.value !== undefined) change({ ...doc, tags: a.value.split(",").map(t => t.trim().slice(0, 40)).filter(Boolean).slice(0, 20) }); };
  const remove = async () => { if (!await confirm("Delete this study from this device? Export it first if you want to keep a copy.")) return; await persist(); if (stopped.current) return; try { await deleteStudy(id, saved.current!.revision); stopped.current = true; navigate("/studies"); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete the study."); } };
  const options = async () => {
    const a = await sheet.open({ items: [
      { id: "tags", text: "Edit tags", icon: <Icon name="tag" size={18} /> },
      { id: "rename", text: "Rename", icon: <Icon name="edit-line" size={18} /> },
      { id: "json", text: "Export study", icon: <Icon name="download" size={18} /> },
      { id: "md", text: "Export Markdown", icon: <Icon name="note" size={18} /> },
      { id: "print", text: "Print / PDF", icon: <Icon name="share" size={18} /> },
      { id: "delete", text: "Delete", destructive: true },
    ] });
    if (a?.id === "tags") await editTags();
    else if (a?.id === "rename") await rename();
    else if (a?.id === "json" || a?.id === "md") await exportDoc(a.id);
    else if (a?.id === "print") { setEditing(false); setTimeout(() => window.print(), 100); }
    else if (a?.id === "delete") await remove();
  };
  if (!doc) return <Screen title="My study" className="study-screen"><div className="personal-study"><StudyNotice error={!!error}>{error || status}</StudyNotice><Link to="/studies">All studies</Link></div></Screen>;
  const title = doc.title || "Untitled study";
  const add = (kind: "writing" | "scripture" | "strong") => { if (kind === "writing") { if (doc.blocks.length < 200) blocks([...doc.blocks, textBlock()]); return; } void persist(); navigate(kind === "scripture" ? "/read/genesis/1" : "/lexicon"); };
  const body = <>
    {error && <div className="study-conflict" role="alert"><p>{error}</p><Button appearance="bordered" onClick={async () => { try { const copy = await saveStudy({ ...doc, id: crypto.randomUUID(), revision: 0, title: `${doc.title} (copy)` }); stopped.current = true; navigate(`/studies/${copy.id}`); } catch { setError("The copy could not be saved. Export your draft to keep your work."); } }}>Save draft as a new copy</Button></div>}
    {exportError && <StudyNotice error>{exportError}</StudyNotice>}
    <article className="study-doc">
      {!editing && doc.tags.filter(Boolean).length > 0 ? <div className="study-doc__chips">{doc.tags.filter(Boolean).map((tag, i) => <span key={i}>{tag}</span>)}</div> : null}
      {doc.blocks.map((b, i) => <section key={b.id} className={`study-block study-block--${b.kind}`} aria-label={`Block ${i + 1}`}>
        {editing && <div className="study-block__bar"><span><Icon name={b.kind === "text" ? "compose" : b.kind === "scripture" ? "book-open" : "type"} size={16} />{b.kind === "text" ? "Writing" : b.kind === "scripture" ? "Scripture · KJV" : "Strong’s entry"}</span><div className="study-block__tools"><button type="button" className="study-tool" aria-label={`Move block ${i + 1} up`} title="Move up" disabled={i === 0} onClick={() => { const list = [...doc.blocks]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; blocks(list); }}><Icon name="arrowUp" size={16} /></button><button type="button" className="study-tool" aria-label={`Move block ${i + 1} down`} title="Move down" disabled={i === doc.blocks.length - 1} onClick={() => { const list = [...doc.blocks]; [list[i], list[i + 1]] = [list[i + 1], list[i]]; blocks(list); }}><Icon name="arrowUp" size={16} style={{ transform: "rotate(180deg)" }} /></button><button type="button" className="study-tool" aria-label={`Remove block ${i + 1}`} title="Remove block" onClick={async () => { if (await confirm("Remove this block?")) blocks(doc.blocks.filter(x => x.id !== b.id)); }}><Icon name="trash" size={16} /></button></div></div>}
        {b.kind === "text" ? !editing ? <StudyMarkdown text={b.text} /> : <Writing value={b.text} label={`Writing ${i + 1}`} onFocus={setTarget} onCaret={setHeader} onChange={text => { const cur = draft.current ?? doc; change({ ...cur, blocks: cur.blocks.map(x => x.id === b.id ? { ...x, text } : x) }); }} /> : b.kind === "scripture" ? <><h2><Link to={`/read/${b.book}/${b.chapter}?v=${b.verses[0].verse}`}>{b.reference}<Icon name="open" size={16} /></Link></h2><blockquote>{b.verses.map(v => <p key={v.verse}><sup>{v.verse}</sup> {v.text}</p>)}</blockquote></> : <><h2><Link to={`/lexicon/${b.number}`}>{b.number} · {b.lemma}<Icon name="open" size={16} /></Link></h2><StudyMarkdown text={b.definition} /></>}
      </section>)}
    </article>
    <p className="study-footnote" role="status"><Icon name={status === "Saved on this device" ? "check" : "clock"} size={16} />{status}. Studies save on this device; keep a copy with Export study.</p>
  </>;
  if (editing) return (
    <Screen className="study-screen study-screen--editing">
      <header className="study-edithead"><button type="button" className="study-edithead__done" aria-label="Done" title="Done" onClick={() => { setEditing(false); void persist(); }}><Feather name="check" size={25} color="#2ecc71" /></button></header>
      <div className="personal-study" data-study-editor="">{body}</div>
      <StudyFooter target={target} header={header} onAdd={add} />
    </Screen>
  );
  return (
    <Screen title={<button type="button" className="study-title" onClick={() => void rename()}>{title}</button>} className="study-screen" action={<button type="button" className="icon-btn" aria-label="Study options" title="Study options" aria-haspopup="menu" onClick={() => void options()}><Feather name="more-vertical" size={20} /></button>}>
      <div className="personal-study" data-study-editor="" data-preview="">{body}</div>
      <button type="button" className="study-fab" aria-label="Edit study" title="Edit study" onClick={() => setEditing(true)}><Feather name="edit-2" size={18} color="#fff" raw /></button>
    </Screen>
  );
}

function Writing({ value, onChange, label, onFocus, onCaret }: { value: string; onChange: (s: string) => void; label: string; onFocus: (t: WritingTarget) => void; onCaret: (level: number) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const report = () => { const el = ref.current; if (el) { onFocus({ el, onChange }); onCaret(headingAt(el.value, el.selectionStart)); } };
  return <textarea ref={ref} aria-label={label} rows={9} placeholder="Start writing your observations…" maxLength={40_000} value={value} onFocus={report} onSelect={report} onKeyUp={report} onChange={e => onChange(e.target.value)} />;
}
function StudyMarkdown({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { ALLOWED_TAGS: ["p", "br", "strong", "em", "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "a"], ALLOWED_ATTR: ["href", "title"], ALLOW_DATA_ATTR: false });
  return <div className="study-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}
