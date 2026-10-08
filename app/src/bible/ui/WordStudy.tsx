import { AddToStudy } from "@/studies/AddToStudy";
import { useResourceRelease } from "@/resources/hooks";
import { ReferenceText } from "@/resources/ReferenceText";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { data, type Book, type StrongsEntry } from "@/api/data";
import { haptic } from "@/tg/sdk";

/** The Strong's entry behind a number, kept for the session. */
export const useStrongs = (number: string, enabled = true, explicit?: string | null) => {
  const release = useResourceRelease("strongs", explicit);
  return useQuery({ queryKey: ["strongs", number, release], enabled: enabled && !!number && release !== undefined, queryFn: () => data.strongs(number, release), staleTime: Infinity });
};

/**
 * A Strong's word study: the Hebrew or Greek word behind a King James word, its number,
 * pronunciation, Strong's definition and derivation, how the King James renders it, and every
 * verse it stands behind (the concordance), book by book, each opening in the reader. The body
 * shared by the reader's word sheet and the Lexicon screen.
 */
export function WordStudy({ number, books, here, onRead, enabled = true, release }: { number: string; books: Book[]; here?: { slug: string; chapter: number; verse: number }; onRead?: () => void; enabled?: boolean; release?: string | null }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const q = useStrongs(number, enabled, release);
  const [allBooks, setAllBooks] = useState(false);
  const [openBook, setOpenBook] = useState<string | null>(null);
  const e = q.data;
  const revision = e?.occurrencePages?.revision;
  const more = useInfiniteQuery({
    queryKey: ["strongs-pages", number, e?.resourceRelease, revision],
    enabled: false,
    initialPageParam: e?.occurrencePages?.nextPage ?? 1,
    queryFn: ({ pageParam }) => data.strongsPage(number, revision!, pageParam, e?.resourceRelease),
    getNextPageParam: (last) => last.nextPage ?? undefined,
    staleTime: Infinity,
  });
  const occurrences = useMemo(() => [...(e?.occurrences ?? []), ...(more.data?.pages.flatMap((p) => p.occurrences) ?? [])], [e, more.data]);
  const hasMore = !!revision && (more.data ? more.hasNextPage : e?.occurrencePages?.nextPage != null);
  const bookName = (slug: string) => books.find((b) => b.slug === slug)?.book ?? slug;
  const byBook = useMemo(() => {
    const out: { slug: string; rows: StrongsEntry["occurrences"] }[] = [];
    for (const o of occurrences) { const g = out[out.length - 1]; if (g && g.slug === o.slug) g.rows.push(o); else out.push({ slug: o.slug, rows: [o] }); }
    return out;
  }, [occurrences]);
  const shownBooks = allBooks ? byBook : byBook.slice(0, 8);
  const read = (o: { slug: string; chapter: number; verse: number }) => { haptic("select"); onRead?.(); navigate(`/read/${o.slug}/${o.chapter}?v=${o.verse}`); };
  const mark = (text: string, words: string[]) => {
    // The rendering words shown strong inside the verse.
    const re = new RegExp(`\\b(${words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
    const m = words.length ? re.exec(text) : null;
    if (!m) return text;
    return <>{text.slice(0, m.index)}<mark>{m[0]}</mark>{text.slice(m.index + m[0].length)}</>;
  };
  return (
    <>
      {q.isPending ? <p className="bs-loading">Loading...</p> : !e ? <p className="bs-loading">This word did not load.</p> : (
        <div className="bs-word">
          <header className="bs-word__head">
            <div className="bs-word__lemma" lang={e.language === "Hebrew" ? "he" : "el"} dir={e.language === "Hebrew" ? "rtl" : "ltr"}>{e.lemma}</div>
            <div className="bs-word__meta">
              <b>{e.xlit}</b>
              {e.pron ? <span>{e.pron}</span> : null}
              <small>Strong's {e.number} · {e.language} · {e.count.toLocaleString()} {e.count === 1 ? "time" : "times"} in {e.verses.toLocaleString()} {e.verses === 1 ? "verse" : "verses"}</small>
            </div>
          </header>
          <button type="button" className="bs-btn" onClick={() => setAdding(true)}>Add to study</button>
          {adding ? <AddToStudy onClose={() => setAdding(false)} blocks={[{ id: crypto.randomUUID(), kind: "strongs", number: e.number, lemma: e.lemma, definition: e.def ?? "" }]} /> : null}
          {e.def ? <section className="bs-word__sec"><h3>Meaning</h3><p><ReferenceText text={e.def} links={e.scripture?.def} onRead={onRead} /></p></section> : null}
          {e.derivation ? <section className="bs-word__sec"><h3>Derivation</h3><p><ReferenceText text={e.derivation} links={e.scripture?.derivation} onRead={onRead} /></p></section> : null}
          {e.kjv ? <section className="bs-word__sec"><h3>The King James Renders It</h3><p><ReferenceText text={e.kjv} links={e.scripture?.kjv} onRead={onRead} /></p></section> : null}
          {e.words.length ? (
            <section className="bs-word__sec">
              <h3>Most often as</h3>
              <div className="bs-word__chips">{e.words.map((w) => <span key={w.word} className="bs-word__chip">{w.word} <b>{w.count}</b></span>)}</div>
            </section>
          ) : null}
          <section className="bs-word__sec">
            <h3>Every verse{e.verses > occurrences.length ? ` (first ${occurrences.length} of ${e.verses.toLocaleString()})` : ""}</h3>
            <div className="bs-word__books">
              {shownBooks.map((g) => {
                const isOpen = openBook === g.slug || (byBook.length === 1);
                return (
                  <div key={g.slug} className={`bs-word__book${isOpen ? " bs-word__book--open" : ""}`}>
                    <button type="button" className="bs-word__bookhead" onClick={() => { haptic("select"); setOpenBook(isOpen ? null : g.slug); }} aria-expanded={isOpen}>
                      <b>{bookName(g.slug)}</b><small>{g.rows.length} {g.rows.length === 1 ? "verse" : "verses"}</small>
                    </button>
                    {isOpen ? (
                      <ul>{g.rows.map((o) => (
                        <li key={`${o.chapter}-${o.verse}`}>
                          <button type="button" onClick={() => read(o)} data-here={here && here.slug === o.slug && here.chapter === o.chapter && here.verse === o.verse ? "" : undefined}>
                            <span className="bs-word__ref">{o.chapter}:{o.verse}</span>
                            <span className="bs-word__text">{mark(o.text, o.words)}</span>
                          </button>
                        </li>
                      ))}</ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {!allBooks && byBook.length > 8 ? <button type="button" className="bs-word__more" onClick={() => setAllBooks(true)}>All {byBook.length} books</button> : null}
            {hasMore ? <button type="button" className="bs-word__more" disabled={more.isFetching} onClick={() => { setAllBooks(true); void more.fetchNextPage(); }}>{more.isFetching ? "Loading verses…" : more.isError ? "Retry loading verses" : "Load more verses"}</button> : null}
            {more.isError ? <p role="status">The next verses could not be loaded. Your current results are still here.</p> : null}
          </section>
          <p className="bs-word__src">{e.source}</p>
        </div>
      )}
    </>
  );
}
