import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { AlphabetList, SectionTitle, sections, useHeaderOffset } from "@/ui/alphabet";
import { haptic } from "@/tg/sdk";

import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { share } from "@/lib/share";
import { Empty, List, Row, Screen, SearchField, Section, Loading } from "@/ui/ui";

type RowT = { slug: string; term: string };
type Page = { count: number; page: number; pages: number; rows: RowT[]; related: RowT[]; total: number };
type Entry = { slug: string; term: string; definitions: string[] };
const STOP = new Set("the and for that with unto them they thou thee thy his him her she you your our this these those from into upon shall will hath have had not but which whom who whose what when where there their were was are had said saith came come went also then than all any every because before after more most such very over under out off yet let did doth till until against among".split(" "));

/**
 * Easton's Bible Dictionary as Bible Strong's DictionaryListScreen: it opens on the words of A,
 * filed under the letter's disc in gold, with the alphabet along the bottom; a search replaces
 * the letters. Opened from a verse (`?from=` carries the verse text), the words in it that have
 * entries come first. Entries cite scripture in the dictionary's own abbreviated form.
 */
export function Dictionary() {
  useBackButton();
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const letter = (params.get("letter") ?? "a").toLowerCase();
  const setLetter = (l: string) => setParams((p) => { const next = new URLSearchParams(p); next.set("letter", l); return next; }, { replace: true });
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  // The API serves 60 rows a page; the next page loads as the list's end scrolls into view, as
  // Bible Strong's dictionary list does (infinite scroll).
  const page = useInfiniteQuery({
    queryKey: ["dict", debounced, debounced ? "" : letter],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => { const r = await fetch(`/api/dictionary?q=${encodeURIComponent(debounced)}&letter=${debounced ? "" : letter.toUpperCase()}&page=${pageParam}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Page>; },
    getNextPageParam: (last) => (last.page < last.pages ? last.page + 1 : undefined),
  });
  const first = page.data?.pages[0];
  const rows = useMemo(() => page.data?.pages.flatMap((p) => p.rows) ?? [], [page.data]);
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = page;
  useEffect(() => {
    const el = end.current; if (!el || !hasNextPage || isFetchNextPageError) return;
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting) && !isFetchingNextPage) void fetchNextPage(); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, rows.length]);
  // From a verse: try each word that might be a name or a term.
  const words = useMemo(() => [...new Set(from.replace(/[^A-Za-z' ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))].slice(0, 40), [from]);
  const found = useQuery({ queryKey: ["dict-from", words.join(",")], enabled: words.length > 0, queryFn: async () => {
    const hits = await Promise.all(words.map((w) => fetch(`/api/dictionary/lookup?word=${encodeURIComponent(w)}`).then((r) => (r.ok ? (r.json() as Promise<Entry>) : null)).catch(() => null)));
    const seen = new Set<string>();
    return hits.filter((h): h is Entry => !!h && !seen.has(h.slug) && seen.add(h.slug) !== undefined);
  } });
  const top = useHeaderOffset();
  return (
    <Screen title="Dictionary" className="bs-list" headerChildren={<SearchField id="dict-q" value={q} onChange={setQ} placeholder="Search by word" autoFocus={false} />}>
      {from && !q ? (
        <Section title="In These Verses">
          {found.isPending ? <Loading message="Loading..." /> : !found.data?.length ? <Empty title="No dictionary entry for these words">Search for a name or a place instead.</Empty> : <List>{found.data.map((e) => <Row key={e.slug} href={`/dictionary/${e.slug}`} title={e.term} sub={e.definitions[0]} />)}</List>}
        </Section>
      ) : null}
      {page.isPending ? <p className="bs-list__loading">Loading...</p> : page.isError && !first ? (
        <Empty title="The dictionary did not load" action={{ label: "Retry", onClick: () => void page.refetch() }}>Check your connection.</Empty>
      ) : first ? (
        <>
          {rows.length ? (
            <div className="bs-list__body" style={{ ["--section-top" as string]: `${top}px` }}>
              {sections(rows, (r) => r.term).map((section) => (
                <section key={section.title}>
                  <SectionTitle color="var(--bs-secondary, rgb(255, 188, 0))">{section.title.toUpperCase()}</SectionTitle>
                  {section.data.map((r) => <Link key={r.slug} to={`/dictionary/${r.slug}`} className="bs-dictitem" onClick={() => haptic("select")}><span>{r.term}</span></Link>)}
                </section>
              ))}
              {hasNextPage ? <div ref={end} className="list-more" role="status">{isFetchNextPageError ? <button type="button" className="section__more" onClick={() => void fetchNextPage()}>The next entries did not load. Retry</button> : "Loading more…"}</div> : null}
            </div>
          ) : <Empty title={`No entry called “${debounced}”`} />}
          {debounced && first.related.length ? <Section title="Mentioned in"><List>{first.related.map((r) => <Row key={r.slug} href={`/dictionary/${r.slug}`} title={r.term} />)}</List></Section> : null}
        </>
      ) : null}
      {!q ? <AlphabetList color="var(--bs-secondary, rgb(255, 188, 0))" letter={letter} setLetter={setLetter} /> : null}
    </Screen>
  );
}

export function DictionaryEntry() {
  const { slug = "" } = useParams();
  useBackButton();
  const e = useQuery({ queryKey: ["dict-entry", slug], queryFn: async () => { const r = await fetch(`/api/dictionary/${slug}`); if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<Entry>; } });
  useBottomButtons(e.data ? { text: "Share", onClick: () => void share({ kind: "note", title: `${e.data!.term} · Easton's Bible Dictionary`, text: e.data!.definitions[0].slice(0, 300), sitePath: `/dictionary/${slug}` }) } : null);
  if (e.isPending) return <Screen title="…"><Loading message="Loading..." /></Screen>;
  if (e.isError) return <Screen title="Dictionary"><Empty title="This entry did not load" action={{ label: "Retry", onClick: () => void e.refetch() }}>Check your connection.</Empty></Screen>;
  if (!e.data?.term) return <Screen title="Dictionary"><Empty title="No such entry" /></Screen>;
  return (
    <Screen title={e.data.term} kicker="Easton's Bible Dictionary">
      <div className="dict">{e.data.definitions.map((d, i) => <p key={i}>{d}</p>)}</div>
      <p className="hint">Easton's Bible Dictionary, 1897, public domain. An outside dictionary: the King James Bible and the classes come first, and entries that teach against them are left out.</p>
    </Screen>
  );
}
