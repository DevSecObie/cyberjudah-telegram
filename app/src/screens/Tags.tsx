import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import { Sheet } from "@/bible/ui/Sheet";
import { paletteOf, resolveTheme, telegramScheme, useBibleSettings } from "@/bible/settings";
import { useTags, uuid, verseToReference, type Tag } from "@/bible/store";
import { useBackButton, useStored } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { store } from "@/tg/store";
import { subscribeStudies } from "@/studies/storage";
import { Empty, Icon, List, Row, Screen, SearchField, Section } from "@/ui/ui";
import { useSheet } from "@/ui/sheet";
import { DEFAULT_TAG_QUERY, TAG_SORTS, itemsForTag, normalizeTagQuery, queryTags, type TaggedItem } from "@/lib/tag-list";
import { deleteTagEverywhere, readTagInventory } from "@/lib/tag-storage";
import { parseVerseKey } from "@/lib/relations";
import { timeAgo } from "./tab-groups";
import "./tags.css";

function useTagInventory() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["tag-inventory"], queryFn: readTagInventory });
  useEffect(() => {
    let live = true;
    const refresh = () => { void client.invalidateQueries({ queryKey: ["tag-inventory"] }); };
    const off = [subscribeStudies(refresh)];
    void store.keys().then(keys => {
      if (!live) return;
      for (const key of keys.filter(key => /^bs_[hnl]_.+_\d+$/.test(key))) off.push(store.subscribe(key, refresh));
      refresh();
    }).catch(() => undefined);
    return () => { live = false; off.forEach(stop => stop()); };
  }, [client]);
  return query;
}

function useTagActions(onDeleted?: () => void) {
  const [tags, setTags] = useTags();
  const sheet = useSheet();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const edit = async (tag?: Tag) => {
    const answer = await sheet.open({ title: tag ? "Rename tag" : "New tag", text: { label: "Tag name", value: tag?.name, submit: "Save" } });
    if (answer?.id !== "text" || !answer.value?.trim()) return;
    const id = tag?.id ?? `t_${uuid()}`;
    setTags({ ...tags, [id]: { id, name: answer.value.trim(), date: tag?.date ?? Date.now() } });
    haptic("success");
  };
  const options = async (tag: Tag) => {
    const answer = await sheet.open({ title: tag.name, items: [{ id: "edit", text: "Edit", icon: <Feather name="edit-3" size={18} /> }, { id: "delete", text: "Delete", icon: <Feather name="trash-2" size={18} />, destructive: true }] });
    if (answer?.id === "edit") return edit(tag);
    if (answer?.id !== "delete") return;
    const confirmed = await sheet.open({ title: "Warning: Are you sure you want to delete this tag?", items: [{ id: "no", text: "No" }, { id: "yes", text: "Yes", destructive: true }] });
    if (confirmed?.id !== "yes") return;
    try {
      setError("");
      await deleteTagEverywhere(tag.id);
      await client.invalidateQueries({ queryKey: ["tag-inventory"] });
      haptic("success"); onDeleted?.();
    } catch { setError("This tag could not be deleted. Try again."); }
  };
  return { edit, options, error };
}

/** 27.2.0 TagsScreen: search, name/count sorting and counts for supported tagged kinds. */
export function Tags() {
  useBackButton();
  const [tags] = useTags();
  const inventory = useTagInventory();
  const [saved, save] = useStored("tag-list-query", DEFAULT_TAG_QUERY);
  const state = normalizeTagQuery(saved);
  const actions = useTagActions();
  const sheet = useSheet();
  const [searchOpen, setSearchOpen] = useState(false);
  const activeCount = Number(!!state.query.trim()) + Number(state.sort !== "name-asc");
  const rows = queryTags(Object.values(tags).filter(tag => tag && typeof tag.name === "string"), inventory.data ?? [], state);
  const sort = async () => {
    const answer = await sheet.open({ title: "Order", items: TAG_SORTS.map(([id, text]) => ({ id, text, icon: state.sort === id ? <Icon name="check" size={18} /> : undefined })) });
    if (answer && TAG_SORTS.some(([id]) => id === answer.id)) save(normalizeTagQuery({ ...state, sort: answer.id }));
  };
  const filters = async () => {
    const answer = await sheet.open({ title: "Filters", items: [
      { id: "search", text: "Search", hint: state.query.trim() || undefined, icon: <Feather name="search" size={20} /> },
      { id: "order", text: "Order", hint: TAG_SORTS.find(([id]) => id === state.sort)?.[1], icon: <Feather name="list" size={20} /> },
      ...(activeCount ? [{ id: "reset", text: "Reset" }] : []),
    ] });
    if (answer?.id === "search") setSearchOpen(true);
    if (answer?.id === "order") void sort();
    if (answer?.id === "reset") save(DEFAULT_TAG_QUERY);
  };
  return <Screen title="Tags" className="tag-screen" action={<button type="button" className="tag-screen__filter" aria-label={activeCount ? `${activeCount} active filters` : "Filter"} onClick={() => void filters()}>{activeCount ? <span>{activeCount === 1 ? <Feather name={state.query.trim() ? "search" : "list"} size={14} /> : activeCount}<Feather name="chevron-down" size={13} /></span> : <Icon name="filter" size={20} />}</button>}>
    <Sheet open={searchOpen} onClose={() => setSearchOpen(false)} title="Search" headerChildren={<div className="tag-screen__search"><SearchField id="tag-search" value={state.query} onChange={query => save({ ...state, query })} onSubmit={() => setSearchOpen(false)} placeholder="Search a tag" autoFocus /></div>}><></></Sheet>
    {actions.error ? <p role="alert">{actions.error}</p> : null}
    {inventory.isError ? <Empty title="Tags could not be loaded" action={{ label: "Retry", onClick: () => void inventory.refetch() }} /> : !rows.length ? <Empty title={Object.keys(tags).length ? `No results found for "${state.query}"` : "No Tag..."} /> :
      <List>{rows.map(row => <div className="tag-screen__row" key={row.id}>
        <Row href={`/tags/${row.id}`} title={row.title} sub={<span className="tag-screen__chips">{Object.entries(row.counts).filter(([, count]) => count > 0).map(([kind, count]) => <span key={kind}>{count} {count === 1 ? kind.slice(0, -1) : kind}</span>)}</span>} trailing={<></>} />
        <button type="button" className="tag-screen__options" aria-label={`Options for ${row.title}`} onClick={() => void actions.options(row.tag)}><Feather name="more-vertical" size={18} /></button>
      </div>)}</List>}
    <button type="button" className="tag-screen__add" aria-label="Add tag" title="Add tag" onClick={() => void actions.edit()}><Feather name="plus" size={24} /></button>
  </Screen>;
}

