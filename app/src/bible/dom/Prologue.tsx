import { useState } from "react";

import { Feather } from "../icons";
import { webFontFamily, type BibleSettings } from "../settings";
import type { Palette } from "../theme";
import { getBibleTextFontSize, scaleFontSize, scaleLineHeight } from "../typography";

export type PrologueItem = { title: string; text: string };

/**
 * A book's prologue as the 1611 prints it before chapter 1 (Ecclesiasticus has two): not verses,
 * so it has no numbers and is not selectable. Closed, it shows its titles; opened, the full text.
 */
export function Prologue({ items, settings: s, palette: c }: { items: PrologueItem[]; settings: BibleSettings; palette: Palette }) {
  const [open, setOpen] = useState(false);
  const font = webFontFamily(s.fontFamily);
  return (
    <section className="bs-prologue" aria-label="Prologue" style={{ borderColor: c.border }}>
      <button type="button" className="bs-prologue__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{ color: c.default }}>
        <span className="bs-prologue__eyebrow" style={{ color: c.grey, fontSize: scaleFontSize(11, s.fontSizeScale) }}>{items.length === 1 ? "Prologue" : `${items.length} prologues`}</span>
        <span className="bs-prologue__titles" style={{ fontFamily: font, fontSize: scaleFontSize(16, s.fontSizeScale) }}>{items.map((p) => p.title).join(" · ")}</span>
        <span className="bs-prologue__chev" aria-hidden="true" style={{ color: c.grey }}><Feather name={open ? "chevron-up" : "chevron-down"} size={18} color="currentColor" /></span>
      </button>
      {open ? items.map((p) => (
        <div key={p.title} className="bs-prologue__part">
          <h3 style={{ fontFamily: font, fontSize: scaleFontSize(17, s.fontSizeScale), color: c.default }}>{p.title}</h3>
          <p style={{ fontFamily: font, fontSize: getBibleTextFontSize(false, s.fontSizeScale), lineHeight: scaleLineHeight(32, s.lineHeight, s.fontSizeScale), color: c.default }}>{p.text}</p>
        </div>
      )) : null}
    </section>
  );
}
