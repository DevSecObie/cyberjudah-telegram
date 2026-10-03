import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { data, type StrongsRow } from "@/api/data";
import { WordStudy, useStrongs } from "@/bible/ui/WordStudy";
import { pickOfDay, pickRandom } from "@/lib/ofday";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Empty, Icon, List, Row, Screen, SearchField, Section, Segmented, Skeleton } from "@/ui/ui";

type Lang = "hebrew" | "greek";
const isLang = (r: StrongsRow, l: Lang) => r.n.startsWith(l === "hebrew" ? "H" : "G");
/** The whole Strong's index (14,197 rows), kept for the session. */
export const useStrongsIndex = () => useQuery({ queryKey: ["strongs-index"], queryFn: data.strongsIndex, staleTime: Infinity });
/** Strong's word of the day in a language: a word used often enough to be worth meeting (Bible Strong's StrongOfTheDay). */
export function strongOfDay(rows: StrongsRow[] | undefined, lang: Lang): StrongsRow | undefined {
  if (!rows) return undefined;
  const pool = rows.filter((r) => isLang(r, lang) && r.count >= 25 && r.def);
  return pool[pickOfDay(pool.length, lang === "hebrew" ? 1 : 2)];
}
/** Strip accents for search: "ʼâb" matches "ab". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ְͯ-ׇʼ']/g, "").toLowerCase();

/**
 * The Lexicon (Bible Strong's "lexique"): every Hebrew and Greek word of the King James,
 * browsed by language, searched by number, word, transliteration or meaning, with the word
 * of the day and a random word, each opening its full word study.
 */
export function Lexicon() {
  useBackButton(true);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const lang = (params.get("lang") === "greek" ? "greek" : "hebrew") as Lang;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(t); }, [q]);
  const [limit, setLimit] = useState(60);
  const idx = useStrongsIndex();
  const rows = useMemo(() => (idx.data ?? []).filter((r) => isLang(r, lang)), [idx.data, lang]);
  const hits = useMemo(() => {
    const t = debounced;
    if (!t) return [...rows].sort((a, b) => b.count - a.count);
    const num = /^[hg]?\s*(\d+)$/i.exec(t)?.[1];
    if (num) { const n = `${lang === "hebrew" ? "H" : "G"}${+num}`; return rows.filter((r) => r.n === n || r.n.startsWith(n)).sort((a, b) => a.n.length - b.n.length || +a.n.slice(1) - +b.n.slice(1)); }
    const f = fold(t);
    const score = (r: StrongsRow) => { const x = fold(r.xlit), d = fold(r.def); return r.lemma.includes(t) ? 0 : x === f ? 1 : x.startsWith(f) ? 2 : d.split(/\W+/).includes(f) ? 3 : x.includes(f) ? 4 : d.includes(f) ? 5 : 9; };
    return rows.map((r) => [score(r), r] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || b[1].count - a[1].count).map(([, r]) => r);
  }, [rows, debounced, lang]);
  const ofDay = strongOfDay(idx.data, lang);
  const random = () => { if (!rows.length) return; haptic("select"); navigate(`/lexicon/${rows[pickRandom(rows.length)].n}`); };
  const set = (patch: Record<string, string>) => setParams({ lang, ...(q ? { q } : {}), ...patch }, { replace: true });
  return (
    <Screen title="Lexicon" kicker="Strong's Hebrew and Greek · every word of the King James" action={<button type="button" className="icon-btn" aria-label="A random word" title="A random word" onClick={random}><Icon name="retry" size={20} /></button>}>
      <Segmented label="Language" value={lang} onChange={(l) => { setLimit(60); set({ lang: l }); }} options={[["hebrew", `Hebrew ${idx.data ? (idx.data.length - rows.length && lang === "greek" ? idx.data.filter((r) => r.n[0] === "H").length : rows.length).toLocaleString() : ""}`], ["greek", `Greek ${idx.data ? idx.data.filter((r) => r.n[0] === "G").length.toLocaleString() : ""}`]]} />
      <SearchField id="lex-q" value={q} onChange={(v) => { setQ(v); setLimit(60); }} placeholder={lang === "hebrew" ? "A number (H430), a word, elohim, or a meaning" : "A number (G26), a word, agape, or a meaning"} />
      {!debounced && ofDay ? (
        <Section title="Word of the Day">
          <Link to={`/lexicon/${ofDay.n}`} className="lex-day" onClick={() => haptic("select")}>
            <span className="lex-day__lemma" lang={lang === "hebrew" ? "he" : "el"} dir={lang === "hebrew" ? "rtl" : "ltr"}>{ofDay.lemma}</span>
            <span className="lex-day__body"><b>{ofDay.xlit || ofDay.n}</b><span>{preview(ofDay.def)}</span><small>Strong's {ofDay.n} · {ofDay.count.toLocaleString()} times</small></span>
            <Icon name="chevron" size={18} />
          </Link>
        </Section>
      ) : null}
      {idx.isPending ? <Skeleton rows={8} /> : idx.isError ? <Empty title="The lexicon did not load" action={{ label: "Retry", onClick: () => void idx.refetch() }} /> : !hits.length ? <Empty title={`Nothing called “${debounced}” in the ${lang === "hebrew" ? "Hebrew" : "Greek"}`}>Try the number, the transliteration (ʼâb, agapē) or a word from the meaning.</Empty> : (
        <Section title={debounced ? `${hits.length.toLocaleString()} ${hits.length === 1 ? "word" : "words"}` : "Most used"}>
          <List>{hits.slice(0, limit).map((r) => <StrongRow key={r.n} row={r} />)}</List>
          {hits.length > limit ? <button type="button" className="btn btn--plain more-btn" onClick={() => setLimit((n) => n + 100)}>More · {(hits.length - limit).toLocaleString()} left</button> : null}
        </Section>
      )}
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

export function StrongRow({ row }: { row: StrongsRow }) {
  const heb = row.n[0] === "H";
  return <Row href={`/lexicon/${row.n}`} title={<span className="lex-row"><span className="lex-row__lemma" lang={heb ? "he" : "el"} dir={heb ? "rtl" : "ltr"}>{row.lemma}</span><span>{row.xlit || row.n}</span></span>} sub={preview(row.def)} meta={<span className="lex-row__meta"><b>{row.n}</b><small>{row.count.toLocaleString()}</small></span>} />;
}

/** One word's full study, as a screen: `/lexicon/H430`. */
export function LexiconEntry() {
  const { number = "" } = useParams();
  useBackButton(false);
  const n = number.toUpperCase();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const e = useStrongs(n).data;
  useBottomButtons(e ? { text: "Share", onClick: () => void share({ kind: "note", title: `${e.lemma} (${e.xlit}) · Strong's ${e.number}`, text: e.def.slice(0, 300), sitePath: `/lexicon/${e.number.toLowerCase()}` }) } : null);
  return (
    <Screen title={e ? e.lemma : "Word study"} kicker={e ? `${e.xlit} · ${e.language} · Strong's ${e.number}` : `Strong's ${n}`}>
      <div className="lex">
        <WordStudy number={n} books={books.data ?? []} />
      </div>
    </Screen>
  );
}
