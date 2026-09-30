import { useNavigate } from "react-router";

import { fmtDate, type ClassMoment } from "@/api/data";
import { thumbUrl } from "@/lib/taught";
import { haptic } from "@/tg/sdk";
import { toAppPath } from "@shared/links.mjs";
import { Sheet } from "./Sheet";

/**
 * The classes that taught a verse (Bible Strong's passage-media gallery): each recording's
 * picture with the moment on it, the class, its teacher and date. A class opens its note at
 * that moment; one without a note opens the recording there.
 */
export function ClassMomentsSheet({ open, onClose, moments, reference, from }: {
  open: boolean; onClose: () => void; moments: ClassMoment[]; reference: string; from: string;
}) {
  const navigate = useNavigate();
  const go = (m: ClassMoment) => {
    haptic("select");
    onClose();
    const back = `from=${encodeURIComponent(from)}`;
    navigate(m.url ? `${toAppPath(m.url)}?t=${m.t}&${back}` : `/watch/${encodeURIComponent(m.video)}?t=${m.t}&${back}`);
  };
  return (
    <Sheet open={open} onClose={onClose} height="half" title={moments.length === 1 ? "Taught in class" : `Taught in ${moments.length} classes`} subTitle={reference}>
      <div className="bs-moments">
        {moments.map((m) => (
          <button key={`${m.video}-${m.t}`} type="button" className="bs-moment" onClick={() => go(m)}>
            <span className="bs-moment__pic">
              <img src={thumbUrl(m.video)} alt="" loading="lazy" decoding="async" />
              {m.ts ? <span className="bs-moment__ts">{m.ts}</span> : null}
            </span>
            <span className="bs-moment__text">
              <b>{m.label}</b>
              <small>{[m.teacher, m.date ? fmtDate(m.date) : ""].filter(Boolean).join(" · ")}</small>
              <small className="bs-moment__at">Verse {m.verses}</small>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
