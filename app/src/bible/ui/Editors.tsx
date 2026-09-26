import { useEffect, useState } from "react";

import { confirm, haptic } from "@/tg/sdk";
import { Feather, Ion } from "../icons";
import { DEFAULT_BOOKMARK_COLOR, MAX_BOOKMARKS, detectLinkType, type Bookmark, type Tag } from "../store";
import { Button, Checkbox, Sheet } from "./Sheet";

/**
 * The editors the selected-verses sheet opens: the bookmark sheet (BookmarkModal), the tags
 * panel (useEntityTagsScreen), the note editor (NoteEditorDOM's title and description) and
 * the link editor (BibleLinkScreen).
 */
export function BookmarkSheet({ open, onClose, reference, location, existing, bookmarks, setBookmarks, formatReference }: {
  open: boolean; onClose: () => void; reference: string; location: { book: string; chapter: number; verse?: number }; existing?: Bookmark; bookmarks: Bookmark[]; setBookmarks: (b: Bookmark[]) => void; formatReference: (b: Bookmark) => string;
}) {
  const [mode, setMode] = useState<"select" | "create" | "edit">("create");
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_BOOKMARK_COLOR);
  useEffect(() => {
    if (!open) return;
    if (existing) { setMode("edit"); setName(existing.name); setColor(existing.color); }
    else { setMode(bookmarks.length ? "select" : "create"); setName(""); setColor(DEFAULT_BOOKMARK_COLOR); }
  }, [open, existing, bookmarks.length]);
  const defaultName = `Bookmark ${bookmarks.length + 1}`;
  const save = () => {
    const n = name.trim() || defaultName;
    if (existing) setBookmarks(bookmarks.map((b) => (b.id === existing.id ? { ...b, name: n, color } : b)));
    else { if (bookmarks.length >= MAX_BOOKMARKS) { haptic("warning"); return; } setBookmarks([...bookmarks, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: n, color, book: location.book, chapter: location.chapter, ...(location.verse !== undefined ? { verse: location.verse } : {}), date: Date.now() }]); }
    haptic("success"); onClose();
  };
  const move = (b: Bookmark) => { setBookmarks(bookmarks.map((x) => (x.id === b.id ? { ...x, book: location.book, chapter: location.chapter, verse: location.verse } : x))); haptic("success"); onClose(); };
  const remove = async () => { if (!existing) return; if (await confirm("Are you sure you want to delete this bookmark?")) { setBookmarks(bookmarks.filter((b) => b.id !== existing.id)); onClose(); } };
  const COLORS = ["#cc0000", "#e17055", "#fdcb6e", "#00b894", "#0984e3", "#6c5ce7", "#fd79a8", "#2d3436"];
  return (
    <Sheet open={open} onClose={onClose} title="Bookmark" subTitle={reference} footer={mode === "select" ? undefined : <div className="bs-sheet__actions">{existing ? <Button reverse onClick={() => void remove()}>Remove</Button> : null}<Button onClick={save}>Save</Button></div>}>
      {mode === "select" ? (
        <div className="bs-bmselect">
          <b>Move an existing bookmark</b>
          {bookmarks.map((b) => <button key={b.id} type="button" className="bs-bmitem" onClick={() => move(b)}><Ion name="bookmark" size={18} color={b.color} /><span><b>{b.name}</b><small>{formatReference(b)}</small></span></button>)}
          <Button onClick={() => { setMode("create"); setName(""); setColor(DEFAULT_BOOKMARK_COLOR); }}>Create a new bookmark</Button>
          <small className="bs-bmcount">Bookmarks: {bookmarks.length}/{MAX_BOOKMARKS}</small>
        </div>
      ) : (
        <div className="bs-bmform">
          <div className="bs-bmform__row"><Ion name="bookmark" size={24} color={color} /><input className="bs-input" placeholder={defaultName} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Bookmark name" /></div>
          <div className="bs-coloredit__grid" role="radiogroup" aria-label="Color">{COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} style={{ background: c, boxShadow: color === c ? "0 0 0 3px var(--bs-reverse), 0 0 0 5px var(--bs-primary)" : undefined }} onClick={() => setColor(c)} />)}</div>
          <label className="bs-coloredit__hex">Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><span>{color}</span></label>
        </div>
      )}
    </Sheet>
  );
}

