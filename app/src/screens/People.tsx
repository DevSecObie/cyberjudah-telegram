import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { data } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { Empty, List, Row, Screen, SearchField, Section, Segmented, Skeleton } from "@/ui/ui";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ']/g, "").toLowerCase();

/**
 * Every named person in the Bible (STEPBible TIPNR, with Easton's and Hitchcock's): searched
 * by name, or the most spoken of first; each opens the person with their family, their verses
 * and what the classes taught where they come up.
 */
export function People() {
  useBackButton(true);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(fold(q.trim())), 150); return () => clearTimeout(t); }, [q]);
  const [order, setOrder] = useState<"most" | "az">("most");
  const [limit, setLimit] = useState(60);
  const people = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  const rows = useMemo(() => {
    const all = people.data ?? [];
    const hits = debounced ? all.filter((p) => fold(p.name).includes(debounced) || p.names.some((n) => fold(n).includes(debounced))).sort((a, b) => Number(fold(b.name).startsWith(debounced)) - Number(fold(a.name).startsWith(debounced)) || b.verses - a.verses) : [...all];
    if (!debounced) hits.sort(order === "most" ? (a, b) => b.verses - a.verses || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
    return hits;
  }, [people.data, debounced, order]);
  return (
    <Screen title="People" kicker={people.data ? `${people.data.length.toLocaleString()} named in the Bible` : "Everyone named in the Bible"}>
      <SearchField id="people-q" value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder="A name: Abraham, Jezebel, Onesimus" />
      {!debounced ? <Segmented label="Order" value={order} onChange={(o) => { setOrder(o); setLimit(60); }} options={[["most", "Most spoken of"], ["az", "A to Z"]]} /> : null}
      {people.isPending ? <Skeleton rows={8} /> : people.isError ? <Empty title="The people did not load" action={{ label: "Retry", onClick: () => void people.refetch() }} /> : !rows.length ? <Empty title={`No one called “${q.trim()}”`}>Try another spelling; the King James spells some names more than one way.</Empty> : (
        <Section title={debounced ? `${rows.length.toLocaleString()} ${rows.length === 1 ? "person" : "people"}` : undefined}>
          <List>{rows.slice(0, limit).map((p) => <Row key={p.id} href={`/person/${p.id}`} leading={<EntityAvatar name={p.name} kind={avatarKind(p.type)} size={40} />} title={p.name} sub={p.description || (p.names.length > 1 ? p.names.filter((n) => n !== p.name).join(", ") : p.first)} meta={<small>{p.verses.toLocaleString()} {p.verses === 1 ? "verse" : "verses"}</small>} />)}</List>
          {rows.length > limit ? <button type="button" className="more-btn" onClick={() => setLimit((n) => n + 100)}>More · {(rows.length - limit).toLocaleString()} left</button> : null}
        </Section>
      )}
    </Screen>
  );
}
