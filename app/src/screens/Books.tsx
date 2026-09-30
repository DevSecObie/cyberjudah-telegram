import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { data, DATA_ORIGIN, fmtDate, type BookChapterRow, type BookFigure, type ClassReading, type LibraryBook } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { api, haptic } from "@/tg/sdk";
import { PictureViewer, Said } from "@/ui/PictureViewer";
import { Empty, Icon, List, Row, Screen, SearchField, Section, Skeleton } from "@/ui/ui";

/**
 * The library: public-domain books the classes read from, page by page as printed, with the
 * original page scans, their fold-out maps, plates and figures, and every moment a class read
 * from them.
 */

const src = (u: string) => (u.startsWith("/") ? `${DATA_ORIGIN}${u}` : u);
const useBook = (slug: string) => useQuery({ queryKey: ["library", slug], queryFn: () => data.libraryBook(slug), staleTime: Infinity });
const KIND: Record<BookFigure["kind"], string> = { foldout: "Fold-out map", plate: "Plate", figure: "Figure" };

/** Where a class reading leads: its note at that moment when there is one, else the recording. */
const readingHref = (r: Pick<ClassReading, "video" | "t" | "url">) => (r.url ? `/note${r.url}?t=${r.t}` : `/watch/${r.video}?t=${r.t}`);
/** A page's address: "p. 246", or "vol. 2, p. 246" in a work of several volumes. */
const pageLabel = (b: { volumes: number }, vol: number, page: number, volumeLabel?: string) => (b.volumes > 1 ? `${volumeLabel && !/^Volume \d+$/.test(volumeLabel) ? volumeLabel : `vol. ${vol}`}, p. ${page}` : `p. ${page}`);
const pageHref = (slug: string, vol: number, page: number) => `/books/${slug}/p/${vol}-${page}`;

type BookHit = { kind: string; title: string; url: string; sub: string; snippet: string };
type BookSearch = { ok: true; hits: BookHit[]; counts: Record<string, number> } | { ok: false; reason: string };

export function Books() {
  useBackButton(false);
  const lib = useQuery({ queryKey: ["library"], queryFn: data.library, staleTime: Infinity });
  // Search inside every book: the pages as printed, from the library's own index.
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const found = useQuery({ queryKey: ["book-search", asked], enabled: asked.length > 1, staleTime: 5 * 60_000, retry: false, queryFn: () => api<BookSearch>(`/api/search?q=${encodeURIComponent(asked)}&only=book&limit=30`) });
  const hits = found.data && found.data.ok ? found.data.hits : [];
  return (
    <Screen title="Library" kicker="Books the classes read from">
      <div className="books__search">
        <SearchField id="book-q" value={q} onChange={setQ} onSubmit={() => { haptic("select"); setAsked(q.trim()); }} placeholder="Search inside the books" />
      </div>
      {asked ? (found.isPending ? <Skeleton rows={4} /> : found.isError || (found.data && !found.data.ok) ? <Empty title="The book search did not answer">Try again in a moment.</Empty> : !hits.length ? <Empty title={`Nothing in the books for “${asked}”`}>Try another word or spelling.</Empty> : (
        <Section title={`${hits.length} ${hits.length === 1 ? "page" : "pages"} for “${asked}”`}>
          <List>{hits.map((h) => <Row key={h.url} href={h.url} title={h.title} meta={h.sub} sub={h.snippet.replace(/<\/?b>/g, "")} />)}</List>
        </Section>
      )) : null}
      {lib.isPending ? <Skeleton rows={3} thumb /> : !lib.data?.length ? <Empty title="No books yet" /> : (
        <List>{[...lib.data].sort((a, b) => b.classes - a.classes || a.title.localeCompare(b.title)).map((b) => (
          <Row key={b.slug} href={`/books/${b.slug}`} thumb={b.cover ? src(b.cover) : undefined} title={b.title}
            sub={`${b.author}, ${b.year}${b.volumes > 1 ? ` · ${b.volumes} volumes` : ""} · ${b.classes ? `read in ${b.classes} ${b.classes === 1 ? "class" : "classes"}` : `${b.pages} pages`}${b.figures ? ` · ${b.figures} pictures` : ""}`} />
        ))}</List>
      )}
      <p className="hint">Every book here is in the public domain, from the original printing.</p>
    </Screen>
  );
}

