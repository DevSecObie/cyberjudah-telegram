import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useAllNotes, useTags, type Highlight, type Tag } from "@/bible/store";
import { useBackButton } from "@/tg/hooks";
import { confirm, haptic } from "@/tg/sdk";
import { json, store } from "@/tg/store";
import { Empty, Icon, List, Row, Screen, Section } from "@/ui/ui";

/** How many highlights and notes carry each tag, read once from everything kept. */
function useTagCounts() {
  const { rows: notes } = useAllNotes();
  const [hl, setHl] = useState<Record<string, number>>({});
  useEffect(() => {
    void store.keys().then(async (keys) => {
      const out: Record<string, number> = {};
      for (const k of keys.filter((x) => x.startsWith("bs_h_"))) for (const h of Object.values(await json.get<Record<string, Highlight>>(k, {}))) for (const t of Object.keys(h.tags ?? {})) out[t] = (out[t] ?? 0) + 1;
      setHl(out);
    }).catch(() => undefined);
  }, []);
  const nt = useMemo(() => { const out: Record<string, number> = {}; for (const r of notes) for (const t of Object.keys(r.note.tags ?? {})) out[t] = (out[t] ?? 0) + 1; return out; }, [notes]);
  return { hl, nt };
}

/**
 * Tags (Bible Strong's TagsScreen): every tag the reader made, with what carries it;
 * a tag opens to its highlights and notes, can be renamed, and can be deleted.
 */
export function Tags() {
  useBackButton(true);
  const [tags, setTags] = useTags();
  const { hl, nt } = useTagCounts();
  const [adding, setAdding] = useState("");
  const all = Object.values(tags).filter((t): t is Tag => !!t && typeof t.name === "string").sort((a, b) => a.name.localeCompare(b.name));
  const add = () => { const name = adding.trim(); if (!name) return; const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; setTags({ ...tags, [id]: { id, name, date: Date.now() } }); setAdding(""); haptic("success"); };
  return (
    <Screen title="Tags" kicker={all.length ? `${all.length} ${all.length === 1 ? "tag" : "tags"}` : "Sort what you keep"}>
      <form className="tagadd" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="A new tag" aria-label="A new tag" />
        <button type="submit" className="icon-btn" disabled={!adding.trim()} aria-label="Add" title="Add"><Icon name="check" size={18} /></button>
      </form>
      {!all.length ? <Empty title="No tags yet">Tag a highlight or a note from the verse menu, or add one here. A tag gathers everything you kept about one thing.</Empty> : (
        <Section>
          <List>{all.map((t) => { const n = (hl[t.id] ?? 0) + (nt[t.id] ?? 0); return <Row key={t.id} href={`/tags/${t.id}`} icon="tag" title={t.name} sub={n ? [hl[t.id] ? `${hl[t.id]} ${hl[t.id] === 1 ? "highlight" : "highlights"}` : "", nt[t.id] ? `${nt[t.id]} ${nt[t.id] === 1 ? "note" : "notes"}` : ""].filter(Boolean).join(" · ") : "Nothing tagged yet"} />; })}</List>
        </Section>
      )}
    </Screen>
  );
}

/** One tag: rename or delete it, and see what carries it. */
export function TagScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useBackButton(false);
  const [tags, setTags] = useTags();
  const tag = tags[id];
  const [name, setName] = useState(tag?.name ?? "");
  useEffect(() => { if (tag) setName(tag.name); }, [tag]);
  const { hl, nt } = useTagCounts();
  const rename = () => { const n = name.trim(); if (!tag || !n || n === tag.name) return; setTags({ ...tags, [id]: { ...tag, name: n } }); haptic("success"); };
  const remove = async () => {
    if (!tag || !(await confirm(`Delete the tag “${tag.name}”? What it marks stays; only the tag goes.`))) return;
    const next = { ...tags }; delete next[id]; setTags(next);
    // Take the tag off every highlight and note that carried it.
    const keys = await store.keys();
    for (const k of keys.filter((x) => x.startsWith("bs_h_") || x.startsWith("bs_n_"))) {
      const map = await json.get<Record<string, { tags?: Record<string, true> }>>(k, {});
      let changed = false;
      for (const v of Object.values(map)) if (v.tags?.[id]) { delete v.tags[id]; changed = true; }
      if (changed) await json.set(k, map);
    }
    haptic("success"); navigate("/tags", { replace: true });
  };
  if (!tag) return <Screen title="Tag"><Empty title="This tag is gone" action={{ label: "All tags", href: "/tags" }} /></Screen>;
  return (
    <Screen title={tag.name} kicker="Tag">
      <form className="tagadd" onSubmit={(e) => { e.preventDefault(); rename(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Tag name" />
        <button type="submit" className="icon-btn" disabled={!name.trim() || name.trim() === tag.name} aria-label="Rename" title="Rename"><Icon name="check" size={18} /></button>
        <button type="button" className="icon-btn" onClick={() => void remove()} aria-label="Delete tag" title="Delete tag"><Icon name="trash" size={18} /></button>
      </form>
      <Section title="Carries this tag">
        <List>
          <Row href={`/bookmarks?tab=highlights&tag=${id}`} icon="bookmark" title="Highlights" meta={<small>{hl[id] ?? 0}</small>} />
          <Row href={`/bookmarks?tab=notes&tag=${id}`} icon="note" title="Notes" meta={<small>{nt[id] ?? 0}</small>} />
        </List>
      </Section>
      <p className="hint">Tag a verse from the verse menu: select it, then Tag. <Link to="/bookmarks">Everything you kept</Link>.</p>
    </Screen>
  );
}
