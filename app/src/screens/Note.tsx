import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useLocation } from "react-router";

import { data, fmtDate, when, type HistoryEpisode } from "@/api/data";
import { toggleBookmark, useBookmarks, useLastNote } from "@/lib/marks";
import { Link, useSearchParams } from "react-router";
import { useTeachings } from "./Home";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { haptic, openLink, setClosingConfirmation } from "@/tg/sdk";
import { Empty, Icon, Img, Skeleton, thumbOf, timestamp, useGo, youtube } from "@/ui/ui";
import { TranscriptExcerpt, useTranscriptAround } from "./Watch";

marked.setOptions({ gfm: true, breaks: false });
const KIND: Record<string, string> = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "4 Chapters a Day", encyclopedia: "Encyclopedia" };

/** The note's markdown, with the video mount dropped (the app has its own player button). */
function render(md: string): string {
  const src = md.replace(/<!--\s*truncate\s*-->/g, "").replace(/[ \t]+taught in \[[^\]]+\]\(\/study\/[^)]+\)/g, "").replace(/<div class="class-video-mount"[^>]*><\/div>/g, "");
  const slug = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Headings carry an id from their text, so a search hit opens the class at its section.
  return (marked.parse(src) as string).replace(/<(li|p)>\s*<strong>([A-Z][^<:]{1,40}):<\/strong>\s*/g, '<$1><span class="who">$2</span>').replace(/<h([2-4])>(.*?)<\/h\1>/g, (_m, l: string, t: string) => `<h${l} id="${slug(t)}">${t}</h${l}>`);
}

