import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { Feather } from "@/bible/icons";
import { useTags, type Tag } from "@/bible/store";
import { queryTagList, TAG_LIST_SORTS, type TagListSort } from "@/lib/entity-list";
import { loadTagData, removeTagEverywhere, tagCounts, tagTabPaths, type TagCounts, type TagData } from "@/lib/tag-items";
import { groupsNow, groupWithTabs, MAX_GROUPS } from "@/lib/tabs";
import { goBack, useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { confirmDelete, ContextualPanel, FiltersButton, PanelAction, PanelSearch, PanelTextForm } from "@/ui/panel";
import { useSheet } from "@/ui/sheet";
import { moveTab } from "@/ui/tab-motion";
import { useToast } from "@/ui/toast";
import { Screen } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { TagSections } from "./tag-detail";

type Loaded = Record<string, TagData & { highlightVerses: number }>;
/** Everything tagged, read once and again after a change. */
function useTagData() {
  const [data, setData] = useState<Loaded>({});
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => { void loadTagData().then(setData).catch(() => undefined).finally(() => setLoaded(true)); }, []);
  useEffect(reload, [reload]);
  return { data, loaded, reload };
}

/** Bible Strong's tagListQueryAtom (`entityListFilters.tags.v1`): the search and the order, kept between visits. */
const QUERY_KEY = "cj:entityListFilters.tags.v1";
type TagQuery = { query: string; sort: TagListSort };
const DEFAULT_QUERY: TagQuery = { query: "", sort: "name-asc" };
function readQuery(): TagQuery {
  try {
    const v = JSON.parse(localStorage.getItem(QUERY_KEY) ?? "null") as Partial<TagQuery> | null;
    if (!v || typeof v !== "object") return DEFAULT_QUERY;
    return { query: typeof v.query === "string" ? v.query : "", sort: TAG_LIST_SORTS.some(([s]) => s === v.sort) ? v.sort as TagListSort : DEFAULT_QUERY.sort };
  } catch { return DEFAULT_QUERY; }
}
function useTagQuery(): [TagQuery, (next: TagQuery) => void] {
  const [q, setQ] = useState(readQuery);
  return [q, (next) => { setQ(next); try { localStorage.setItem(QUERY_KEY, JSON.stringify(next)); } catch { /* private mode */ } }];
}

const confirmRemove = (confirmLabel: string) => confirmDelete("Are you sure you want to delete this tag?", confirmLabel);

/**
 * Bible Strong's useCreateTabGroupFromTag: a new group named after the tag, a tab for each thing it
 * carries (or one Bible tab when it carries nothing), then that group's first tab and a toast.
 */
export function useCreateTabGroupFromTag() {
  const navigate = useNavigate();
  const toast = useToast();
  return (tag: Tag, data: TagData | undefined) => {
    if (groupsNow().length >= MAX_GROUPS) { toast("Group limit reached", { tone: "error" }); return false; }
    const paths = tagTabPaths(data);
    if (!paths.length) paths.push("/read/genesis/1");
    moveTab(() => {
      const first = groupWithTabs(tag.name, paths);
      if (!first) return false;
      navigate(first, { replace: true });
    }, "slide");
    toast(`Group created with ${paths.length} tabs`, { tone: "success" });
    return true;
  };
}

/** Bible Strong's TagItem chips: what the tag carries, one small grey chip per kind. */
function chips(c: TagCounts) {
  const out: string[] = [];
  const highlights = c.highlights + c.wordAnnotations;
  if (highlights) out.push(`${highlights} ${highlights === 1 ? "highlight" : "highlights"}`);
  if (c.notes) out.push(`${c.notes} ${c.notes === 1 ? "note" : "notes"}`);
  if (c.links) out.push(`${c.links} ${c.links === 1 ? "link" : "links"}`);
  if (c.naves) out.push(`${c.naves} ${c.naves === 1 ? "Nave" : "Naves"}`);
  return out;
}

/** Bible Strong's TagOptionsPanel: Edit (rename, in the panel), Create tab group, Remove. */
function TagOptions({ tag, data, loaded, onRename, onRemove }: { tag: Tag; data: TagData | undefined; loaded: boolean; onRename: (name: string) => void; onRemove: () => void }) {
  const createGroup = useCreateTabGroupFromTag();
  return (
    <ContextualPanel triggerSize={54} trigger={<Feather name="more-vertical" size={20} />} label="More options" initialScreen="actions" screens={{
      actions: {
        title: "Tags",
        content: (nav) => (
          <>
            <PanelAction nested icon="edit-3" label="Edit" onPress={() => nav.open("rename")} />
            <PanelAction icon="layers" label="Create tab group" onPress={() => { nav.close(); if (loaded) createGroup(tag, data); }} />
            <PanelAction icon="trash-2" destructive label="Remove" onPress={() => { nav.close(); void confirmRemove("Remove").then((ok) => { if (ok) onRemove(); }); }} />
          </>
        ),
      },
      rename: { title: "Rename tag", content: (nav) => <PanelTextForm initialValue={tag.name} label="Tag name" onSave={(name) => { onRename(name); nav.close(); }} /> },
    }} />
  );
}

/**
 * Tags (Bible Strong's TagsScreen): the filter button for Search and Order, a row per tag with
 * what it carries and its options, and + for a new tag.
 */