export function TagScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useBackButton();
  const [tags, , loaded] = useTags();
  const [settings] = useBibleSettings();
  const palette = paletteOf(resolveTheme(settings, telegramScheme()), settings);
  const tag = tags[id];
  const actions = useTagActions(() => navigate("/tags", { replace: true }));
  const inventory = useTagInventory();
  const [expanded, setExpanded] = useState<string[]>([]);
  const items = itemsForTag(inventory.data ?? [], id);
  const sections = [
    { id: "highlights", title: "Highlights", icon: "edit-3" as const, items: items.filter(item => item.kind === "highlight" || item.kind === "word") },
    { id: "notes", title: "Notes", icon: "file-text" as const, items: items.filter(item => item.kind === "note") },
    { id: "links", title: "Links", icon: "link" as const, items: items.filter(item => item.kind === "link") },
  ].filter(section => section.items.length);
  if (!tag) return <Screen title="Tag">{loaded ? <Empty title="This tag doesn't exist..." /> : null}</Screen>;
  return <Screen title={tag.name} className="tag-screen" action={<button type="button" className="tag-screen__options" aria-label={`Options for ${tag.name}`} onClick={() => void actions.options(tag)}><Feather name="more-vertical" size={18} /></button>}>
    {actions.error ? <p role="alert">{actions.error}</p> : null}
    {inventory.isError ? <Empty title="Tags could not be loaded" action={{ label: "Retry", onClick: () => void inventory.refetch() }} /> : inventory.isPending ? null : !sections.length ? <Empty title="You have not recorded anything with this label ..." /> : sections.map(section => <Section key={section.id}>
      <button type="button" className="tag-screen__section" aria-expanded={expanded.includes(section.id)} onClick={() => setExpanded(current => current.includes(section.id) ? current.filter(value => value !== section.id) : [...current, section.id])}>
        <Feather name={section.icon} size={18} color={section.id === "highlights" ? palette.color1 : section.id === "notes" ? palette.color2 : "var(--bs-tertiary)"} />
        <span>{section.title}</span><b>{section.items.length}</b><Feather name={expanded.includes(section.id) ? "chevron-up" : "chevron-down"} size={17} />
      </button>
      {expanded.includes(section.id) ? <List>{section.items.map(item => <TagItem key={item.id} item={item} tagName={tag.name} />)}</List> : null}
    </Section>)}
  </Screen>;
}

function TagItem({ item, tagName }: { item: TaggedItem; tagName: string }) {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const first = parseVerseKey(item.references[0]);
  const chapter = useQuery({ queryKey: ["chapter", first?.slug, first?.chapter], queryFn: () => data.chapter(first!.slug, first!.chapter), enabled: item.kind === "highlight" && !!first, staleTime: Infinity });
  const reference = verseToReference(item.references, slug => books.data?.find(book => book.slug === slug)?.book ?? slug);
  const description = item.kind === "highlight" ? chapter.data?.verses.filter(verse => item.references.includes(`${first!.slug}-${first!.chapter}-${verse.verse}`)).map(verse => verse.text).join(" ") : item.description;
  return <div className={`tag-screen__item tag-screen__item--${item.kind}`}>
    <Row href={first ? `/read/${first.slug}/${first.chapter}?v=${first.verse}` : undefined} title={item.title || reference} meta={`${reference} · ${timeAgo(item.date, Date.now())}`} sub={<><span>{item.url || description?.slice(0, 100)}</span><span className="tag-screen__chips"><span>{tagName}</span></span></>} trailing={<></>} />
  </div>;
}
