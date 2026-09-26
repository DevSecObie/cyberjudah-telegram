import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { data, fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, openLink } from "@/tg/sdk";
import { NoteBody, noteLede } from "@/ui/note-body";
import { NotesOpener, NotesSheet, Player } from "@/ui/player";
import { Empty, Skeleton, timestamp, youtube } from "@/ui/ui";
import { KIND_NAME } from "./Home";

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
  const [start, setStart] = useState(t);
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState(false);
  useBackButton(false, () => { if (notes) { setNotes(false); return true; } });
  const res = useTranscriptAround(video, t);
  const r = res.data;
  const note = useQuery({ queryKey: ["note", r?.ok ? r.url : ""], queryFn: () => data.note(r!.ok ? r!.url : "/"), enabled: !!(r?.ok && r.url) });
  useBottomButtons(r?.ok ? { text: "Open in YouTube", onClick: () => openLink(youtube(video, start)) } : null, null);
  useEffect(() => { if (r?.ok) setTimeout(() => document.querySelector(".tx__chunk[data-here]")?.scrollIntoView({ block: "center" }), 60); }, [r]);
  const seek = (at: number) => { setStart(at); setPlaying(true); window.scrollTo({ top: 0, behavior: "smooth" }); };
  if (res.isPending) return <main className="screen"><Skeleton rows={5} /></main>;
  if (!r || !r.ok) return <main className="screen"><Empty title="This recording is not in the transcripts yet">Its captions load with the next refresh.</Empty></main>;
  return (
    <main className="screen screen--player">
      <Player video={video} start={start} playing={playing} onPlay={() => setPlaying(true)} title={r.title} />
      <header className="note-head">
        <p className="kicker">{[KIND_NAME[r.kind as keyof typeof KIND_NAME] ?? "Recording", fmtDate(r.date)].filter(Boolean).join(" · ")}</p>
        <h1>{r.title}</h1>
      </header>
      {r.url ? <NotesOpener lede={note.data ? noteLede(note.data.body) : undefined} onOpen={() => setNotes(true)} /> : null}
      <TranscriptExcerpt video={video} t={t} chunks={r.chunks} onSeek={seek} />
      {r.url ? <NotesSheet open={notes} onClose={() => setNotes(false)} sub={note.data?.title ?? r.title}>{note.data ? <NoteBody md={note.data.body} /> : note.isError ? <Empty title="The notes did not load">Try again in a moment.</Empty> : <Skeleton rows={6} />}</NotesSheet> : null}
    </main>
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
