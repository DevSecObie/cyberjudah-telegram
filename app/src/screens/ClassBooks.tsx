import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { data, fmtDate, type ClassBook, type ClassBookMoment } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Player } from "@/ui/player";
import { Empty, List, Loading, Row, Screen, SearchField, Section } from "@/ui/ui";

/**
 * Every book the classes bring up. A book we hold opens in our library; a public-domain scan
 * and a book still in copyright open in archive.org's reader inside the app (a copyrighted book
 * through archive.org's free lending). We never show a copyrighted book's own text, only what
 * the classes said about it, linked to the moment.
 */

export const classBookKey = (b: Pick<ClassBook, "title" | "author">) =>
  `${b.title} ${b.author}`.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);

const useClassBooks = () => useQuery({ queryKey: ["class-books"], queryFn: data.classBooks, staleTime: Infinity });
const momentHref = (m: ClassBookMoment) => (m.url ? `/note${m.url}?t=${m.t}` : `/watch/${m.video}?t=${m.t}`);
const clock = (t: number) => `${Math.floor(t / 3600) ? `${Math.floor(t / 3600)}:` : ""}${String(Math.floor((t % 3600) / 60)).padStart(Math.floor(t / 3600) ? 2 : 1, "0")}:${String(t % 60).padStart(2, "0")}`;
const WHERE: Record<ClassBook["status"], string> = {
  library: "In our library",
  "public-domain": "Free to read",
  borrow: "Borrow from archive.org",
  none: "No copy found yet",
};
const years = (b: ClassBook) => (b.first_year && b.last_year ? (b.first_year === b.last_year ? `${b.first_year}` : `${b.first_year} to ${b.last_year}`) : "");

/** The shelf on the Library screen: the class books, most spoken about first. */
export function ClassBooksScreen() {
  useBackButton();
  const books = useClassBooks();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shelves = useMemo(() => {
    const rows = (books.data ?? []).filter((b) => !needle || `${b.title} ${b.author}`.toLowerCase().includes(needle));
    const out = new Map<string, ClassBook[]>();
    for (const b of rows) out.set(b.shelf, [...(out.get(b.shelf) ?? []), b]);
    return [...out];
  }, [books.data, needle]);
  return (
    <Screen title="Class books" kicker="Books the classes bring up">
      <SearchField id="class-book-q" value={q} onChange={setQ} placeholder="Search by title or author" />
      {books.isPending ? <Loading /> : books.isError ? (
        <Empty title="The class books did not load" action={{ label: "Retry", onClick: () => void books.refetch() }}>Check your connection.</Empty>
      ) : !shelves.length ? <Empty title={`No book found for “${q}”`} /> : shelves.map(([shelf, rows]) => (
        <Section key={shelf} title={shelf}>
          <List>{rows.map((b) => (
            <Row key={classBookKey(b)} href={b.status === "library" && b.slug ? `/books/${b.slug}` : `/class-books/${classBookKey(b)}`} title={b.title}
              sub={[b.author, WHERE[b.status]].filter(Boolean).join(" · ")} />
          ))}</List>
        </Section>
      ))}
      <p className="hint">Books still in copyright are lent by archive.org. Here you find only what the classes said about them.</p>
    </Screen>
  );
}

export function ClassBookScreen() {
  useBackButton();
  const { key = "" } = useParams();
  const books = useClassBooks();
  const b = books.data?.find((x) => classBookKey(x) === key);
  // The class plays right here, from the moment it spoke about the book.
  const [at, setAt] = useState<ClassBookMoment | null>(null);
  if (books.isPending) return <Screen title="…"><Loading /></Screen>;
  if (!b) return <Screen title="Class books"><Empty title="This book was not found" /></Screen>;
  const when = years(b);
  const play = (m: ClassBookMoment) => { haptic("select"); setAt(m); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <Screen title={b.title} kicker={[b.author, b.shelf].filter(Boolean).join(" · ")}>
      {at ? (
        <>
          <Player video={at.video} start={at.t} playing onPlay={() => undefined} title={at.title || "Class"} />
          <Link className="bs-link class-book__open" to={momentHref(at)}>{at.url ? "Open the class notes at this moment" : "Open this class"}</Link>
        </>
      ) : null}
      {b.status === "library" && b.slug ? <Link className="btn btn--bordered" to={`/books/${b.slug}`}>Open in our library</Link>
        : b.archive ? <Link className="btn btn--bordered" to={`/class-books/${key}/read`} onClick={() => haptic("select")}>Read the full book</Link> : null}
      {b.status === "borrow" ? <p className="hint">This book is still in copyright. archive.org lends it for free: sign in to archive.org in the reader and choose Borrow.</p> : null}
      {b.status === "none" ? <p className="hint">We have not found a copy to read yet.</p> : null}
      {b.moments.length ? (
        <Section title={when ? `What the classes said (${when})` : "What the classes said"}>
          <List>{b.moments.map((m) => (
            <Row key={`${m.video}-${m.t}`} onClick={() => play(m)} title={m.title || "Class"} meta={clock(m.t)}
              sub={<>{[fmtDate(m.date ?? ""), m.teacher].filter(Boolean).join(" · ")}{m.said ? <span className="class-book__said">{m.said}</span> : null}</>} />
          ))}</List>
        </Section>
      ) : <Empty title="No class moments found yet" />}
    </Screen>
  );
}

/** archive.org's own reader, inside the app: free scans open at once, lent books after Borrow. */
export function ClassBookReaderScreen() {
  useBackButton();
  const { key = "" } = useParams();
  const books = useClassBooks();
  const b = books.data?.find((x) => classBookKey(x) === key);
  if (books.isPending) return <Screen title="…"><Loading /></Screen>;
  if (!b?.archive || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(b.archive)) return <Screen title="Class books"><Empty title="This book cannot be opened here" /></Screen>;
  return (
    <Screen title={b.title} kicker={b.status === "borrow" ? "Lent by archive.org" : "From archive.org"} className="class-book-reader">
      <iframe className="class-book-reader__frame" src={`https://archive.org/embed/${encodeURIComponent(b.archive)}`} title={`${b.title}, archive.org reader`}
        allow="fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
    </Screen>
  );
}
