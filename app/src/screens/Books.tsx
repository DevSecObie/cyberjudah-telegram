import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { data, DATA_ORIGIN, fmtDate, type BookMap, type ClassReading, type LibraryBook } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Empty, Icon, List, Row, Screen, Section, Skeleton } from "@/ui/ui";

/**
 * The library: public-domain books the classes read from, page by page as printed, with the
 * original page scans and fold-out maps, and every moment a class read from them.
 */

const src = (u: string) => (u.startsWith("/") ? `${DATA_ORIGIN}${u}` : u);
const scanUrl = (book: LibraryBook, leaf: number) => book.scan.replace("{leaf}", String(leaf));
const useBook = (slug: string) => useQuery({ queryKey: ["library", slug], queryFn: () => data.libraryBook(slug), staleTime: Infinity });

/** Where a class reading leads: its note at that moment when there is one, else the recording. */
const readingHref = (r: Pick<ClassReading, "video" | "t" | "url">) => (r.url ? `/note${r.url}?t=${r.t}` : `/watch/${r.video}?t=${r.t}`);

export function Books() {
  useBackButton(false);
  const lib = useQuery({ queryKey: ["library"], queryFn: data.library, staleTime: Infinity });
  return (
    <Screen title="Library" kicker="Books the classes read from">
      {lib.isPending ? <Skeleton rows={3} thumb /> : !lib.data?.length ? <Empty title="No books yet" /> : (
        <List>{lib.data.map((b) => (
          <Row key={b.slug} href={`/books/${b.slug}`} thumb={b.cover ? src(b.cover) : undefined} title={b.title}
            sub={`${b.author}, ${b.year} · ${b.classes ? `read in ${b.classes} classes` : `${b.pages} pages`}`} />
        ))}</List>
      )}
      <p className="hint">Every book here is in the public domain, from the original printing.</p>
    </Screen>
  );
}

export function BookScreen() {
  const { slug = "" } = useParams();
  const book = useBook(slug);
  const [map, setMap] = useState<BookMap | null>(null);
  const [allReads, setAllReads] = useState(false);
  useBackButton(false, () => { if (map) { setMap(null); return true; } });
  if (book.isPending) return <Screen title="…"><Skeleton rows={6} /></Screen>;
  if (!book.data) return <Screen title="Library"><Empty title="This book did not load" /></Screen>;
  const b = book.data;
  // One row per class, its pages together, newest class first.
  const byClass: { r: ClassReading; pages: ClassReading[] }[] = [];
  for (const r of b.reads) { const g = byClass.find((x) => x.r.video === r.video); if (g) g.pages.push(r); else byClass.push({ r, pages: [r] }); }
  const shown = allReads ? byClass : byClass.slice(0, 6);
  return (
    <Screen title={b.title} kicker={`${b.author} · ${b.year}`}>
      <p className="book__sub">{b.subtitle}. {b.publisher}.</p>

      {b.maps.length ? (
        <Section title="Maps">
          <div className="book__maps">{b.maps.map((m) => (
            <button key={m.file} type="button" className="book__map" onClick={() => { haptic("select"); setMap(m); }}>
              <img src={src(m.url)} alt={m.title} loading="lazy" />
              <b>{m.title}</b><small>Facing page {m.facing}{m.reads ? ` · shown in ${m.reads} ${m.reads === 1 ? "class" : "classes"}` : ""}</small>
            </button>
          ))}</div>
        </Section>
      ) : null}

      {byClass.length ? (
        <Section title={`Read in the classes (${byClass.length})`}>
          <div className="book__reads">{shown.map(({ r, pages }) => (
            <div key={r.video} className="book__read">
              <Link to={readingHref(r)} className="book__readtitle"><b>{r.title || "Class"}</b><small>{[fmtDate(r.date ?? ""), r.teacher].filter(Boolean).join(" · ")}</small></Link>
              <div className="book__readpages">{pages.map((p) => (
                <span key={`${p.page}-${p.t}`} className="book__readpage">
                  <Link to={`/books/${slug}/p/${p.page}`}>p. {p.page}</Link>
                  <Link to={readingHref(p)} aria-label={`Watch from ${p.ts}`}><Icon name="play" size={12} /> {p.ts}</Link>
                </span>
              ))}</div>
            </div>
          ))}</div>
          {!allReads && byClass.length > 6 ? <button type="button" className="person__more" onClick={() => setAllReads(true)}>Show all {byClass.length}</button> : null}
        </Section>
      ) : null}

      <Section title="Chapters">
        <List>{b.chapters.map((c) => (
          <Row key={c.k} href={`/books/${slug}/${c.k}`} meta={c.n || undefined} title={c.title}
            sub={c.topics ? c.topics.replace(/,\s*\d+(-\d+)?\./g, ".").slice(0, 120) + (c.topics.length > 120 ? "…" : "") : `Pages ${c.page}–${c.end}`}
            trailing={c.reads ? <span className="row__count" title="Readings in the classes">{c.reads}</span> : undefined} />
        ))}</List>
      </Section>

      <p className="hint">{b.license} Text and page scans from the copy at the Internet Archive.</p>
      {map ? <MapViewer map={map} onClose={() => setMap(null)} /> : null}
    </Screen>
  );
}

