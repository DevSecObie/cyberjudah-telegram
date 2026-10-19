import { useResourceRelease } from "@/resources/hooks";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { data, type StrongsRow } from "@/api/data";
import { WordStudy, useStrongs } from "@/bible/ui/WordStudy";
import { pickOfDay, pickRandom } from "@/lib/ofday";
import { AlphabetBar, LetterSection } from "@/ui/alphabet";
import { ShareButton } from "@/ui/ShareButton";
import { share } from "@/lib/share";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Chip, Chips, Empty, Icon, List, Row, Screen, SearchField, Section, Skeleton } from "@/ui/ui";

type Lang = "hebrew" | "greek";
const isLang = (r: StrongsRow, l: Lang) => r.n.startsWith(l === "hebrew" ? "H" : "G");
/** The whole Strong's index (14,197 rows), kept for the session. */
export const useStrongsIndex = () => {
  const release = useResourceRelease("strongs");
  return useQuery({ queryKey: ["strongs-index", release], enabled: release !== undefined, queryFn: () => data.strongsIndex(release), staleTime: Infinity });
};
/** Strong's word of the day in a language: a word used often enough to be worth meeting (Bible Strong's StrongOfTheDay). */
export function strongOfDay(rows: StrongsRow[] | undefined, lang: Lang): StrongsRow | undefined {
  if (!rows) return undefined;
  const pool = rows.filter((r) => isLang(r, lang) && r.count >= 25 && r.def);
  return pool[pickOfDay(pool.length, lang === "hebrew" ? 1 : 2)];
}
/** Strip accents for search: "ʼâb" matches "ab". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ְͯ-ׇʼ']/g, "").toLowerCase();

/** The letter a word files under: its transliteration's first letter (ʼâb under A). */
const fileLetter = (r: StrongsRow) => { const c = fold(r.xlit || r.n).replace(/[^a-z]/g, "").charAt(0).toUpperCase(); return c || "#"; };

/**
 * The Lexicon (Bible Strong's LexiqueListScreen): every Hebrew and Greek word of the King James.
 * As there, it opens on the list, at A, under a letter disc, with the letters along the bottom
 * and All, Hebrew or Greek above it; a search (by number, word, transliteration or meaning)
 * replaces the letters. "Most used" orders every word by how often it is read, and the header's
 * button opens a random word.
 */
