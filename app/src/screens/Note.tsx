import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";

import { data, fmtDate, when, type HistoryEpisode } from "@/api/data";
import { toggleBookmark, useBookmarks, useLastNote } from "@/lib/marks";
import { showOf } from "@/lib/series";
import { Link, useSearchParams } from "react-router";
import { teachingLabel, useTeachings } from "./Home";
import { share } from "@/lib/share";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, haptic, openLink, setClosingConfirmation, alert, downloadFile, features } from "@/tg/sdk";
import { useSheet } from "@/ui/sheet";
import { NoteBody, noteLede } from "@/ui/note-body";
import { noteFirstMoment } from "@/ui/note-body";
import { NotesOpener, NotesSheet, Player } from "@/ui/player";
import { NoteEditSheet } from "@/ui/note-edit";
import { Empty, Icon, Skeleton, timestamp, youtube } from "@/ui/ui";
import { TranscriptExcerpt, useTranscriptAround } from "./Watch";

const KIND: Record<string, string> = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "4 Chapters a Day", encyclopedia: "Encyclopedia" };

/**
 * A class, episode, study or encyclopedia note. With a recording it is laid out like YouTube
 * on a phone: the player pinned on top and the write-up in a sheet beneath it that scrolls
 * on its own, so the class keeps playing while you read. Without one, the write-up itself.
 */
