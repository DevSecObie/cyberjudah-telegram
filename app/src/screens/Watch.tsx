import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, openLink } from "@/tg/sdk";
import { Empty, Icon, Img, Skeleton, thumbOf, timestamp, youtube } from "@/ui/ui";
import { KIND_NAME } from "./Home";

export type TranscriptWindow = { ok: true; video: string; kind: string; title: string; url: string; date: string; duration: number | null; t: number; chunks: { t: number; text: string }[] } | { ok: false; reason: string };
export const useTranscriptAround = (video: string | null, t: number) => useQuery({ queryKey: ["transcript", video, Math.round(t)], enabled: !!video, queryFn: () => api<TranscriptWindow>(`/api/transcript/${encodeURIComponent(video!)}?t=${Math.round(t)}`), staleTime: 60 * 60_000 });

/**
 * A recording at a moment: what was said around the second a search found, each chunk a tap
 * into the video from there. Recordings with a written-up class link to its notes.
 */
export function Watch() {
  const { video = "" } = useParams();
  const [params] = useSearchParams();
  const t = Math.max(0, Number(params.get("t")) || 0);
  useBackButton(false);
  const res = useTranscriptAround(video, t);
  const r = res.data;
  useBottomButtons(r?.ok ? { text: `▶ Watch from ${timestamp(t)}`, onClick: () => openLink(youtube(video, t)) } : null, null);
  useEffect(() => { if (r?.ok) setTimeout(() => document.querySelector(".tx__chunk[data-here]")?.scrollIntoView({ block: "center" }), 60); }, [r]);
  if (res.isPending) return <main className="screen"><Skeleton rows={5} /></main>;
  if (!r || !r.ok) return <main className="screen"><Empty title="This recording is not in the transcripts yet">Its captions load with the next refresh.</Empty></main>;
  return (
    <main className="screen">
      <header className="note-head">
        <p className="kicker">{[KIND_NAME[r.kind as keyof typeof KIND_NAME] ?? "Recording", fmtDate(r.date)].filter(Boolean).join(" · ")}</p>
        <h1>{r.title}</h1>
      </header>
      <button type="button" className="watch" onClick={() => openLink(youtube(video, t))} aria-label={`Watch from ${timestamp(t)}`}><Img src={thumbOf(video, true)} eager /><span><Icon name="play" size={18} /> Watch from {timestamp(t)}</span></button>
      {r.url ? <Link to={`/note${r.url}?t=${Math.round(t)}`} className="spoken__notes"><Icon name="note" size={18} /><span><b>Read the class notes</b><small>The write-up of this class, with the Scripture it opens</small></span><Icon name="chevron" size={16} /></Link> : null}
      <TranscriptExcerpt video={video} t={t} chunks={r.chunks} />
    </main>
  );
}

/** The captions around a moment, the found chunk marked, each a tap into the recording. */
export function TranscriptExcerpt({ video, t, chunks }: { video: string; t: number; chunks: { t: number; text: string }[] }) {
  const here = chunks.reduce((best, c, i) => (Math.abs(c.t - t) < Math.abs(chunks[best].t - t) ? i : best), 0);
  return (
    <section className="section">
      <div className="section__head"><h2>Spoken at {timestamp(t)}</h2></div>
      <div className="tx">
        {chunks.map((c, i) => (
          <p key={c.t} className="tx__chunk" data-here={i === here ? "" : undefined}>
            <button type="button" onClick={() => openLink(youtube(video, c.t))}>{timestamp(c.t)}</button>{c.text}
          </p>
        ))}
        {!chunks.length ? <p className="hint">No captions around this moment.</p> : null}
      </div>
    </section>
  );
}
