import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useBibleSettings, webFontFamily } from "@/bible/settings";
import { share } from "@/lib/share";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";
import { Icon } from "@/ui/ui";

export type DailyVerse = { ref: string; slug: string; chapter: number; verse: number; text: string };

/** Our daily verse, with its existing Worker-rendered image and Telegram sharing action. */
export function TodayCard({ verse: today, failed: todayFailed }: { verse?: DailyVerse; failed?: boolean }) {
  const [offset, setOffset] = useState(0);
  const [settings] = useBibleSettings();
  const dates = Array.from({ length: 5 }, (_, i) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - 4 + i); return date.toISOString().slice(0, 10); });
  const date = dates[offset + 4];
  const previous = useQuery({ queryKey: ["votd", date], enabled: offset !== 0, staleTime: Infinity, queryFn: async () => {
    const response = await fetch(`/api/verse-of-day?date=${date}`);
    if (!response.ok) throw new Error("Daily verse unavailable");
    return response.json() as Promise<DailyVerse>;
  } });
  const verse = offset === 0 ? today : previous.data;
  const failed = offset === 0 ? todayFailed : previous.isError;
  const label = offset === 0 ? "Today" : offset === -1 ? "Yesterday" : new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: "long", timeZone: "UTC" });
  const [image, setImage] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (image) return sheetOpened(); }, [image]);
  useModal(box, image && !!verse, () => setImage(false));
  const path = verse ? `/read/${verse.slug}/${verse.chapter}?v=${verse.verse}` : "/bible";
  const src = verse ? `/card/${encodeURIComponent(verse.slug)}/${verse.chapter}/${verse.verse}.svg` : "";
  return <>
    <section className="today-card" aria-label="Daily scripture">
      <header><b>{label}</b><span className="today-card__arrows"><button type="button" aria-label="Previous day's scripture" disabled={offset === -4} onClick={() => setOffset(n => n - 1)}>‹</button><button type="button" aria-label="Next day's scripture" disabled={offset === 0} onClick={() => setOffset(n => n + 1)}>›</button></span><Link to="/settings" aria-label="Daily verse settings"><Icon name="gear" size={18} /></Link></header>
      <Link to={path} className="today-card__verse" style={{ fontFamily: webFontFamily(settings.fontFamily) }}>{verse ? <><p style={{ fontFamily: "inherit", fontSize: `${19 * (1 + settings.fontSizeScale * .1)}px` }}>{verse.text}</p><b>{verse.ref} <small>KJV</small></b></> : <p role="status">{failed ? "The day's verse is unavailable. Open the Bible." : "Loading the day's verse…"}</p>}</Link>
      <div className="today-card__days" role="group" aria-label="Daily scripture days">
        {dates.map((d, i) => <button key={d} type="button" aria-label={i === 4 ? "Today's scripture" : `Scripture for ${d}`} aria-pressed={offset === i - 4} onClick={() => setOffset(i - 4)}><span aria-hidden="true">{i === 4 ? "•" : new Date(`${d}T12:00:00Z`).toLocaleDateString([], { weekday: "narrow", timeZone: "UTC" })}</span></button>)}
      </div>
      <footer>
        <button type="button" disabled={!verse} onClick={() => { if (verse) void share({ kind: "verse", title: verse.ref, text: verse.text, sitePath: `/bible/${verse.slug}/${verse.chapter}`, verses: String(verse.verse) }); }}><Icon name="share" size={17} />Share</button>
        <button type="button" disabled={!verse} onClick={() => setImage(true)}><Icon name="image" size={17} />Image</button>
      </footer>
    </section>
    {image && verse ? createPortal(<div className="sheet__scrim" onClick={(e) => { if (e.target === e.currentTarget) setImage(false); }}>
      <div ref={box} className="sheet today-image" role="dialog" aria-modal="true" aria-label="Verse image" data-sheet-open="">
        <p className="sheet__title">{verse.ref}</p>
        <img src={src} alt={`${verse.ref}: ${verse.text}`} />
        <a className="btn" href={src} download={`${verse.slug}-${verse.chapter}-${verse.verse}.svg`}>Save image</a>
        <button type="button" className="sheet__cancel" data-autofocus onClick={() => setImage(false)}>Close</button>
      </div>
    </div>, document.getElementById("root")!) : null}
  </>;
}
