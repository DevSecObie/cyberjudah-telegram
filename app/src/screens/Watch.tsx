import { useQuery } from "@tanstack/react-query";
import { RequestNotes } from "@/ui/request-notes";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { data, fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, openLink } from "@/tg/sdk";
import { NoteBody, noteLede } from "@/ui/note-body";
import { Frame } from "@/lib/frames";
import { NotesOpener, NotesSheet, Player } from "@/ui/player";
import { Empty, Skeleton, timestamp, youtube } from "@/ui/ui";
import { KIND_NAME, useLive, useRecent } from "./Home";

export type TranscriptWindow = { ok: true; video: string; kind: string; title: string; url: string; date: string; duration: number | null; t: number; chunks: { t: number; text: string }[] } | { ok: false; reason: string };
export const useTranscriptAround = (video: string | null, t: number) => useQuery({ queryKey: ["transcript", video, Math.round(t)], enabled: !!video, queryFn: () => api<TranscriptWindow>(`/api/transcript/${encodeURIComponent(video!)}?t=${Math.round(t)}`), staleTime: 60 * 60_000 });

/**
 * A recording at a moment, laid out like YouTube on a phone: the player pinned on top, what
 * was said around the second beneath it (each line a tap into the video from there), and the
 * class notes in a sheet that slides up under the player when there is a write-up.
 */
export function Watch() {
  const { video = "" } = useParams();
  const [params] = useSearchParams();
  const t = Math.max(0, Number(params.get("t")) || 0);
  const isLive = params.get("live") === "1";
  const [start, setStart] = useState(t);
  const [playing, setPlaying] = useState(false);
  const [full, setFull] = useState(false);
  const [notes, setNotes] = useState(false);
  useBackButton(false, () => { if (notes) { setNotes(false); return true; } });
  const res = useTranscriptAround(isLive ? null : video, t);
  const live = useLive(isLive);
  const r = res.data;
  const recent = useRecent();
  const meta = recent.data?.find((v) => v.video === video);
  const note = useQuery({ queryKey: ["note", r?.ok ? r.url : ""], queryFn: () => data.note(r!.ok ? r!.url : "/"), enabled: !!(r?.ok && r.url) });
  useBottomButtons(res.isPending ? null : { text: "Open in YouTube", onClick: () => openLink(youtube(video, isLive ? 0 : start)) }, null);
  useEffect(() => { if (r?.ok) setTimeout(() => document.querySelector(".tx__chunk[data-here]")?.scrollIntoView({ block: "center" }), 60); }, [r]);
  const seek = (at: number) => { setStart(at); setPlaying(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  if (isLive) return (
    <main className="screen screen--player">
      <Player video={video} start={0} playing={playing} onPlay={() => setPlaying(true)} title={live.data?.title || "Live class"} live />
      <header className="note-head">
        <p className="kicker">{live.data?.live ? "Live now · Sabbath class" : live.data?.upcoming ? "Starting soon" : "Sabbath class"}</p>
        <h1>{live.data?.title || "Live class"}</h1>
      </header>
      <p className="hint">The class is streaming from YouTube. Its captions, the search and the notes follow once the stream has ended.</p>
    </main>
  );
  if (res.isPending) return <main className="screen"><Skeleton rows={5} /></main>;
  if (!r || !r.ok) return (
    <main className="screen screen--player">
      <Player video={video} start={start} playing={playing} onPlay={() => setPlaying(true)} title={meta?.title || "Class recording"} />
      <header className="note-head">
        <p className="kicker">{["Sabbath class", meta ? fmtDate(meta.published.slice(0, 10)) : ""].filter(Boolean).join(" · ")}</p>
        <h1>{meta?.title || "Class recording"}</h1>
      </header>
      <p className="hint">The captions for this class are on their way. Watch the recording meanwhile; the search and Ask CyberJudah pick it up once the captions land.</p>
      <NotesWanted video={video} title={meta?.title || ""} />
    </main>
  );
  return (
    <main className="screen screen--player">
      <Player video={video} start={start} playing={playing} onPlay={() => setPlaying(true)} title={r.title} pip={full && notes && playing} onExpand={() => setFull(false)} />
      <header className="note-head">
        <p className="kicker">{[KIND_NAME[r.kind as keyof typeof KIND_NAME] ?? "Recording", fmtDate(r.date)].filter(Boolean).join(" · ")}</p>
        <h1>{r.title}</h1>
      </header>
      {r.url ? <NotesOpener lede={note.data ? noteLede(note.data.body) : undefined} onOpen={() => setNotes(true)} /> : <NotesWanted video={video} title={r.title} />}
      <TranscriptExcerpt video={video} t={t} chunks={r.chunks} onSeek={seek} />
      {r.url ? <NotesSheet open={notes} onClose={() => setNotes(false)} full={full} onFull={setFull} sub={note.data?.title ?? r.title}>{note.data ? <NoteBody md={note.data.body} video={video} onSeek={seek} /> : note.isError ? <Empty title="The notes did not load">Try again in a moment.</Empty> : <Skeleton rows={6} />}</NotesSheet> : null}
    </main>
  );
}

/** A class without notes: notes are written when readers ask for them, so ask here. */
function NotesWanted({ video, title }: { video: string; title: string }) {
  return (
    <section className="notes-wanted">
      <p><b>No notes for this class yet.</b> Notes are written from a class when readers ask for it. Ask, and the most requested are written first.</p>
      <RequestNotes video={video} title={title} />
    </section>
  );
}

/** The captions around a moment, the found chunk marked, each a tap into the recording. */
export function TranscriptExcerpt({ video, t, chunks, onSeek }: { video: string; t: number; chunks: { t: number; text: string }[]; onSeek?: (t: number) => void }) {
  const here = chunks.reduce((best, c, i) => (Math.abs(c.t - t) < Math.abs(chunks[best].t - t) ? i : best), 0);
  const play = (at: number) => (onSeek ? onSeek(at) : openLink(youtube(video, at)));
  return (
    <section className="section">
      <div className="section__head"><h2>Spoken at {timestamp(t)}</h2></div>
      <div className="tx">
        <Frame video={video} t={t} width={160} className="tx__frame" onClick={() => play(t)} />
        {chunks.map((c, i) => (
          <p key={c.t} className="tx__chunk" data-here={i === here ? "" : undefined}>
            <button type="button" onClick={() => play(c.t)}>{timestamp(c.t)}</button>{c.text}
          </p>
        ))}
        {!chunks.length ? <p className="hint">No captions around this moment.</p> : null}
      </div>
    </section>
  );
}