/** /books/:slug/p/:page, from a class: the chapter that holds the page, scrolled to it. */
export function BookPageLink() {
  const { slug = "", page = "" } = useParams();
  const navigate = useNavigate();
  const book = useBook(slug);
  useEffect(() => {
    if (!book.data) return;
    const n = Number(page);
    const c = book.data.chapters.find((x) => n >= x.page && n <= x.end) ?? book.data.chapters[0];
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
  const [map, setMap] = useState<BookMap | null>(null);
  useBackButton(false, () => { if (map) { setMap(null); return true; } });
  useEffect(() => {
    if (!ch.data) return;
    const el = at ? document.getElementById(`pg-${at}`) : null;
    if (el) el.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0);
  }, [ch.data, at]);
  if (ch.isPending || book.isPending) return <Screen title="…"><Skeleton rows={10} /></Screen>;
  if (!ch.data || !book.data) return <Screen title="Library"><Empty title="This chapter did not load" /></Screen>;
  const b = book.data, c = ch.data;
  const prev = b.chapters[c.k - 1], next = b.chapters[c.k + 1];
  const toggle = (p: number) => { haptic("select"); setScans((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; }); };
  return (
    <Screen title={c.title} kicker={`${b.title}${c.n ? ` · Chapter ${c.n}` : ""} · pp. ${c.page}–${c.end}`} className="bookread">
      {c.pages.map((p) => {
        const mapHere = b.maps.find((m) => m.facing === p.page);
        return (
          <Fragment key={p.page}>
            <article id={`pg-${p.page}`} className={`bookpage${p.page === at ? " bookpage--at" : ""}`}>
              <header className="bookpage__head">
                <span>Page {p.page}</span>
                <button type="button" className="bookpage__scan" aria-pressed={scans.has(p.page)} onClick={() => toggle(p.page)}>{scans.has(p.page) ? "Text" : "Original page"}</button>
              </header>
              {p.reads.length ? (
                <div className="bookpage__reads">
                  {(open.has(p.page) ? p.reads : p.reads.slice(0, 2)).map((r) => (
                    <Link key={`${r.video}-${r.t}`} to={readingHref(r)} className="bookpage__read">
                      <Icon name="play" size={12} /> <span>Read in <b>{r.title || "a class"}</b>{r.date ? ` · ${fmtDate(r.date)}` : ""} · {r.ts}</span>
                    </Link>
                  ))}
                  {p.reads.length > 2 && !open.has(p.page) ? <button type="button" className="bookpage__more" onClick={() => setOpen((s) => new Set(s).add(p.page))}>Read in {p.reads.length - 2} more {p.reads.length - 2 === 1 ? "class" : "classes"}</button> : null}
                </div>
              ) : null}
              {scans.has(p.page)
                ? <img className="bookpage__img" src={scanUrl(b, p.leaf)} alt={`Page ${p.page} as printed`} loading="lazy" />
                : <div className="bookpage__text">{p.text.split(/\n\s*\n/).map((para, i) => <p key={i}>{para}</p>)}</div>}
            </article>
            {mapHere ? (
              <button type="button" className="book__map book__map--wide" onClick={() => { haptic("select"); setMap(mapHere); }}>
                <img src={src(mapHere.url)} alt={mapHere.title} loading="lazy" />
                <b>{mapHere.title}</b><small>Fold-out map · tap to open</small>
              </button>
            ) : null}
          </Fragment>
        );
      })}
      <nav className="upnext">
        {next ? <Link to={`/books/${slug}/${next.k}`} className="upnext__card"><small>Next chapter</small><b>{next.title}</b><span>{next.n ? `Chapter ${next.n} · ` : ""}p. {next.page}</span></Link> : null}
        {prev ? <Link to={`/books/${slug}/${prev.k}`} className="upnext__card"><small>Before this</small><b>{prev.title}</b><span>{prev.n ? `Chapter ${prev.n} · ` : ""}p. {prev.page}</span></Link> : null}
        <Link to={`/books/${slug}`} className="upnext__card"><small>The book</small><b>{b.title}</b><span>Contents, maps and classes</span></Link>
      </nav>
      {map ? <MapViewer map={map} onClose={() => setMap(null)} /> : null}
    </Screen>
  );
}

/** A fold-out map full screen: scroll around it, zoom in to read the small print. */
function MapViewer({ map, onClose }: { map: BookMap; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const steps = [1, 2, 3.5];
  return (
    <div className="mapview" role="dialog" aria-label={map.title}>
      <div className="mapview__bar">
        <b>{map.title}</b>
        <button type="button" aria-label="Zoom out" disabled={zoom === steps[0]} onClick={() => setZoom(steps[Math.max(0, steps.indexOf(zoom) - 1)])}>−</button>
        <button type="button" aria-label="Zoom in" disabled={zoom === steps[steps.length - 1]} onClick={() => setZoom(steps[Math.min(steps.length - 1, steps.indexOf(zoom) + 1)])}>+</button>
        <button type="button" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="mapview__scroll">
        <img src={src(map.url)} alt={map.title} style={{ width: `${zoom * 100}%` }} onDoubleClick={() => setZoom(zoom === 1 ? 2 : 1)} />
      </div>
      <p className="mapview__cap">{map.caption}. Facing page {map.facing}.</p>
    </div>
  );
}