export function NoteScreen() {
  const location = useLocation();
  const sheet = useSheet();
  const path = location.pathname.replace(/^\/note/, "") || "/";
  const note = useQuery({ queryKey: ["note", path], queryFn: () => data.note(path) });
  const isHistory = path.startsWith("/history/");
  const episode = useQuery({ queryKey: ["episode", path], queryFn: () => data.episode(path.replace(/^\/history\//, "")), enabled: isHistory });
  const [marks, setMarks] = useBookmarks();
  const [, setLastNote] = useLastNote();
  const [params] = useSearchParams();
  const teachings = useTeachings();
  const kept = marks.some((m) => m.id === path);
  const feedIdx = teachings.data?.findIndex((t) => t.url === path) ?? -1;
  const me = feedIdx >= 0 ? teachings.data![feedIdx] : undefined;
  // A class in a series is shown as that series, not as a plain Sabbath class.
  const label = (kind: string) => (me?.series ? teachingLabel(me) : (kind === "class" && note.data ? showOf(note.data.title) : null) ?? KIND[kind]);
  const next = feedIdx > 0 ? teachings.data![feedIdx - 1] : undefined;
  const prev = feedIdx >= 0 ? teachings.data![feedIdx + 1] : undefined;
  useEffect(() => { if (note.data && (isHistory || path.startsWith("/classes/") || path.startsWith("/captains/"))) setLastNote({ href: `/note${path}`, title: note.data.title, at: Date.now() }); }, [note.data?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  const video = note.data?.videoId ?? episode.data?.videoId ?? params.get("video") ?? null;
  // A search hit in the captions: the moment it was said, with the words around it.
  const at = params.has("t") ? Math.max(0, Number(params.get("t")) || 0) : null;
  const spoken = useTranscriptAround(at !== null ? video : null, at ?? 0);
  // Coming to read (no moment given), the notes open at once; coming from a spoken moment, the words around it come first.
  const [start, setStart] = useState(at ?? 0);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const [notes, setNotes] = useState(at === null || !!location.hash);
  // Admins edit a note in place: the teacher, the title, a spelling. /api/me says who may.
  const who = useQuery({ queryKey: ["me"], queryFn: () => api<{ canEdit?: boolean }>("/api/me"), staleTime: 600_000, retry: false });
  const [editing, setEditing] = useState(false);
  const saved = (changed: string[], commit: string) => { setEditing(false); void alert(`Saved: ${changed.join("; ")}. The app shows it once the library rebuilds, in a few minutes.`); void commit; };
  useBackButton(false, () => { if (notes && video && at !== null) { setNotes(false); return true; } });
  const seek = (t: number) => { setStart(t); setPlaying(true); setNotes(false); window.scrollTo({ top: 0, behavior: "smooth" }); };

  useBottomButtons(
    note.data ? { text: "Share", onClick: () => void share({ kind: "note", title: note.data!.title, text: label(note.data!.kind) ?? "CyberJudah", sitePath: path }) } : null,
    video ? { text: "Open in YouTube", onClick: () => openLink(youtube(video, start)) } : null,
  );
  // Reading a long note: keep a stray swipe from closing the app mid-read.
  useEffect(() => { setClosingConfirmation(true); return () => setClosingConfirmation(false); }, []);
  useEffect(() => {
    if (!note.data || !location.hash) return;
    const t = setTimeout(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: "start" }), 120);
    return () => clearTimeout(t);
  }, [note.data, location.hash, notes]);

  if (note.isPending) return <main className="screen"><Skeleton rows={6} /></main>;
  if (note.isError || !note.data) {
    // A recording hit whose notes are missing still opens the recording at its moment.
    if (at !== null && video) return <Navigate to={`/watch/${encodeURIComponent(video)}?t=${Math.round(at)}`} replace />;
    return <main className="screen"><Empty title="This note did not load">It may have moved. Search for it instead.</Empty></main>;
  }
  const n = note.data;
  // The note as a PDF: downloaded through Telegram where it can, or sent to the chat with the bot.
  const exportPdf = async () => {
    haptic("select");
    const a = await sheet.open({ title: "Export as PDF", items: [
      ...(features.download ? [{ id: "download", text: "Download the PDF", hint: "Saved to this device" }] : []),
      { id: "send", text: "Send it to my Telegram chat", hint: "The CyberJudah bot sends you the file" },
    ] });
    if (!a) return;
    try {
      const r = await api<{ ok: boolean; url?: string; file?: string }>("/api/notes/pdf", { method: "POST", json: { path, send: a.id === "send" } });
      if (a.id === "send") { haptic("success"); void alert("Sent. The PDF is in your chat with the CyberJudah bot."); }
      else if (r.url) downloadFile(r.url, r.file ?? "note.pdf");
    } catch {
      void alert(a.id === "send" ? "The bot could not send the file. Open a chat with the CyberJudah bot, press Start, and try again." : "The PDF could not be made just now. Try again in a moment.");
    }
  };
  const pdfButton = <button type="button" className="icon-btn" aria-label="Export as PDF" onClick={() => void exportPdf()}><Icon name="download" size={18} /></button>;
  // The verse the reader came from (a precept, a comment or a theme opened this note): a way straight back to it.
  const from = params.get("from");
  const fromLabel = (() => { const m = from && /^\/read\/([a-z0-9-]+)\/(\d+)(?:\?v=(\d+))?/.exec(from); if (!m) return null; const book = m[1].split("-").map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" "); return `${book} ${m[2]}${m[3] ? `:${m[3]}` : ""}`; })();
  const backTo = from && fromLabel ? <Link to={from} className="backto"><Icon name="back" size={14} /> Back to {fromLabel}</Link> : null;
  const head = (
    <header className="note-head">
      {backTo}
      <p className="kicker">{[label(n.kind) ?? "", when(n.date, n.teacher)].filter(Boolean).join(" · ")}</p>
      <h1>{n.title}</h1>
      <div className="head__actions">
        {pdfButton}
        {who.data?.canEdit && n.file ? <button type="button" className="icon-btn" aria-label="Edit this note" onClick={() => { haptic("select"); setEditing(true); }}><Icon name="note" size={18} /></button> : null}
        <button type="button" className="icon-btn" aria-pressed={kept} aria-label={kept ? "Remove bookmark" : "Bookmark"} onClick={() => { haptic(kept ? "tap" : "success"); setMarks(toggleBookmark(marks, { id: path, kind: "note", title: n.title, text: [label(n.kind), fmtDate(n.date)].filter(Boolean).join(" · "), href: path })); }}><Icon name={kept ? "bookmarkFill" : "bookmark"} size={18} /></button>
      </div>
    </header>
  );
  const taught = me?.books.length ? <div className="taught"><span className="taught__label">Taught from</span>{me.books.slice(0, 6).map((b) => <Link key={b} to={`/read/${b.toLowerCase().replace(/\s+/g, "-")}/1`} className="taught__book">{b}</Link>)}</div> : null;
  // Books read aloud in this class (the library), each page to the book and the moment it was read.
  const readFrom = n.books?.length ? (
    <div className="taught">
      <span className="taught__label">Read from</span>
      {Object.values(n.books.reduce<Record<string, typeof n.books>>((a, b) => ((a[b.slug] ??= []).push(b), a), {})).map((bs) => (
        <span key={bs[0].slug} className="readfrom">
          <Link to={`/books/${bs[0].slug}/p/${bs[0].vol}-${bs[0].page}`} className="taught__book">{bs[0].title}</Link>
          {[...new Map(bs.map((b) => [`${b.vol}-${b.page}`, b])).values()].map((b) => video
            ? <button key={`${b.vol}-${b.page}`} type="button" className="readfrom__page" onClick={() => seek(b.t)}>{bs.some((x) => x.vol !== b.vol) || b.vol > 1 ? `vol. ${b.vol} ` : ""}p. {b.page} · {b.ts}</button>
            : <Link key={`${b.vol}-${b.page}`} to={`/books/${b.slug}/p/${b.vol}-${b.page}`} className="readfrom__page">{b.vol > 1 ? `vol. ${b.vol} ` : ""}p. {b.page}</Link>)}
        </span>
      ))}
    </div>
  ) : null;
  const upnext = next || prev ? (
    <div className="upnext">
      {next ? <Link to={`/note${next.url}`} className="upnext__card"><small>Up next</small><b>{next.title}</b><span>{when(next.date, next.teacher)}</span></Link> : null}
      {prev ? <Link to={`/note${prev.url}`} className="upnext__card"><small>Before this</small><b>{prev.title}</b><span>{when(prev.date, prev.teacher)}</span></Link> : null}
    </div>
  ) : null;
  if (video) return (
    <main className="screen screen--player">
      <Player video={video} start={start} playing={playing} onPlay={() => setPlaying(true)} title={n.title} pip={full && notes && playing} onExpand={() => setFull(false)} />
      {head}
      <NotesOpener lede={noteLede(n.body)} at={noteFirstMoment(n.body)} onSeek={seek} onOpen={() => setNotes(true)} />
      {at !== null && spoken.data?.ok ? <TranscriptExcerpt video={video} t={at} chunks={spoken.data.chunks} onSeek={seek} /> : null}
      {taught}
      {readFrom}
      {isHistory && episode.data?.turns?.length ? <Transcript ep={episode.data} find={params.get("find") ?? ""} onSeek={seek} /> : null}
      {upnext}
      <NotesSheet open={notes} onClose={() => setNotes(false)} full={full} onFull={setFull} sub={n.title} action={<>{pdfButton}{who.data?.canEdit && n.file ? <button type="button" className="icon-btn" aria-label="Edit this note" onClick={() => { haptic("select"); setEditing(true); }}><Icon name="note" size={18} /></button> : null}</>}><NoteBody md={n.body} video={video} onSeek={seek} series={me?.series ? teachingLabel(me) : undefined} /></NotesSheet>
      {editing ? <NoteEditSheet open onClose={() => setEditing(false)} note={n} onSaved={saved} /> : null}
    </main>
  );
  return (
    <main className="screen">
      {head}
      {taught}
      {readFrom}
      <NoteBody md={n.body} series={me?.series ? teachingLabel(me) : undefined} />
      {upnext}
      {editing ? <NoteEditSheet open onClose={() => setEditing(false)} note={n} onSaved={saved} /> : null}
    </main>
  );
}

/** Our Hidden History: the verbatim transcript, each turn a tap from the moment in the recording. */
function Transcript({ ep, find, onSeek }: { ep: HistoryEpisode; find: string; onSeek: (t: number) => void }) {
  const [open, setOpen] = useState(false);
  const found = find ? ep.turns.findIndex((t) => t.text.toLowerCase().includes(find.toLowerCase().slice(0, 40))) : -1;
  useEffect(() => { if (found >= 0) { setOpen(true); setTimeout(() => document.getElementById(`turn-${found}`)?.scrollIntoView({ block: "center" }), 80); } }, [found]);
  const turns = open ? ep.turns : ep.turns.slice(0, 6);
  return (
    <section className="section">
      <div className="section__head"><h2>Transcript</h2><button type="button" className="link" onClick={() => setOpen(!open)}>{open ? "Show less" : `All ${ep.turns.length} turns`}</button></div>
      <div className="transcript">{turns.map((t, i) => <p key={i} id={`turn-${i}`} data-found={i === found ? "" : undefined}><button type="button" onClick={() => onSeek(t.t)}>{timestamp(t.t)}</button>{t.text}</p>)}</div>
    </section>
  );
}
