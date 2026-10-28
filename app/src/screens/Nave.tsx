import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { NAVE_LANGUAGE, navePath, useNavePage, useNaveTopic, type NaveTopic } from "@/api/nave";
import { Feather } from "@/bible/icons";
import { useTags } from "@/bible/store";
import { TagsPanel } from "@/bible/ui/Editors";
import { ResourceUnavailable } from "@/bible/ui/ResourceUnavailable";
import { paletteOf, useBibleSettings } from "@/bible/settings";
import { cssVars } from "@/bible/theme";
import { useAppTheme } from "@/ui/theme";
import { pushHistory, type HistoryRow } from "@/lib/marks";
import { useEndpointRelations, type EntryEndpoint } from "@/lib/relations";
import { useBackButton, useStored } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { json } from "@/tg/store";
import { AlphabetList, SectionTitle, sections, useHeaderOffset } from "@/ui/alphabet";
import { NaveHTML, naveText } from "@/ui/nave-html";
import { useOpenInNewTab } from "@/ui/open-in-new-tab";
import { useSheet } from "@/ui/sheet";
import { useToast } from "@/ui/toast";
import { Screen, SearchField } from "@/ui/ui";
import { EmptyState } from "./new-tab-search";
import { EntityChipList } from "./tag-detail";
import type { TaggedNave } from "@/lib/tag-items";

function NaveTheme({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  const [settings] = useBibleSettings();
  return <div className="bs-nave-theme" style={cssVars(paletteOf(theme.name, settings))}>{children}</div>;
}

export function Nave() {
  useBackButton();
  const [letter, setLetter] = useState("a");
  const [search, setSearch] = useState("");
  const [settled, setSettled] = useState("");
  useEffect(() => { const timer = setTimeout(() => setSettled(search), 600); return () => clearTimeout(timer); }, [search]);
  const query = useNavePage(NAVE_LANGUAGE, settled, letter);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.topics) ?? [], [query.data]);
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const element = end.current;
    if (!element || !hasNextPage || query.isError) return;
    const observer = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: "0px 0px 50% 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, query.isError, rows.length]);
  const top = useHeaderOffset();
  return (
    <NaveTheme><Screen title="Nave thematic" className="bs-list bs-nave-list" headerChildren={<SearchField id="nave-q" value={search} onChange={setSearch} placeholder="Search by word" autoFocus={false} />}>
      {query.isPending ? <p className="bs-list__loading">Loading...</p> : query.isError ? <ResourceUnavailable onRetry={() => void query.refetch()} /> : rows.length ? (
        <div className="bs-list__body" style={{ ["--section-top" as string]: `${top}px` }}>
          {sections(rows, (r) => r.name).map((section) => <section key={section.title}>
            <SectionTitle color="var(--bs-quint)" ink="white">{section.title.toUpperCase()}</SectionTitle>
            {section.data.map((row) => <Link key={row.normalizedName} className="bs-dictitem bs-nave-item" to={navePath(NAVE_LANGUAGE, row.normalizedName)} onClick={() => haptic("select")}><span>{row.name}</span></Link>)}
          </section>)}
          {hasNextPage ? <div ref={end} className="list-more" /> : null}
        </div>
      ) : <EmptyState icon="word" message="No word found..." />}
      {!search ? <AlphabetList color="var(--bs-quint)" letter={letter} setLetter={setLetter} /> : null}
    </Screen></NaveTheme>
  );
}

export async function naveTagKey(name: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
  return `bs_nv_${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function NaveEntry() {
  useBackButton();
  const { name = "" } = useParams();
  const query = useNaveTopic(NAVE_LANGUAGE, name);
  const key = useQuery({ queryKey: ["nave-tags-key", name], queryFn: () => naveTagKey(name), staleTime: Infinity });
  const item = query.data;
  useEffect(() => {
    if (item) void json.get<HistoryRow[]>("hist", []).then((history) => json.set("hist", pushHistory(history, { type: "nave", slug: item.normalizedName, name: item.name })));
  }, [item]);
  if (query.isPending || key.isPending) return <NaveTheme><Screen title="Nave Topics"><p className="bs-list__loading">Loading...</p></Screen></NaveTheme>;
  if (query.isError || key.isError) return <NaveTheme><Screen title="Nave Topics"><ResourceUnavailable onRetry={() => { void query.refetch(); void key.refetch(); }} /></Screen></NaveTheme>;
  if (!item) return <NaveTheme><Screen title="Nave Topics"><EmptyState icon="inbox" message="Unable to load Nave..." /></Screen></NaveTheme>;
  return <NaveArticle key={name} item={item} storageKey={key.data} />;
}

function NaveArticle({ item, storageKey }: { item: NaveTopic; storageKey: string }) {
  const navigate = useNavigate();
  const sheet = useSheet();
  const toast = useToast();
  const openInNewTab = useOpenInNewTab();
  const [allTags, setAllTags] = useTags();
  const [tagging, setTagging] = useState(false);
  const [record, setRecord, loaded] = useStored<TaggedNave | null>(storageKey, null);
  const path = navePath(NAVE_LANGUAGE, item.normalizedName);
  const endpoint = useMemo<EntryEndpoint>(() => ({ type: "entry", url: path, kind: "nave", label: item.name }), [path, item.name]);
  const { count } = useEndpointRelations(endpoint);
  const relations = () => navigate(`/relations?endpoint=${encodeURIComponent(`entry:${path}`)}&label=${encodeURIComponent(item.name)}`);
  const menu = async () => {
    const action = await sheet.open({ items: [
      { id: "tags", text: "Tags", icon: <Feather name="tag" size={16} /> },
      { id: "share", text: "Share the link", icon: <Feather name="share-2" size={16} /> },
      { id: "copy", text: "Copy the text", icon: <Feather name="copy" size={16} /> },
      { id: "relations", text: "Edit relations", icon: <Feather name="git-merge" size={16} /> },
      { id: "tab", text: "Open in new tab", icon: <Feather name="external-link" size={16} /> },
    ] });
    try {
      if (action?.id === "share") {
        const url = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`, window.location.origin).href;
        if (navigator.share) await navigator.share({ title: item.name, url });
        else { await navigator.clipboard.writeText(url); toast("Copied to the clipboard."); }
      } else if (action?.id === "copy") { await navigator.clipboard.writeText(`${item.name}\n\n${naveText(item.description)}`); toast("Copied to the clipboard."); }
      else if (action?.id === "tags") setTagging(true);
      else if (action?.id === "relations") relations();
      else if (action?.id === "tab") openInNewTab(path);
    } catch { toast("Error while sharing."); }
  };
  return <NaveTheme>
    <Screen title={item.name} kicker={item.normalizedName} className="bs-nave-detail" action={<button type="button" className="icon-btn" aria-label="More options" onClick={() => void menu()}><Feather name="more-vertical" size={18} /></button>}>
      {(record?.tags && Object.keys(record.tags).length) || count ? <div className="bs-nave-chips"><EntityChipList tags={record?.tags} relationCount={count} onRelationPress={relations} /></div> : null}
      {item.description ? <NaveHTML html={item.description} /> : null}
    </Screen>
    <TagsPanel open={tagging && loaded} onClose={() => setTagging(false)} reference={item.name} tags={allTags} setTags={setAllTags} selected={record?.tags ?? {}} onToggle={(id) => {
      if (!loaded) return;
      const tags = { ...record?.tags };
      if (tags[id]) delete tags[id]; else tags[id] = true;
      setRecord({ normalizedName: item.normalizedName, name: item.name, date: record?.date ?? Date.now(), tags });
    }} />
  </NaveTheme>;
}