export function Lexicon() {
  useBackButton();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lang = (params.get("lang") === "greek" ? "greek" : params.get("lang") === "hebrew" ? "hebrew" : "all") as Lang | "all";
  const order = params.get("order") === "used" ? "used" : "az";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(t); }, [q]);
  const [limit, setLimit] = useState(60);
  const idx = useStrongsIndex();
  const rows = useMemo(() => (idx.data ?? []).filter((r) => lang === "all" || isLang(r, lang)), [idx.data, lang]);
  const letters = useMemo(() => [...new Set(rows.map(fileLetter))].filter((l) => l !== "#").sort(), [rows]);
  const browsing = !debounced && order === "az";
  const letter = browsing ? (letters.includes(params.get("letter") ?? "") ? params.get("letter")! : letters[0] ?? "A") : "";
  const hits = useMemo(() => {
    const t = debounced;
    if (!t) return order === "used" ? [...rows].sort((a, b) => b.count - a.count) : rows.filter((r) => fileLetter(r) === letter).sort((a, b) => fold(a.xlit).localeCompare(fold(b.xlit)) || b.count - a.count);
    // A number is searched as typed: "G26" finds the Greek word whatever the filter, and a bare
    // number uses the filter's language (both, under All).
    const code = /^([hg])?\s*(\d+)$/i.exec(t);
    if (code) { const ns = code[1] ? [`${code[1].toUpperCase()}${+code[2]}`] : lang === "all" ? [`H${+code[2]}`, `G${+code[2]}`] : [`${lang === "hebrew" ? "H" : "G"}${+code[2]}`]; return (code[1] ? idx.data ?? [] : rows).filter((r) => ns.some((n) => r.n === n || r.n.startsWith(n))).sort((a, b) => a.n.length - b.n.length || +a.n.slice(1) - +b.n.slice(1) || a.n.localeCompare(b.n)); }
    const f = fold(t);
    const score = (r: StrongsRow) => { const x = fold(r.xlit), d = fold(r.def); return r.lemma.includes(t) ? 0 : x === f ? 1 : x.startsWith(f) ? 2 : d.split(/\W+/).includes(f) ? 3 : x.includes(f) ? 4 : d.includes(f) ? 5 : 9; };
    return rows.map((r) => [score(r), r] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || b[1].count - a[1].count).map(([, r]) => r);
  }, [rows, debounced, lang, idx.data, order, letter]);
  // The next rows load as the list's end comes into view (Bible Strong's onEndReached).
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current; if (!el || hits.length <= limit) return;
    const io = new IntersectionObserver((seen) => { if (seen.some((x) => x.isIntersecting)) setLimit((n) => n + 100); }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hits.length, limit]);
  const random = () => { if (!rows.length) return; haptic("select"); navigate(`/lexicon/${rows[pickRandom(rows.length)].n}`); };
  const set = (patch: Record<string, string | null>) => {
    const next: Record<string, string> = { ...(lang !== "all" ? { lang } : {}), ...(order === "used" ? { order } : {}), ...(letter ? { letter } : {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === null) delete next[k]; else next[k] = v; }
    setLimit(60); setParams(next, { replace: true });
  };
  const count = (l: Lang) => (idx.data ? idx.data.filter((r) => isLang(r, l)).length.toLocaleString() : "");
  const label = debounced ? `${hits.length.toLocaleString()} ${hits.length === 1 ? "word" : "words"}` : order === "used" ? "Most used" : letter;
  return (
    <Screen title="Lexicon" kicker="Strong's Hebrew and Greek · every word of the King James" action={<button type="button" className="icon-btn" aria-label="A random word" title="A random word" onClick={random}><Icon name="retry" size={20} /></button>}>
      <SearchField id="lex-q" value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder="Search by code or by word: H430, elohim, love" />
      {/* Bible Strong's FiltersHeader: the language filter, All by default; and our own ordering. */}
      <Chips>
        <Chip on={lang === "all"} onClick={() => set({ lang: null, letter: null })}>All</Chip>
        <Chip on={lang === "hebrew"} onClick={() => set({ lang: "hebrew", letter: null })}>Hebrew {count("hebrew")}</Chip>
        <Chip on={lang === "greek"} onClick={() => set({ lang: "greek", letter: null })}>Greek {count("greek")}</Chip>
        <Chip on={order === "used"} onClick={() => set(order === "used" ? { order: null } : { order: "used", letter: null })}>Most used</Chip>
      </Chips>
      {idx.isPending ? <Skeleton rows={8} /> : idx.isError ? <Empty title="The lexicon did not load" action={{ label: "Retry", onClick: () => void idx.refetch() }} /> : !hits.length ? <Empty title={`Nothing called “${debounced}”${lang === "all" ? "" : ` in the ${lang === "hebrew" ? "Hebrew" : "Greek"}`}`}>Try the number, the transliteration (ʼâb, agapē) or a word from the meaning.</Empty> : (
        <div className="lex-list" role="region" aria-label={label}>
          {browsing ? <LetterSection letter={letter}><List>{hits.slice(0, limit).map((r) => <StrongRow key={r.n} row={r} />)}</List></LetterSection> : <Section title={label}><List>{hits.slice(0, limit).map((r) => <StrongRow key={r.n} row={r} />)}</List></Section>}
          {hits.length > limit ? <div ref={end} className="list-more" role="status">Loading more…</div> : null}
        </div>
      )}
      {browsing && letters.length ? <AlphabetBar letter={letter} letters={letters} onChange={(l) => { set({ letter: l }); window.scrollTo({ top: 0 }); }} /> : null}
      <p className="hint">Strong's Exhaustive Concordance (1890), public domain; the Hebrew and Greek behind every King James word in the 66 books, and the Greek of the Apocrypha from the Septuagint.</p>
    </Screen>
  );
}

/** The index keeps the first 90 characters of a definition; a cut one ends at a whole word, with an ellipsis. */
const INDEX_DEF_CAP = 90;
const preview = (def: string) => {
  if (def.length < INDEX_DEF_CAP) return def;
  const cut = def.slice(0, def.lastIndexOf(" ") > 40 ? def.lastIndexOf(" ") : def.length).replace(/[\s,;:.(-]+$/, "");
  return `${cut}…`;
};

/** Bible Strong's LexiqueItem: the language and number as chips, then the meaning and the word. */
export function StrongRow({ row }: { row: StrongsRow }) {
  const heb = row.n[0] === "H";
  return <Row href={`/lexicon/${row.n}`} meta={<span className="lex-row__chips"><span className="lex-chip" data-heb={heb ? "" : undefined}>{heb ? "Hebrew" : "Greek"}</span><span className="lex-chip">{row.n}</span><small>{[row.xlit, `${row.count.toLocaleString()}×`].filter(Boolean).join(" · ")}</small></span>} title={<span className="lex-row"><span className="lex-row__def">{preview(row.def) || row.xlit}</span><span className="lex-row__lemma" lang={heb ? "he" : "el"} dir={heb ? "rtl" : "ltr"}>{row.lemma}</span></span>} />;
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
  // Share sits in the header, as in Bible Strong's StrongEntryMenu, not on Telegram's bottom button over the dock.
  const onShare = e ? () => void share({ kind: "note", title: `${e.lemma} (${e.xlit}) · Strong's ${e.number}`, text: e.def.slice(0, 300), sitePath: `/lexicon/${e.number.toLowerCase()}` }) : undefined;
  return (
    <Screen title={e ? e.lemma : "Word study"} kicker={e ? `${e.xlit} · ${e.language} · Strong's ${e.number}` : `Strong's ${n}`} action={onShare ? <ShareButton onClick={onShare} /> : undefined}>
      <div className="lex">
        <WordStudy number={n} books={books.data ?? []} release={release} />
      </div>
    </Screen>
  );
}

