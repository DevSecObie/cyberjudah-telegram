import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import { haptic, openLink } from "@/tg/sdk";
import { ScriptureCard, type VerseRef } from "@/ui/scripture";

/**
 * An event of The Final Captivity, in the Timeline's event sheet (app/scripts/final-captivity).
 * The summary comes first, so the sheet's first detent shows it; then the documented history,
 * quotes from the classes (each linked to the moment it was taught), the Scriptures read
 * with it, where the sources differ, and the sources. The three kinds of statement are
 * labelled and never run together: what is documented, what the assembly teaches, and how the
 * Scripture is applied.
 */
type Source = { title: string; author?: string; publisher?: string; year?: string; url: string; via?: string; accessed?: string; supports?: string };
type Teaching = { points?: string[]; quote?: string; teacher?: string; source: { kind: "class" | "history" | "site" | "note"; id?: string; title: string; date?: string; ts?: string; url: string } };
export type FcDetail = {
  title: string; start: number; end: number; period: string;
  date: { text: string; precision: string }; group: string; place?: string; region?: string; peoples?: string[]; people?: string[];
  summary: string; account?: string[]; teaching?: Teaching[]; scriptures?: { ref: string; why?: string }[]; sources?: Source[];
  uncertainty?: string; disagreements?: { point: string; views: string[] }[];
  image?: { src: string; kind: "archival" | "generated"; caption: string; credit?: string; license?: string; sourceUrl?: string };
};

/** Every event's content, one file, loaded the first time an event of this age is opened. */
export const useFinalCaptivity = () => useQuery({
  queryKey: ["final-captivity"],
  queryFn: async () => (await import("@/data/final-captivity.json")).default as unknown as Record<string, FcDetail>,
  staleTime: Infinity,
});

const PRECISION: Record<string, string> = { circa: "Approximate date", decade: "Dated to the decade", range: "Over a span of years", year: "Dated to the year", month: "Dated to the month", day: "" };
const KIND: Record<string, string> = { class: "Class", history: "Our Hidden History", site: "israelunite.org", note: "Class note" };
const REF = /^(.+?) (\d+)(?::(\d+)(?:-(\d+))?)?$/;
/** "2026-08-27" as the reader's date; anything else as written. */
const day = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : d);
const external = (url: string) => (ev: React.MouseEvent) => { ev.preventDefault(); haptic("select"); openLink(url); };

