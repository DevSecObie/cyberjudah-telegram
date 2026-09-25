import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { compressVerses, data, shelf, verseNumbers, type Citation } from "@/api/data";
import { markRead, toggleBookmark, useBookmarks, useHighlights, useLast, useProgress } from "@/lib/marks";
import { inlineVerse, share, storyVerse } from "@/lib/share";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { features, haptic, popup } from "@/tg/sdk";
import { Icon, List, Row, Section, Skeleton, Empty, useGo } from "@/ui/ui";

const SIZES = ["compact", "regular", "large"] as const;

/** Verse spans merged per citing document, so one class lists once with all its verses. */
function merge(cited: Citation[]): Citation[] {
  const by = new Map<string, Citation & { list: number[] }>();
  for (const c of cited) { const k = `${c.kind}|${c.url}`; const e = by.get(k) ?? { ...c, list: [] }; e.list.push(...verseNumbers(c.verses)); by.set(k, e); }
  return [...by.values()].map(({ list, ...c }) => ({ ...c, verses: list.length ? compressVerses(list) : "" }));
}

export function Reader() {
  const { book: slug = "", chapter = "1" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const go = useGo();
  const ch = Number(chapter);
  useBackButton(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const text = useQuery({ queryKey: ["chapter", slug, ch], queryFn: () => data.chapter(slug, ch), staleTime: Infinity });
  const cites = useQuery({ queryKey: ["cites", slug, ch], queryFn: () => data.concordance(slug, ch).then((c) => merge(c.cited_by)).catch(() => [] as Citation[]) });
  const [size, setSize] = useStored<(typeof SIZES)[number]>("size", "regular");
  const [parallel, setParallel] = useStored("parallel", false);
  const [showXref, setShowXref] = useStored("xref", false);
  const web = useQuery({ queryKey: ["web", slug, ch], queryFn: () => data.web(slug, ch).catch(() => [] as string[]), enabled: parallel });
  const xref = useQuery({ queryKey: ["xref", slug, ch], queryFn: () => data.xref(slug, ch).catch(() => ({})), enabled: showXref });
  const [marks, setMarks] = useBookmarks();
  const [hl, setHl] = useHighlights();
  const [progress, setProgress] = useProgress();
  const [, setLast] = useLast();
  useEffect(() => { document.documentElement.dataset.size = size; return () => { delete document.documentElement.dataset.size; }; }, [size]);

  const list = books.data ?? [];
  const idx = list.findIndex((b) => b.slug === slug);
  const book = list[idx];
  const name = book ? `${book.book} ${ch}` : "";
  const next = book && ch < book.chapters ? { slug, ch: ch + 1, name: `${book.book} ${ch + 1}` } : list[idx + 1] ? { slug: list[idx + 1].slug, ch: 1, name: `${list[idx + 1].book} 1` } : null;
  const prev = book && ch > 1 ? { slug, ch: ch - 1, name: `${book.book} ${ch - 1}` } : idx > 0 ? { slug: list[idx - 1].slug, ch: list[idx - 1].chapters, name: `${list[idx - 1].book} ${list[idx - 1].chapters}` } : null;
  const selected = useMemo(() => verseNumbers(params.get("v")), [params]);
  const chapterHl = useMemo(() => new Set(verseNumbers(hl[`${slug}/${ch}`])), [hl, slug, ch]);
  const counts = useMemo(() => { const m = new Map<number, number>(); for (const c of cites.data ?? []) for (const v of verseNumbers(c.verses)) m.set(v, (m.get(v) ?? 0) + 1); return m; }, [cites.data]);
  const setVerses = (nums: number[]) => setParams(nums.length ? { v: compressVerses(nums) } : {}, { replace: true });
  const toggle = (n: number) => { haptic("select"); setVerses(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n]); };
  const passage = selected.length && name ? `${name}:${compressVerses(selected)}` : "";
  const passageText = () => (text.data?.verses ?? []).filter((v) => selected.includes(v.verse)).map((v) => `${v.verse} ${v.text}`).join(" ");

  // Where they left off, and the chapter counted as read once it has been open a while.
  useEffect(() => { if (name) setLast({ slug, chapter: ch, name, at: Date.now() }); }, [slug, ch, name]);
  useEffect(() => { const t = setTimeout(() => setProgress(markRead(progress, slug, ch)), 20_000); return () => clearTimeout(t); }, [slug, ch, progress]);
  useEffect(() => { if (!text.data || !selected.length) return; const t = setTimeout(() => document.getElementById(`v${selected[0]}`)?.scrollIntoView({ block: "center" }), 60); return () => clearTimeout(t); }, [text.data, slug, ch]);

  const more = async () => {
    const id = await popup({ title: passage, message: "What would you like to do with these verses?", buttons: [
      { id: "hl", type: "default", text: chapterHl.has(selected[0]) ? "Remove highlight" : "Highlight" },
      { id: "bm", type: "default", text: "Bookmark" },
      ...(features.story ? [{ id: "story", type: "default" as const, text: "Post to story" }] : []),
      ...(features.inline ? [{ id: "inline", type: "default" as const, text: "Send via @bot" }] : []),
      { type: "cancel" }] });
    if (id === "hl") { const set = new Set(chapterHl); const on = set.has(selected[0]); for (const v of selected) on ? set.delete(v) : set.add(v); setHl({ ...hl, [`${slug}/${ch}`]: compressVerses([...set]) }); haptic("success"); }
    if (id === "bm") { setMarks(toggleBookmark(marks, { id: `${slug}/${ch}/${compressVerses(selected)}`, kind: "verse", title: passage, text: passageText(), href: `/bible/${slug}/${ch}?v=${compressVerses(selected)}` })); haptic("success"); }
    if (id === "story") storyVerse(slug, ch, selected[0], passage);
    if (id === "inline") inlineVerse(passage);
  };
  useBottomButtons(
    passage ? { text: `Share ${passage}`, onClick: () => void share({ kind: "verse", title: passage, text: passageText(), sitePath: `/bible/${slug}/${ch}`, verses: compressVerses(selected) }), shine: true }
      : next ? { text: `${next.name} →`, onClick: () => navigate(`/read/${next.slug}/${next.ch}`) } : null,
    passage ? { text: "More…", onClick: () => void more() } : prev ? { text: `← ${prev.name}`, onClick: () => navigate(`/read/${prev.slug}/${prev.ch}`) } : null,
  );

  const taught = (cites.data ?? []).filter((c) => !selected.length || !c.verses || verseNumbers(c.verses).some((n) => selected.includes(n)));
  return (
    <main className="reader">
      <div className="reader__bar">
        <button type="button" className="icon-btn" aria-label="Books" onClick={() => go(`/bible/${slug}`)}><Icon name="list" size={18} /></button>
        <h1>{name || " "}</h1>
        <button type="button" className="icon-btn" aria-pressed={parallel} aria-label="Parallel text (WEB)" title="World English Bible beside each verse" onClick={() => setParallel(!parallel)}>WEB</button>
        <button type="button" className="icon-btn" aria-pressed={showXref} aria-label="Cross references" onClick={() => setShowXref(!showXref)}><Icon name="link" size={16} /></button>
        <button type="button" className="icon-btn" aria-label={`Text size: ${size}`} onClick={() => { haptic("select"); setSize(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]); }}>Aa</button>
      </div>
      {text.isPending ? <Skeleton rows={8} /> : text.isError ? <Empty title="This chapter did not load">Check your connection and try again.</Empty> : (
        <div className="verses">
          {text.data.verses.map((row) => {
            const on = selected.includes(row.verse);
            const refs = showXref ? (xref.data as Record<string, [string, number, number][]> | undefined)?.[String(row.verse)] : undefined;
            return (
              <span key={row.verse}>
                <span id={`v${row.verse}`} className={`v${chapterHl.has(row.verse) ? " v--hl" : ""}`} role="button" tabIndex={0} aria-pressed={on} data-cited={counts.get(row.verse) ? "" : undefined} data-bm={marks.some((m) => m.id.startsWith(`${slug}/${ch}/`) && verseNumbers(m.id.split("/")[2]).includes(row.verse)) ? "" : undefined}
                  onClick={() => { if (!window.getSelection()?.toString()) toggle(row.verse); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(row.verse); } }}>
                  <sup>{row.verse}</sup>{row.text}
                </span>
                {parallel && web.data?.[row.verse - 1] ? <span className="parallel">{web.data[row.verse - 1]}</span> : null}
                {refs?.length ? <span className="xrefs">{refs.slice(0, 8).map(([s, c, v]) => <Link key={`${s}${c}${v}`} to={`/read/${s}/${c}?v=${v}`}>{list.find((b) => b.slug === s)?.book ?? s} {c}:{v}</Link>)}</span> : null}
              </span>
            );
          })}
        </div>
      )}
      {taught.length ? <div style={{ marginTop: 28 }}><Section title={selected.length ? `Taught from ${passage}` : "Taught from this chapter"}><List>{taught.slice(0, 40).map((c) => <Row key={c.url + (c.verses ?? "")} href={c.url} meta={`${shelf(c.url, c.kind)}${c.verses ? ` · v. ${c.verses}` : ""}`} title={c.label} />)}</List></Section></div> : null}
      <nav className="steps" aria-label="Chapters">
        {prev ? <Link to={`/read/${prev.slug}/${prev.ch}`}>← {prev.name}</Link> : null}
        {next ? <Link data-main="" to={`/read/${next.slug}/${next.ch}`}>{next.name} →</Link> : null}
      </nav>
    </main>
  );
}