export function Tags() {
  useBackButton();
  const sheet = useSheet();
  const [tags, setTags] = useTags();
  const { data, loaded, reload } = useTagData();
  const [q, setQ] = useTagQuery();
  const rows = useMemo(() => Object.values(tags).filter((t): t is Tag => !!t?.id && typeof t.name === "string").map((tag) => {
    const counts = tagCounts(data[tag.id]);
    return { id: tag.id, title: tag.name, itemCount: counts.itemCount, counts, tag };
  }), [tags, data]);
  const shown = queryTagList(rows, q);
  const rename = (tag: Tag, name: string) => setTags({ ...tags, [tag.id]: { ...tag, name } });
  const remove = async (tag: Tag) => {
    await removeTagEverywhere(tag.id);
    const next = { ...tags }; delete next[tag.id]; setTags(next);
    reload();
  };
  const add = async () => {
    const a = await sheet.open({ title: "New tag", text: { label: "Tag name", placeholder: "Tag name", submit: "Save" } });
    if (a?.id !== "text" || !a.value) return;
    const id = `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setTags({ ...tags, [id]: { id, name: a.value, date: Date.now() } });
  };
  const sortLabel = TAG_LIST_SORTS.find(([s]) => s === q.sort)?.[1] ?? "Name A–Z";
  return (
    <Screen title="Tags" className="tagsscreen" action={<FiltersButton onReset={() => setQ(DEFAULT_QUERY)} filters={[
      { key: "search", icon: "search", label: "Search", value: q.query.trim() || undefined, active: !!q.query.trim(), content: () => <PanelSearch value={q.query} onChange={(query) => setQ({ ...q, query })} placeholder="Search a tag" /> },
      { key: "sort", icon: "list", label: "Order", value: sortLabel, active: q.sort !== DEFAULT_QUERY.sort, options: TAG_LIST_SORTS.map(([s, label]) => ({ key: s, label, selected: q.sort === s, onSelect: () => setQ({ ...q, sort: s }) })) },
    ]} />}>
      {shown.length ? (
        <div className="tagsscreen__list">
          {shown.map((r) => (
            <div key={r.id} className="tagitem">
              <div className="tagitem__row">
                <Link to={`/tags/${r.id}`} className="tagitem__link" onClick={() => haptic("select")}>
                  <b>{r.title}</b>
                  <span className="tagitem__chips">{chips(r.counts).map((c) => <span key={c} className="tagitem__chip">{c}</span>)}</span>
                </Link>
                <TagOptions tag={r.tag} data={data[r.id]} loaded={loaded} onRename={(name) => rename(r.tag, name)} onRemove={() => void remove(r.tag)} />
              </div>
            </div>
          ))}
        </div>
      ) : <EmptyState icon="tag" message={rows.length ? `No results found for "${q.query}"` : "No Tag..."} />}
      {/* Bible Strong's FabButton: 50 px, round, in the accent, 30 px in from the corner. */}
      <button type="button" className="study-fab" aria-label="Add tag" title="Add tag" onClick={() => void add()}><Feather name="plus" size={18} color="#fff" /></button>
    </Screen>
  );
}

/** One tag (Bible Strong's TagScreen): its name and menu (Edit, Create tab group, Remove), then what it carries. */
export function TagScreen() {
  const { id = "" } = useParams();
  useBackButton();
  const sheet = useSheet();
  const [tags, setTags] = useTags();
  const tag = tags[id];
  const { data, loaded } = useTagData();
  const createGroup = useCreateTabGroupFromTag();
  const counts = tagCounts(data[id]);
  const menu = async () => {
    if (!tag) return;
    const a = await sheet.open({ title: tag.name, items: [{ id: "edit", text: "Edit", icon: <Feather name="edit-3" size={18} /> }, { id: "create-group", text: "Create tab group", icon: <Feather name="layers" size={18} /> }, { id: "delete", text: "Remove", destructive: true }] });
    if (a?.id === "edit") {
      const r = await sheet.open({ title: "Rename tag", text: { label: "Tag name", value: tag.name, placeholder: "Tag name", submit: "Save" } });
      if (r?.id === "text" && r.value) setTags({ ...tags, [id]: { ...tag, name: r.value } });
    }
    if (a?.id === "create-group" && loaded) createGroup(tag, data[id]);
    if (a?.id === "delete" && await confirmRemove("Yes")) {
      await removeTagEverywhere(id);
      const next = { ...tags }; delete next[id]; setTags(next);
      goBack();
    }
  };
  if (!tag) return <Screen title="" className="tagpage"><EmptyState icon="tag" message="This tag doesn't exist..." /></Screen>;
  return (
    <Screen title={tag.name} className="tagpage" action={<button type="button" className="panel-trigger" style={{ width: 54, height: 54 }} aria-label="More options" title="More options" onClick={() => void menu()}><Feather name="more-vertical" size={18} /></button>}>
      {/* Nothing until what it carries is read, so an empty tag's message never flashes for a full one. */}
      {!loaded ? null : counts.itemCount ? <TagSections d={data[id]} /> : <div className="tagd-empty"><EmptyState icon="tag" message="You have not recorded anything with this label ..." /></div>}
    </Screen>
  );
}
