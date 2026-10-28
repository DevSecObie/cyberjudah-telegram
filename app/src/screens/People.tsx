import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { data, type PersonIndexRow } from "@/api/data";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { useHeaderOffset } from "@/ui/alphabet";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { FiltersButton } from "@/ui/panel";
import { Empty, Screen, SearchField } from "@/ui/ui";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ']/g, "").toLowerCase();

const ORDERS = [["most", "Most spoken of"], ["az", "A to Z"]] as const;
const PAGE = 60;

/**
 * Every named person in the Bible (rebuilt from the KJV with Apocrypha) as Bible
 * Strong's CommentaryLibraryScreen: the title with the filter button (the order), the search field
 * under it, then a CommentaryLibraryItem per person, their portrait, their name and who they were.
 * Searched by name, or the most spoken of first; long lists draw as their end comes into view.
 */
export function People() {
  useBackButton();
  const [q, setQ] = useVisitState("q", "");
  const [debounced, setDebounced] = useState(() => fold(q.trim()));
  useEffect(() => { const t = setTimeout(() => setDebounced(fold(q.trim())), 150); return () => clearTimeout(t); }, [q]);
  const [order, setOrder] = useVisitState<"most" | "az">("order", "most");
  const [limit, setLimit] = useVisitState("limit", PAGE);
  const people = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  useKeptScroll(!!people.data);
  const top = useHeaderOffset();
  const rows = useMemo(() => {
    const all = people.data ?? [];
    const hits = debounced ? all.filter((p) => fold(p.name).includes(debounced) || p.names.some((n) => fold(n).includes(debounced))).sort((a, b) => Number(fold(b.name).startsWith(debounced)) - Number(fold(a.name).startsWith(debounced)) || b.verses - a.verses) : [...all];
    if (!debounced) hits.sort(order === "most" ? (a, b) => b.verses - a.verses || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
    return hits;
  }, [people.data, debounced, order]);
  const end = useRef<HTMLDivElement>(null);
  const more = rows.length > limit;
  useEffect(() => {
    const el = end.current; if (!el || !more) return;
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) setLimit((n) => n + PAGE); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]); // eslint-disable-line react-hooks/exhaustive-deps
  const filters = (
    <FiltersButton onReset={() => { setOrder("most"); setLimit(PAGE); }} filters={[
      { key: "order", icon: "list", label: "Order", value: ORDERS.find(([o]) => o === order)![1], active: order !== "most", options: ORDERS.map(([o, label]) => ({ key: o, label, selected: order === o, onSelect: () => { setOrder(o); setLimit(PAGE); } })) },
    ]} />
  );
  return (
    <Screen title="People" kicker={people.data ? `${people.data.length.toLocaleString()} named in the Bible` : "Everyone named in the Bible"} className="people" action={filters}>
      <SearchField id="people-q" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="A name: Abraham, Jezebel, Onesimus" />
      {people.isPending ? <p className="bs-list__loading">Loading...</p> : people.isError ? <Empty title="The people did not load" action={{ label: "Retry", onClick: () => void people.refetch() }} /> : !rows.length ? <Empty title={`No one called “${q.trim()}”`}>Try another spelling; the King James spells some names more than one way.</Empty> : (
        <div className="people__body" style={{ ["--section-top" as string]: `${top}px` }}>
          {debounced ? <h2 className="people__band">{`${rows.length.toLocaleString()} ${rows.length === 1 ? "person" : "people"}`}</h2> : null}
          {rows.slice(0, limit).map((p) => <PersonListRow key={p.id} p={p} />)}
          {more ? <div ref={end} className="list-more" role="status">Loading more…</div> : null}
        </div>
      )}
    </Screen>
  );
}

/** Bible Strong's CommentaryLibraryItem: the 48 px portrait, the name in bold over two lines, a grey line under it, and how often they are named. */
function PersonListRow({ p }: { p: PersonIndexRow }) {
  return (
    <Link to={`/person/${p.id}`} className="personrow" onClick={() => haptic("select")}>
      <EntityAvatar id={p.id} name={p.name} kind={avatarKind(p.type)} size={48} />
      <span className="personrow__text">
        <b className="personrow__name">{p.name}</b>
        <span className="personrow__sub">{p.description || (p.names.length > 1 ? p.names.filter((n) => n !== p.name).join(", ") : p.first)}</span>
      </span>
      <span className="personrow__count">{p.verses.toLocaleString()} {p.verses === 1 ? "verse" : "verses"}</span>
    </Link>
  );
}