export function FinalCaptivityDetail({ slug, reviewedThrough }: { slug: string; reviewedThrough?: string }) {
  const all = useFinalCaptivity();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const e = all.data?.[slug];
  const refs = useMemo(() => (e?.scriptures ?? []).map((s) => {
    const m = REF.exec(s.ref);
    const slugOf = (name: string) => books.data?.find((b) => b.book.toLowerCase() === name.toLowerCase())?.slug ?? name.toLowerCase().replace(/\s+/g, "-");
    const at: VerseRef | null = m ? { slug: slugOf(m[1]), chapter: +m[2], from: m[3] ? +m[3] : 1, to: m[4] ? +m[4] : m[3] ? +m[3] : 1 } : null;
    return { ...s, at };
  }), [e, books.data]);

  if (all.isPending) return <p className="hint" aria-busy="true">Loading…</p>;
  if (!e) return <p className="hint" role="status">This event could not be loaded. <button type="button" className="msg__link" onClick={() => void all.refetch()}>Try again</button></p>;
  const note = PRECISION[e.date.precision];

  return (
    <>
      <p className="fc-meta">
        <span className="fc-chip">{e.group}</span>
        {e.place ? <span className="fc-meta__place"><Feather name="map-pin" size={13} color="currentColor" />{e.place}</span> : null}
      </p>
      <p className="fc-precision">{e.date.text}{note ? ` · ${note}` : ""}</p>

      <section className="tl-event__section" aria-label="Summary">
        <p className="tl-event__lead">{e.summary}</p>
      </section>

      {e.image ? (
        <figure className="fc-figure">
          <img src={e.image.src} alt={e.image.caption} loading="lazy" decoding="async" />
          <figcaption><span className={`fc-badge fc-badge--${e.image.kind}`}>{e.image.kind === "archival" ? "Archival" : "Generated reconstruction"}</span> {e.image.caption}{e.image.credit ? ` ${e.image.credit}.` : ""}{e.image.license ? ` ${e.image.license}.` : ""}</figcaption>
        </figure>
      ) : null}

      {e.account?.length ? (
        <section className="tl-event__section fc-section" aria-labelledby={`${slug}-h`}>
          <h3 id={`${slug}-h`}><span className="fc-kind">Documented history</span>What happened</h3>
          {e.people?.length ? <p className="fc-people">{e.people.join(" · ")}</p> : null}
          {e.account.map((p, i) => <p key={i} className="fc-para">{p}</p>)}
        </section>
      ) : null}

      {e.teaching?.length ? (
        <section className="tl-event__section fc-section" aria-labelledby={`${slug}-t`}>
          <h3 id={`${slug}-t`}><span className="fc-kind fc-kind--teaching">Quotes and sources</span>From the classes</h3>
          {e.teaching.map((t, i) => (
            <article key={i} className="fc-teach">
              {t.quote ? <blockquote className="fc-quote">“{t.quote}”</blockquote> : null}
              <a className="fc-cite" href={t.source.url} onClick={external(t.source.url)}>
                <Feather name={t.source.kind === "site" ? "globe" : "play-circle"} size={18} color="currentColor" />
                <span><b>{t.source.title}</b><small>{[KIND[t.source.kind], t.teacher, day(t.source.date), t.source.ts ? `at ${t.source.ts}` : ""].filter(Boolean).join(" · ")}</small></span>
                <Feather name="external-link" size={16} color="currentColor" />
              </a>
            </article>
          ))}
        </section>
      ) : null}

      {refs.length ? (
        <section className="tl-event__section fc-section" aria-labelledby={`${slug}-s`}>
          <h3 id={`${slug}-s`}><span className="fc-kind fc-kind--scripture">Scriptural application</span>Scriptures</h3>
          {refs.map((r) => r.at
            ? <ScriptureCard key={r.ref} at={r.at} label={r.ref}>{r.why ? <p className="fc-why">{r.why}</p> : null}</ScriptureCard>
            : <p key={r.ref} className="fc-para"><b>{r.ref}</b>{r.why ? `: ${r.why}` : ""}</p>)}
        </section>
      ) : null}

      {e.disagreements?.length || e.uncertainty ? (
        <section className="tl-event__section fc-section" aria-labelledby={`${slug}-d`}>
          <h3 id={`${slug}-d`}>Where the sources differ</h3>
          {e.disagreements?.map((d, i) => (
            <div key={i} className="fc-differ">
              <p className="fc-differ__point">{d.point}</p>
              <ul>{d.views.map((v, j) => <li key={j}>{v}</li>)}</ul>
            </div>
          ))}
          {e.uncertainty ? <p className="fc-para fc-uncertain"><b>Not settled: </b>{e.uncertainty}</p> : null}
        </section>
      ) : null}

      {e.sources?.length ? (
        <section className="tl-event__section fc-section" aria-labelledby={`${slug}-r`}>
          <h3 id={`${slug}-r`}>Sources</h3>
          <ol className="fc-sources">
            {e.sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} onClick={external(s.url)}>{s.title}</a>
                <small>{[s.author, s.publisher, s.year].filter(Boolean).join(", ")}{s.via ? <> · <a href={s.via} onClick={external(s.via)}>archived copy</a></> : null}</small>
              </li>
            ))}
          </ol>
          {reviewedThrough ? <p className="fc-reviewed">Sources reviewed through {new Date(`${reviewedThrough}T12:00:00Z`).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}.</p> : null}
        </section>
      ) : null}
    </>
  );
}