export function BookScreen() {
  const { slug = "" } = useParams();
  const book = useBook(slug);
  const [figure, setFigure] = useState<BookFigure | null>(null);
  const [allReads, setAllReads] = useState(false);
  const [allFigures, setAllFigures] = useState(false);
  useBackButton(false, () => { if (figure) { setFigure(null); return true; } });
  if (book.isPending) return <Screen title="…"><Skeleton rows={6} /></Screen>;
  if (!book.data) return <Screen title="Library"><Empty title="This book did not load" /></Screen>;
  const b = book.data;
  const volumeOf = (vol: number) => b.chapters.find((c) => c.vol === vol)?.volume;
  // One row per class, its pages together, newest class first.
  const byClass: { r: ClassReading; pages: ClassReading[] }[] = [];
  for (const r of b.reads) { const g = byClass.find((x) => x.r.video === r.video); if (g) g.pages.push(r); else byClass.push({ r, pages: [r] }); }
  const shownReads = allReads ? byClass : byClass.slice(0, 6);
  const figures = allFigures ? b.figures : b.figures.slice(0, 8);
  // Chapters grouped by volume or part when the work has them.
  const groups: { label: string; chapters: BookChapterRow[] }[] = [];
  for (const c of b.chapters) { const label = c.volume || ""; const g = groups[groups.length - 1]; if (g && g.label === label) g.chapters.push(c); else groups.push({ label, chapters: [c] }); }
  return (
    <Screen title={b.title} kicker={`${b.author} · ${b.year}`}>
      <p className="book__sub">{[b.subtitle, b.publisher].filter(Boolean).join(". ")}.</p>

      {b.figures.length ? (
        <Section title={b.figures.some((f) => f.kind === "foldout") ? "Maps and pictures" : "Pictures"} action={b.figures.length > 8 ? <button type="button" className="section__more" onClick={() => setAllFigures((v) => !v)}>{allFigures ? "Fewer" : `All ${b.figures.length}`}</button> : undefined}>
          <div className={`book__figures${allFigures ? " book__figures--grid" : ""}`}>{figures.map((f) => (
            <button key={f.file} type="button" className="book__figure" onClick={() => { haptic("select"); setFigure(f); }}>
              <img src={src(f.url)} alt={f.title || KIND[f.kind]} loading="lazy" />
              <b>{f.title || KIND[f.kind]}</b><small>{KIND[f.kind]}{f.page != null ? ` · ${f.kind === "foldout" ? "facing " : ""}${pageLabel(b, f.vol, f.page, volumeOf(f.vol))}` : ""}{f.reads ? ` · in ${f.reads} ${f.reads === 1 ? "class" : "classes"}` : ""}</small>
            </button>
          ))}</div>
        </Section>
      ) : null}

      {byClass.length ? (
        <Section title={`Read in the classes (${byClass.length})`}>
          <div className="book__reads">{shownReads.map(({ r, pages }) => (
            <div key={r.video} className="book__read">
              <Link to={readingHref(r)} className="book__readtitle"><b>{r.title || "Class"}</b><small>{[fmtDate(r.date ?? ""), r.teacher].filter(Boolean).join(" · ")}</small></Link>
              <div className="book__readpages">{pages.map((p) => (
                <span key={`${p.vol}-${p.page}-${p.t}`} className="book__readpage">
                  <Link to={pageHref(slug, p.vol, p.page)}>{pageLabel(b, p.vol, p.page, volumeOf(p.vol))}</Link>
                  <Link to={readingHref(p)} aria-label={`Watch from ${p.ts}`}><Icon name="play" size={12} /> {p.ts}</Link>
                </span>
              ))}</div>
            </div>
          ))}</div>
          {!allReads && byClass.length > 6 ? <button type="button" className="person__more" onClick={() => setAllReads(true)}>Show all {byClass.length}</button> : null}
        </Section>
      ) : null}

      {groups.map((g, i) => (
        <Section key={i} title={g.label || (groups.length > 1 ? `Part ${i + 1}` : "Chapters")}>
          <List>{g.chapters.map((c) => (
            <Row key={c.k} href={`/books/${slug}/${c.k}`} meta={c.n ? (c.n.length > 5 ? c.n : `Chapter ${c.n}`) : undefined} title={c.title}
              sub={c.topics.length >= 24 ? c.topics.replace(/,\s*\d+(-\d+)?\./g, ".").slice(0, 140) + (c.topics.length > 140 ? "…" : "") : `Pages ${c.page}–${c.end}`}
              trailing={c.reads ? <span className="row__count" title="Readings in the classes">{c.reads}</span> : undefined} />
          ))}</List>
        </Section>
      ))}

      <p className="hint">{b.license} Text and page scans from the copy at the Internet Archive.</p>
      {figure ? <PictureViewer figure={figure} figures={b.figures} book={b} onClose={() => setFigure(null)} onChange={setFigure} /> : null}
    </Screen>
  );
}

