import { useResourceRelease } from "@/resources/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { data, type StrongsRow } from "@/api/data";
import { WordStudy, useStrongs } from "@/bible/ui/WordStudy";
import { pickOfDay } from "@/lib/ofday";
import { AlphabetList, SectionTitle, firstLetter, sections, useHeaderOffset } from "@/ui/alphabet";
import { useSheet } from "@/ui/sheet";
import { useBackButton } from "@/tg/hooks";
import { EntryMenu } from "@/ui/entry-menu";
import { haptic } from "@/tg/sdk";
import { Empty, Icon, Screen, SearchField } from "@/ui/ui";

type Lang = "hebrew" | "greek";
const isLang = (r: StrongsRow, l: Lang) => r.n.startsWith(l === "hebrew" ? "H" : "G");
/** The whole Strong's index (14,197 rows), kept for the session. */
export const useStrongsIndex = (enabled = true) => {
  const release = useResourceRelease("strongs");
  return useQuery({ queryKey: ["strongs-index", release], enabled: enabled && release !== undefined, queryFn: () => data.strongsIndex(release), staleTime: Infinity });
};
/** Strong's word of the day in a language: a word used often enough to be worth meeting (Bible Strong's StrongOfTheDay). */
export function strongOfDay(rows: StrongsRow[] | undefined, lang: Lang): StrongsRow | undefined {
  if (!rows) return undefined;
  const pool = rows.filter((r) => isLang(r, lang) && r.count >= 25 && r.def);
  return pool[pickOfDay(pool.length, lang === "hebrew" ? 1 : 2)];
}
/** Strip accents for search: "ʼâb" matches "ab". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ְͯ-ׇʼ']/g, "").toLowerCase();

type Filter = "all" | Lang;
const FILTERS: [Filter, string][] = [["all", "All"], ["hebrew", "Hebrew"], ["greek", "Greek"]];
/** The word a row is filed under (Bible Strong's gloss): the meaning's first clause, "father", "to create". */
export const gloss = (r: StrongsRow) => (r.def.replace(/^[^A-Za-z(]+/, "").replace(/^\([^)]*\)\s*/, "").replace(/^(?:a|an|the|to)\s+/i, "").split(/[;,:({}"]/)[0] ?? "").trim().replace(/\s+(?:or|and|of)$/, "") || r.xlit || r.n;
const PAGE = 50;

/**
 * The Lexicon's list for a letter or a search: with no search, the words filed under the letter by
 * meaning; a number is searched as typed ("G26" finds the Greek word whatever the filter, a bare
 * number searches the filter's languages); a word is ranked by where it matches.
 */
export function findStrongs(all: StrongsRow[], rows: StrongsRow[], t: string, letter: string): StrongsRow[] {
  if (!t) return rows.filter((r) => firstLetter(gloss(r)) === letter).sort((a, b) => gloss(a).localeCompare(gloss(b), "en", { sensitivity: "base" }));
  const code = /^([hg])?\s*(\d+)$/i.exec(t);
  if (code) {
    const pool = code[1] ? all : rows;
    const ns = code[1] ? [`${code[1].toUpperCase()}${+code[2]}`] : ["H", "G"].map((l) => `${l}${+code[2]}`);
    return pool.filter((r) => ns.some((n) => r.n === n || r.n.startsWith(n))).sort((a, b) => a.n.length - b.n.length || +a.n.slice(1) - +b.n.slice(1));
  }
  const f = fold(t);
  const score = (r: StrongsRow) => { const x = fold(r.xlit), d = fold(r.def); return r.lemma.includes(t) ? 0 : x === f ? 1 : x.startsWith(f) ? 2 : d.split(/\W+/).includes(f) ? 3 : x.includes(f) ? 4 : d.includes(f) ? 5 : 9; };
  return rows.map((r) => [score(r), r] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || b[1].count - a[1].count).map(([, r]) => r);
}

/**
 * The Lexicon as Bible Strong's LexiqueListScreen: every Hebrew and Greek word of the King James,
 * filed by meaning under the letter's disc, opening on A with the alphabet along the bottom, a
 * filter for the language, and a search by number or word, each row opening its word study.
 */
export function Lexicon() {
  useBackButton();
  const sheet = useSheet();
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get("lang") === "hebrew" ? "hebrew" : params.get("lang") === "greek" ? "greek" : "all";
  const letter = (params.get("letter") ?? "a").toLowerCase();
  const set = (key: string, value: string | null) => setParams((p) => { const next = new URLSearchParams(p); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(t); }, [q]);
  const idx = useStrongsIndex();
  const rows = useMemo(() => (idx.data ?? []).filter((r) => filter === "all" || isLang(r, filter)), [idx.data, filter]);
  const hits = useMemo(() => findStrongs(idx.data ?? [], rows, debounced, letter), [rows, debounced, letter, idx.data]);
  // Fifty rows at a time, the next fifty as the end of the list comes into view.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [debounced, letter, filter]);
  const end = useRef<HTMLDivElement>(null);
  const more = hits.length > limit;
  useEffect(() => {
    const el = end.current; if (!el || !more) return;
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) setLimit((n) => n + PAGE); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, limit]);
  const top = useHeaderOffset();
  // Bible Strong's FiltersHeader: the filters, then a filter's choices.
  const openFilters = async () => {
    const pick = await sheet.open({ title: "Filters", items: [{ id: "lexicon", text: "Lexicon", hint: FILTERS.find(([f]) => f === filter)![1], icon: <Icon name="book-open" size={20} /> }] });
    if (!pick) return;
    const choice = await sheet.open({ title: "Lexicon", items: FILTERS.map(([f, label]) => ({ id: f, text: label, icon: f === filter ? <Icon name="check" size={18} /> : <span className="bs-filter__blank" /> })) });
    if (choice) set("lang", choice.id === "all" ? null : choice.id);
  };
  const active = filter !== "all";
  return (
    <Screen title="Lexicon" className="bs-list" action={
      <button type="button" className={`bs-filter${active ? " bs-filter--on" : ""}`} aria-label={active ? "1 filter" : "Filter"} title={active ? "1 filter" : "Filter"} onClick={() => void openFilters()}>
        {active ? <span className="bs-filter__pill"><span><Icon name="book-open" size={14} /></span><span><Icon name="chevron-down" size={13} /></span></span> : <Icon name="filter" size={20} />}
      </button>
    } headerChildren={<SearchField id="lex-q" value={q} onChange={setQ} placeholder="Search by code or by word" />}>
      {idx.isPending ? <p className="bs-list__loading">Loading...</p> : idx.isError ? <Empty title="The lexicon did not load" action={{ label: "Retry", onClick: () => void idx.refetch() }} /> : !hits.length ? <Empty title="No Strong's found...">Try the number, the transliteration (ʼâb, agapē) or a word from the meaning.</Empty> : (
        <div className="bs-list__body" style={{ ["--section-top" as string]: `${top}px` }}>
          {sections(hits.slice(0, limit), gloss).map((section) => (
            <section key={section.title}>
              <SectionTitle color="var(--accent)">{section.title.toUpperCase()}</SectionTitle>
              {section.data.map((r) => <LexiqueItem key={r.n} row={r} />)}
            </section>
          ))}
          {more ? <div ref={end} className="list-more" role="status">Loading more…</div> : null}
        </div>
      )}
      {!q ? <AlphabetList letter={letter} setLetter={(l) => set("letter", l)} /> : null}
    </Screen>
  );
}

/** Bible Strong's LexiqueItem: the language and the number as chips, then the meaning and the original word. */
function LexiqueItem({ row }: { row: StrongsRow }) {
  const heb = row.n[0] === "H";
  return (
    <Link to={`/lexicon/${row.n}`} className="bs-lexitem" onClick={() => haptic("select")}>
      <span className="bs-lexitem__chips"><span className={heb ? "bs-lexchip bs-lexchip--hebrew" : "bs-lexchip"}>{heb ? "Hebrew" : "Greek"}</span><span className="bs-lexchip">{row.n}</span></span>
      <span className="bs-lexitem__line"><b>{gloss(row)}</b><span lang={heb ? "he" : "el"}>{row.lemma}</span></span>
    </Link>
  );
}

/** One word's full study, as a screen: `/lexicon/H430`. */
export function LexiconEntry() {
  const [resourceParams] = useSearchParams();
  const release = resourceParams.get("release") ?? undefined;
  const { number = "" } = useParams();
  useBackButton();
  const n = number.toUpperCase();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const e = useStrongs(n, true, release).data;
  return (
    <Screen title={e ? e.lemma : "Word study"} kicker={e ? `${e.xlit} · ${e.language} · Strong's ${e.number}` : `Strong's ${n}`} action={<EntryMenu entry={e ? { title: `${e.lemma} (${e.xlit}) · Strong's ${e.number}`, text: e.def, path: `/lexicon/${e.number.toLowerCase()}` } : null} />}>
      <div className="lex">
        <WordStudy number={n} books={books.data ?? []} release={release} />
      </div>
    </Screen>
  );
}
