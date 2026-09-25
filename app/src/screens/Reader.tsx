import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { compressVerses, data, shelf, verseNumbers, type Citation } from "@/api/data";
import { COLORS, markRead, parseHl, pushHistory, setHighlight, toggleBookmark, useBookmarks, useHighlights, useHistory, useLast, usePlan, useProgress, useVerseNotes } from "@/lib/marks";
import { advance, planDay } from "@/lib/plan";
import { inlineVerse, share, storyVerse } from "@/lib/share";
import { useSpeech } from "@/lib/tts";
import { useBackButton, useBottomButtons, useStored } from "@/tg/hooks";
import { alert, features, haptic } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { Empty, Icon, List, Row, Section, Skeleton, useGo } from "@/ui/ui";

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
  const sheet = useSheet();
  const ch = Number(chapter);
  const key = `${slug}/${ch}`;
  useBackButton(false);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const text = useQuery({ queryKey: ["chapter", slug, ch], queryFn: () => data.chapter(slug, ch), staleTime: Infinity });
  const cites = useQuery({ queryKey: ["cites", slug, ch], queryFn: () => data.concordance(slug, ch).then((c) => merge(c.cited_by)).catch(() => [] as Citation[]) });
  const [size, setSize] = useStored<(typeof SIZES)[number]>("size", "regular");
  const [showXref, setShowXref] = useStored("xref", false);
  const xref = useQuery({ queryKey: ["xref", slug, ch], queryFn: () => data.xref(slug, ch).catch(() => ({})), enabled: showXref });
  const [marks, setMarks] = useBookmarks();
  const [hl, setHl] = useHighlights();
  const [notes, setNotes] = useVerseNotes(slug, ch);
  const [progress, setProgress] = useProgress();
  const [plan, setPlan] = usePlan();
  const [, setLast] = useLast();
  const [history, setHistory] = useHistory();
  useEffect(() => { document.documentElement.dataset.size = size; return () => { delete document.documentElement.dataset.size; }; }, [size]);

  const list = books.data ?? [];
  const idx = list.findIndex((b) => b.slug === slug);
  const book = list[idx];
  const name = book ? `${book.book} ${ch}` : "";
  const next = book && ch < book.chapters ? { slug, ch: ch + 1, name: `${book.book} ${ch + 1}` } : list[idx + 1] ? { slug: list[idx + 1].slug, ch: 1, name: `${list[idx + 1].book} 1` } : null;
  const prev = book && ch > 1 ? { slug, ch: ch - 1, name: `${book.book} ${ch - 1}` } : idx > 0 ? { slug: list[idx - 1].slug, ch: list[idx - 1].chapters, name: `${list[idx - 1].book} ${list[idx - 1].chapters}` } : null;
  const selected = useMemo(() => verseNumbers(params.get("v")), [params]);
  const chapterHl = useMemo(() => parseHl(hl[key]), [hl, key]);
  const counts = useMemo(() => { const m = new Map<number, number>(); for (const c of cites.data ?? []) for (const v of verseNumbers(c.verses)) m.set(v, (m.get(v) ?? 0) + 1); return m; }, [cites.data]);
  const setVerses = (nums: number[]) => setParams(nums.length ? { v: compressVerses(nums) } : {}, { replace: true });
  const toggle = (n: number) => { haptic("select"); setVerses(selected.includes(n) ? selected.filter((x) => x !== n) : [...selected, n]); };
  const passage = selected.length && name ? `${name}:${compressVerses(selected)}` : "";
  const passageText = () => (text.data?.verses ?? []).filter((v) => selected.includes(v.verse)).map((v) => `${v.verse} ${v.text}`).join(" ");
  const verses = text.data?.verses ?? [];
  const speech = useSpeech(verses, name);

  // Where they left off, the history, and the chapter counted as read after a while.
  useEffect(() => { if (name) { setLast({ slug, chapter: ch, name, at: Date.now() }); setHistory(pushHistory(history, { slug, chapter: ch, name })); } }, [slug, ch, name]); // eslint-disable-line react-hooks/exhaustive-deps
  const progressRef = useRef(progress); progressRef.current = progress;
  useEffect(() => { const t = setTimeout(() => setProgress(markRead(progressRef.current, slug, ch)), 20_000); return () => clearTimeout(t); }, [slug, ch]); // eslint-disable-line react-hooks/exhaustive-deps
  // The plan moves on when today's chapters are all read.
  useEffect(() => { if (plan && list.length && planDay(plan, list, progress).done) { setPlan(advance(plan)); haptic("success"); } }, [plan, list, progress]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!text.data || !selected.length) return; const t = setTimeout(() => document.getElementById(`v${selected[0]}`)?.scrollIntoView({ block: "center" }), 60); return () => clearTimeout(t); }, [text.data, slug, ch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (speech.current) document.getElementById(`v${speech.current}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [speech.current]);

  /** The verse menu: highlight colours, a note, bookmark, copy, look up, share elsewhere. */
  const more = async () => {
    const first = selected[0];
    const hasHl = chapterHl.has(first);
    const a = await sheet.open({
      title: passage,
      colors: COLORS.map((c) => ({ ...c, on: chapterHl.get(first) === c.id })),
      items: [
        ...(hasHl ? [{ id: "unhl", text: "Remove highlight" }] : []),
        { id: "note", text: notes[String(first)] ? "Edit note" : "Add a note", hint: "Kept with the verse, on every device", icon: <Icon name="note" size={16} /> },
        { id: "bm", text: marks.some((m) => m.id === `${slug}/${ch}/${compressVerses(selected)}`) ? "Remove bookmark" : "Bookmark", icon: <Icon name="bookmark" size={16} /> },
        { id: "copy", text: "Copy", hint: "The verses with their reference", icon: <Icon name="copy" size={16} /> },
        { id: "dict", text: "Look up in the dictionary", hint: "Names, places and words in these verses", icon: <Icon name="book" size={16} /> },
        { id: "find", text: "Find in the library", hint: "Every class and note that cites this passage", icon: <Icon name="search" size={16} /> },
        ...(features.story ? [{ id: "story", text: "Post to your story", icon: <Icon name="star" size={16} /> }] : []),
        ...(features.inline ? [{ id: "inline", text: "Send via @bot", hint: "Paste the verse into any chat", icon: <Icon name="share" size={16} /> }] : []),
      ],
    });
    if (!a) return;
    if (COLORS.some((c) => c.id === a.id)) { setHl(setHighlight(hl, key, selected, chapterHl.get(first) === a.id ? null : a.id)); haptic("success"); }
    if (a.id === "unhl") setHl(setHighlight(hl, key, selected, null));
    if (a.id === "note") {
      const n = await sheet.open({ title: `Note on ${passage}`, text: { label: "Your note", value: notes[String(first)] ?? "", placeholder: "What this verse says to you…", submit: "Save" } });
      if (n?.id === "text") { const nextNotes = { ...notes }; if (n.value) nextNotes[String(first)] = n.value.slice(0, 1000); else delete nextNotes[String(first)]; setNotes(nextNotes); haptic("success"); }
    }
    if (a.id === "bm") { setMarks(toggleBookmark(marks, { id: `${slug}/${ch}/${compressVerses(selected)}`, kind: "verse", title: passage, text: passageText(), href: `/bible/${slug}/${ch}?v=${compressVerses(selected)}` })); haptic("success"); }
    if (a.id === "copy") { try { await navigator.clipboard.writeText(`${passageText()}\n— ${passage} (KJV)`); haptic("success"); } catch { void alert("Copying is not allowed here. Select the text instead."); } }
    if (a.id === "dict") navigate(`/dictionary?from=${encodeURIComponent(passageText().slice(0, 300))}`);
    if (a.id === "find") navigate(`/search?q=${encodeURIComponent(passage)}`);
    if (a.id === "story") storyVerse(slug, ch, first, passage);
    if (a.id === "inline") inlineVerse(passage);
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
        {speech.supported ? <button type="button" className="icon-btn" aria-pressed={speech.playing} aria-label={speech.playing ? "Stop listening" : "Listen to this chapter"} onClick={() => (speech.playing ? speech.stop() : speech.play(selected[0] ?? 1))}><Icon name="play" size={16} /></button> : null}
        <button type="button" className="icon-btn" aria-pressed={showXref} aria-label="Cross references" onClick={() => setShowXref(!showXref)}><Icon name="link" size={16} /></button>
        <button type="button" className="icon-btn" aria-label={`Text size: ${size}`} onClick={() => { haptic("select"); setSize(SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]); }}>Aa</button>
      </div>
      {text.isPending ? <Skeleton rows={8} /> : text.isError ? <Empty title="This chapter did not load">Check your connection, or save this book for offline reading in Settings.</Empty> : (
        <div className="verses">
          {verses.map((row) => {
            const on = selected.includes(row.verse);
            const refs = showXref ? (xref.data as Record<string, [string, number, number][]> | undefined)?.[String(row.verse)] : undefined;
            const note = notes[String(row.verse)];
            return (
              <span key={row.verse}>
                <span id={`v${row.verse}`} className="v" role="button" tabIndex={0} aria-pressed={on} data-hl={chapterHl.get(row.verse)} data-note={note ? "" : undefined} data-reading={speech.current === row.verse ? "" : undefined} data-cited={counts.get(row.verse) ? "" : undefined} data-bm={marks.some((m) => m.id.startsWith(`${key}/`) && verseNumbers(m.id.split("/")[2]).includes(row.verse)) ? "" : undefined}
                  onClick={() => { if (!window.getSelection()?.toString()) toggle(row.verse); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(row.verse); } }}>
                  <sup>{row.verse}</sup>{row.text}
                </span>
                {note ? <span className="vnote" onClick={() => { setVerses([row.verse]); void more(); }}>{note}</span> : null}
                {refs?.length ? <span className="xrefs">{refs.slice(0, 8).map(([s, c, v]) => <Link key={`${s}${c}${v}`} to={`/read/${s}/${c}?v=${v}`}>{list.find((b) => b.slug === s)?.book ?? s} {c}:{v}</Link>)}</span> : null}
              </span>
            );
          })}
        </div>
      )}
      {speech.playing ? (
        <div className="listen" role="region" aria-label="Listening">
          <button type="button" className="icon-btn" aria-label={speech.paused ? "Resume" : "Pause"} onClick={speech.toggle}>{speech.paused ? "▶" : "❚❚"}</button>
          <b>{speech.current ? `Verse ${speech.current}` : name}</b>
          <div className="listen__rate">{[0.8, 1, 1.25, 1.5].map((r) => <button key={r} type="button" aria-pressed={speech.rate === r} onClick={() => { speech.setRate(r); if (speech.current) speech.play(speech.current); }}>{r}×</button>)}</div>
          <button type="button" className="icon-btn" aria-label="Stop" onClick={speech.stop}>×</button>
        </div>
      ) : null}
      {taught.length ? <div style={{ marginTop: 28 }}><Section title={selected.length ? `Taught from ${passage}` : "Taught from this chapter"}><List>{taught.slice(0, 40).map((c) => <Row key={c.url + (c.verses ?? "")} href={c.url} meta={`${shelf(c.url, c.kind)}${c.verses ? ` · v. ${c.verses}` : ""}`} title={c.label} />)}</List></Section></div> : null}
      <nav className="steps" aria-label="Chapters">
        {prev ? <Link to={`/read/${prev.slug}/${prev.ch}`}>← {prev.name}</Link> : null}
        {next ? <Link data-main="" to={`/read/${next.slug}/${next.ch}`}>{next.name} →</Link> : null}
      </nav>
    </main>
  );
}
