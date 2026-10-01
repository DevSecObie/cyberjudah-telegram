import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { share } from "@/lib/share";
import { sheetOpened } from "@/tg/hooks";
import { useModal } from "@/ui/modal";
import { Icon } from "@/ui/ui";

export type DailyVerse = { ref: string; slug: string; chapter: number; verse: number; text: string };

/** Our daily verse, with its existing Worker-rendered image and Telegram sharing action. */
export function TodayCard({ verse, failed }: { verse?: DailyVerse; failed?: boolean }) {
  const [image, setImage] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (image) return sheetOpened(); }, [image]);
  useModal(box, image && !!verse, () => setImage(false));
  const path = verse ? `/read/${verse.slug}/${verse.chapter}?v=${verse.verse}` : "/bible";
  const src = verse ? `/card/${encodeURIComponent(verse.slug)}/${verse.chapter}/${verse.verse}.svg` : "";
  return <>
    <section className="today-card" aria-label="Today">
      <header><b>Today</b><Link to="/settings" aria-label="Daily verse settings"><Icon name="gear" size={18} /></Link></header>
      <Link to={path} className="today-card__verse">{verse ? <><p>{verse.text}</p><b>{verse.ref} <small>KJV</small></b></> : <p>{failed ? "The day's verse is unavailable. Open the Bible." : "Loading the day's verse…"}</p>}</Link>
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