/** A class, episode, study or encyclopedia note: the recording on top, the write-up below. */
export function NoteScreen() {
  const location = useLocation();
  const path = location.pathname.replace(/^\/note/, "") || "/";
  const go = useGo();
  useBackButton(false);
  const note = useQuery({ queryKey: ["note", path], queryFn: () => data.note(path) });
  const isHistory = path.startsWith("/history/");
  const episode = useQuery({ queryKey: ["episode", path], queryFn: () => data.episode(path.replace(/^\/history\//, "")), enabled: isHistory });
  const html = useMemo(() => (note.data ? render(note.data.body) : ""), [note.data]);
  const [marks, setMarks] = useBookmarks();
  const [, setLastNote] = useLastNote();
  const [params] = useSearchParams();
  const teachings = useTeachings();
  const kept = marks.some((m) => m.id === path);
  const feedIdx = teachings.data?.findIndex((t) => t.url === path) ?? -1;
  const me = feedIdx >= 0 ? teachings.data![feedIdx] : undefined;
  const next = feedIdx > 0 ? teachings.data![feedIdx - 1] : undefined;
  const prev = feedIdx >= 0 ? teachings.data![feedIdx + 1] : undefined;
  useEffect(() => { if (note.data && (isHistory || path.startsWith("/classes/") || path.startsWith("/captains/"))) setLastNote({ href: `/note${path}`, title: note.data.title, at: Date.now() }); }, [note.data?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  const video = note.data?.videoId ?? episode.data?.videoId ?? params.get("video") ?? null;
  // A search hit in the captions: the moment it was said, with the words around it.
  const at = params.has("t") ? Math.max(0, Number(params.get("t")) || 0) : null;
  const spoken = useTranscriptAround(at !== null ? video : null, at ?? 0);

  useBottomButtons(
    note.data ? { text: "Share", onClick: () => void share({ kind: "note", title: note.data!.title, text: KIND[note.data!.kind] ?? "CyberJudah", sitePath: path }) } : null,
    video ? { text: at !== null ? `▶ Watch from ${timestamp(at)}` : "▶ Watch", onClick: () => openLink(youtube(video, at ?? 0)) } : null,
  );
  // Reading a long note: keep a stray swipe from closing the app mid-read.
  useEffect(() => { setClosingConfirmation(true); return () => setClosingConfirmation(false); }, []);
  useEffect(() => {
    if (!html || !location.hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" }), 60);
    return () => clearTimeout(t);
  }, [html, location.hash]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a"); const href = a?.getAttribute("href") ?? "";
    if (!a) return;
    e.preventDefault();
    if (/^https?:/.test(href)) openLink(href); else if (href.startsWith("/")) go(href);
  };

  if (note.isPending) return <main className="screen"><Skeleton rows={6} /></main>;
  if (note.isError || !note.data) return <main className="screen"><Empty title="This note did not load">It may have moved. Search for it instead.</Empty></main>;
  const n = note.data;
  return (
    <main className="screen">
      <header className="note-head">
        <p className="kicker">{[KIND[n.kind] ?? "", when(n.date, n.teacher)].filter(Boolean).join(" · ")}</p>
        <h1>{n.title}</h1>
        <div className="head__actions">
          <button type="button" className="icon-btn" aria-pressed={kept} aria-label={kept ? "Remove bookmark" : "Bookmark"} onClick={() => { haptic(kept ? "tap" : "success"); setMarks(toggleBookmark(marks, { id: path, kind: "note", title: n.title, text: [KIND[n.kind], fmtDate(n.date)].filter(Boolean).join(" · "), href: path })); }}><Icon name={kept ? "bookmarkFill" : "bookmark"} size={18} /></button>
        </div>
      </header>
      {video ? <button type="button" className="watch" onClick={() => openLink(youtube(video, at ?? 0))} aria-label={`Watch ${n.title}`}><Img src={thumbOf(video, true)} eager /><span><Icon name="play" size={18} /> {at !== null ? `Watch from ${timestamp(at)}` : "Watch the recording"}</span></button> : null}
      {at !== null && video && spoken.data?.ok ? <TranscriptExcerpt video={video} t={at} chunks={spoken.data.chunks} /> : null}
      {me?.books.length ? <div className="taught"><span className="taught__label">Taught from</span>{me.books.slice(0, 6).map((b) => <Link key={b} to={`/read/${b.toLowerCase().replace(/\s+/g, "-")}/1`} className="taught__book">{b}</Link>)}</div> : null}
      <div className="note" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {isHistory && episode.data?.turns?.length ? <Transcript ep={episode.data} find={params.get("find") ?? ""} /> : null}
      {next || prev ? (
        <div className="upnext">
          {next ? <Link to={`/note${next.url}`} className="upnext__card"><small>Up next</small><b>{next.title}</b><span>{when(next.date, next.teacher)}</span></Link> : null}
          {prev ? <Link to={`/note${prev.url}`} className="upnext__card"><small>Before this</small><b>{prev.title}</b><span>{when(prev.date, prev.teacher)}</span></Link> : null}
        </div>
      ) : null}
    </main>
  );
}

/** Our Hidden History: the verbatim transcript, each turn a tap from the moment in the recording. */
function Transcript({ ep, find }: { ep: HistoryEpisode; find: string }) {
  const [open, setOpen] = useState(false);
  const found = find ? ep.turns.findIndex((t) => t.text.toLowerCase().includes(find.toLowerCase().slice(0, 40))) : -1;
  useEffect(() => { if (found >= 0) { setOpen(true); setTimeout(() => document.getElementById(`turn-${found}`)?.scrollIntoView({ block: "center" }), 80); } }, [found]);
  const turns = open ? ep.turns : ep.turns.slice(0, 6);
  return (
    <section className="section">
      <div className="section__head"><h2>Transcript</h2><button type="button" className="link" onClick={() => setOpen(!open)}>{open ? "Show less" : `All ${ep.turns.length} turns`}</button></div>
      <div className="transcript">{turns.map((t, i) => <p key={i} id={`turn-${i}`} data-found={i === found ? "" : undefined}><button type="button" onClick={() => openLink(youtube(ep.videoId, t.t))}>{timestamp(t.t)}</button>{t.text}</p>)}</div>
    </section>
  );
}