/** /books/:slug/p/:page, from a class: "2-246" (volume 2, page 246) or "246"; the chapter that holds the page, scrolled to it. */
export function BookPageLink() {
  const { slug = "", page = "" } = useParams();
  const navigate = useNavigate();
  const book = useBook(slug);
  useEffect(() => {
    if (!book.data) return;
    const m = /^(?:(\d+)-)?(\d+)$/.exec(page);
    const vol = Number(m?.[1] ?? 1), n = Number(m?.[2] ?? 0);
    const c = book.data.chapters.find((x) => x.vol === vol && n >= x.page && n <= x.end) ?? book.data.chapters.find((x) => x.vol === vol) ?? book.data.chapters[0];
    navigate(`/books/${slug}/${c.k}?p=${n}`, { replace: true });
  }, [book.data, page, slug, navigate]);
  return <Screen title="…"><Skeleton rows={6} /></Screen>;
}

export function BookChapterScreen() {
  const { slug = "", k = "0" } = useParams();
  const [params] = useSearchParams();
  const at = Number(params.get("p")) || 0;
  const book = useBook(slug);
  const ch = useQuery({ queryKey: ["library", slug, k], queryFn: () => data.libraryChapter(slug, Number(k)), staleTime: Infinity });
  const [scans, setScans] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [figure, setFigure] = useState<BookFigure | null>(null);
  useBackButton(false, () => { if (figure) { setFigure(null); return true; } });
  useEffect(() => {
    if (!ch.data) return;
    const el = at ? document.getElementById(`pg-${at}`) : null;
    if (el) el.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  }, [ch.data, at]);
  if (ch.isPending || book.isPending) return <Screen title="…"><Skeleton rows={10} /></Screen>;
  if (!ch.data || !book.data) return <Screen title="Library"><Empty title="This chapter did not load" /></Screen>;
  const b = book.data, c = ch.data;
  const item = c.item ?? b.items[c.vol - 1]?.id ?? b.items[0]?.id ?? "";
  const scanUrl = (img: number) => b.scan.replace("{id}", item).replace("{img}", String(img));
  const prev = b.chapters[c.k - 1], next = b.chapters[c.k + 1];
  const toggle = (img: number) => { haptic("select"); setScans((s) => { const n = new Set(s); if (n.has(img)) n.delete(img); else n.add(img); return n; }); };
  const figureAt = (p: { vol: number; img: number }) => b.figures.find((f) => f.vol === p.vol && f.img === p.img) ?? null;
  const where = [b.title, c.volume, c.n ? (c.n.length > 5 ? c.n : `Chapter ${c.n}`) : ""].filter(Boolean).join(" · ");
  const label = (x: BookChapterRow) => [x.volume, x.n ? (x.n.length > 5 ? x.n : `Chapter ${x.n}`) : "", `p. ${x.page}`].filter(Boolean).join(" · ");
  return (
    <Screen title={c.title} kicker={`${where} · pp. ${c.page}–${c.end}`} className="bookread">
      {c.pages.map((p) => {
        const fig = p.figure ? figureAt(p) : null;
        return (
          <Fragment key={`${p.vol}-${p.img}`}>
            <article id={`pg-${p.page}`} className={`bookpage${p.page === at ? " bookpage--at" : ""}`}>
              <header className="bookpage__head">
                <span>Page {p.page}</span>
                <button type="button" className="bookpage__scan" aria-pressed={scans.has(p.img)} onClick={() => toggle(p.img)}>{scans.has(p.img) ? "Text" : "Original page"}</button>
              </header>
              {p.reads.length ? (
                <div className="bookpage__reads">
                  {(open.has(p.img) ? p.reads : p.reads.slice(0, 2)).map((r) => <PageReading key={`${r.video}-${r.t}`} r={r} />)}
                  {p.reads.length > 2 && !open.has(p.img) ? <button type="button" className="bookpage__more" onClick={() => setOpen((s) => new Set(s).add(p.img))}>Read in {p.reads.length - 2} more {p.reads.length - 2 === 1 ? "class" : "classes"}</button> : null}
                </div>
              ) : null}
              {scans.has(p.img)
                ? <img className="bookpage__img" src={scanUrl(p.img)} alt={`Page ${p.page} as printed`} loading="lazy" />
                : <>
                    {p.figure ? <button type="button" className="bookpage__fig" onClick={() => { haptic("select"); if (fig) setFigure(fig); }}><img src={src(p.figure)} alt={fig?.title || "Illustration"} loading="lazy" /><small>{fig?.title ? `${fig.title} · ` : ""}tap to open</small></button> : null}
                    <div className="bookpage__text">{p.text.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}</div>
                  </>}
            </article>
            {p.foldout ? (
              <button type="button" className="book__figure book__figure--wide" onClick={() => { haptic("select"); setFigure(p.foldout); }}>
                <img src={src(p.foldout.url)} alt={p.foldout.title} loading="lazy" />
                <b>{p.foldout.title}</b><small>Fold-out map · tap to open</small>
              </button>
            ) : null}
          </Fragment>
        );
      })}
      <nav className="upnext">
        {next ? <Link to={`/books/${slug}/${next.k}`} className="upnext__card"><small>Next</small><b>{next.title}</b><span>{label(next)}</span></Link> : null}
        {prev ? <Link to={`/books/${slug}/${prev.k}`} className="upnext__card"><small>Before this</small><b>{prev.title}</b><span>{label(prev)}</span></Link> : null}
        <Link to={`/books/${slug}`} className="upnext__card"><small>The book</small><b>{b.title}</b><span>Contents, pictures and classes</span></Link>
      </nav>
      {figure ? <PictureViewer figure={figure} figures={b.figures} book={b} onClose={() => setFigure(null)} onChange={setFigure} /> : null}
    </Screen>
  );
}

/** One class's reading of a page: who and when, and, opened, the words spoken as it was read. */
function PageReading({ r }: { r: Omit<ClassReading, "page" | "vol"> }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const watch = (t: number) => { haptic("select"); navigate(`/watch/${r.video}?t=${t}`); };
  return (
    <div className={`bookpage__read${open ? " bookpage__read--open" : ""}`}>
      <button type="button" className="bookpage__readhead" onClick={() => { haptic("select"); setOpen((v) => !v); }} aria-expanded={open}>
        <Icon name="chat" size={14} /> <span>Read in <b>{r.title || "a class"}</b>{r.date ? ` · ${fmtDate(r.date)}` : ""} · {r.ts}</span><Icon name="chevron" size={16} />
      </button>
      {open ? (
        <div className="bookpage__said">
          <Said lines={r.said ?? []} at={r.t} onSeek={watch} compact />
          <Link to={readingHref(r)} className="bookpage__watch"><Icon name="play" size={14} /> {r.url ? "Open the class notes here" : "Watch from this moment"}</Link>
        </div>
      ) : null}
    </div>
  );
}