/** "Edit tags": a search field, the tags as checkbox rows, and "Create « x »" for a new one. */
export function TagsPanel({ open, onClose, reference, tags, setTags, selected, onToggle }: { open: boolean; onClose: () => void; reference?: string; tags: Record<string, Tag>; setTags: (t: Record<string, Tag>) => void; selected: Record<string, true>; onToggle: (tagId: string) => void }) {
  const [q, setQ] = useState("");
  useEffect(() => { if (!open) setQ(""); }, [open]);
  const all = Object.values(tags).filter((t) => t && typeof t.name === "string").sort((a, b) => a.name.localeCompare(b.name));
  const matches = all.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const canCreate = !!q.trim() && !all.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  const create = () => { const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; setTags({ ...tags, [id]: { id, name: q.trim(), date: Date.now() } }); onToggle(id); setQ(""); };
  return (
    <Sheet open={open} onClose={onClose} title="Edit tags" subTitle={reference} height="half">
      <div className="bs-tags">
        <div className="bs-search"><Feather name="search" size={16} color="var(--bs-grey)" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search tags" /></div>
        {matches.map((t) => <button key={t.id} type="button" role="checkbox" aria-checked={!!selected[t.id]} className="bs-tagrow" onClick={() => { haptic("select"); onToggle(t.id); }}><Checkbox checked={!!selected[t.id]} /><span>{t.name}</span></button>)}
        {canCreate ? <button type="button" className="bs-tagrow bs-tagrow--create" onClick={create}><Feather name="plus" size={18} color="var(--bs-primary)" /><span>Create « {q.trim()} »</span></button> : null}
        {!matches.length && !canCreate ? <p className="bs-loading">No tags yet. Type a name to create one.</p> : null}
      </div>
    </Sheet>
  );
}

/** The note editor: "Title (optional)" and "Description", Cancel / Save, Remove when editing. */
export function NoteSheet({ open, onClose, reference, initial, onSave, onRemove }: { open: boolean; onClose: () => void; reference: string; initial?: { title: string; description: string }; onSave: (v: { title: string; description: string }) => void; onRemove?: () => void }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  useEffect(() => { if (open) { setTitle(initial?.title ?? ""); setDesc(initial?.description ?? ""); } }, [open, initial]);
  return (
    <Sheet open={open} onClose={onClose} height="full" title="Note" subTitle={reference} footer={<div className="bs-sheet__actions">{onRemove ? <Button reverse onClick={async () => { if (await confirm("Are you sure you want to delete this note?")) onRemove(); }}>Remove</Button> : null}<Button reverse onClick={onClose}>Cancel</Button><Button onClick={() => onSave({ title: title.trim(), description: desc.trim() })} disabled={!title.trim() && !desc.trim()}>Save</Button></div>}>
      <div className="bs-noteeditor">
        <input className="bs-noteeditor__title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label="Title" />
        <textarea className="bs-noteeditor__desc" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={3000} aria-label="Description" autoFocus />
      </div>
    </Sheet>
  );
}

/** "Add a link": the URL and a title; the type (YouTube, X, …) follows the URL. */
export function LinkSheet({ open, onClose, reference, onSave }: { open: boolean; onClose: () => void; reference: string; onSave: (v: { url: string; title: string; linkType: string }) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  useEffect(() => { if (open) { setUrl(""); setTitle(""); } }, [open]);
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  const type = detectLinkType(url.trim());
  return (
    <Sheet open={open} onClose={onClose} title="Add a link" subTitle={reference} footer={<div className="bs-sheet__actions"><Button reverse onClick={onClose}>Cancel</Button><Button disabled={!valid} onClick={() => onSave({ url: url.trim(), title: title.trim() || (() => { try { return new URL(url.trim()).hostname.replace(/^www\./, ""); } catch { return "Untitled link"; } })(), linkType: type })}>Save</Button></div>}>
      <div className="bs-linkform">
        <label>Link URL<input className="bs-input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoFocus /></label>
        <label>Title<input className="bs-input" placeholder="Untitled link" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
        <small className="bs-linkform__type">Type: {type}</small>
      </div>
    </Sheet>
  );
}
