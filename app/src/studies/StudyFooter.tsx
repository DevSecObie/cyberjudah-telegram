import { useState, type ReactNode } from "react";

import { Feather, type FeatherName } from "@/bible/icons";

/** The writing the footer acts on: the last focused writing block. */
export type WritingTarget = { el: HTMLTextAreaElement; onChange: (text: string) => void };
type Menu = "heading" | "more" | "block" | null;
const HEADINGS = [["Normal", 0], ["Title", 1], ["Subtitle", 2]] as const;

/** The level of the line the caret is on: 0 normal, 1 "# ", 2 "## ". */
export const headingAt = (value: string, caret: number) => { const line = value.slice(value.lastIndexOf("\n", caret - 1) + 1); return line.startsWith("## ") ? 2 : line.startsWith("# ") ? 1 : 0; };

/**
 * Bible Strong's StudyFooter, the editing bar under a study: the heading (Normal, Title,
 * Subtitle), bold, italic, more (quote, lists, a divider, undo and redo) and adding a block.
 * Our studies are written in Markdown, so it writes Markdown; Bible Strong's underline and
 * colours have no Markdown and are not here.
 */
export function StudyFooter({ target, header, onAdd }: { target: WritingTarget | null; header: number; onAdd: (kind: "writing" | "scripture" | "strong") => void }) {
  const [menu, setMenu] = useState<Menu>(null);
  const toggle = (m: Exclude<Menu, null>) => setMenu((now) => (now === m ? null : m));
  const close = () => setMenu(null);
  const edit = (fn: (value: string, start: number, end: number) => [string, number, number]) => {
    if (!target) return;
    const { el, onChange } = target;
    const [next, start, end] = fn(el.value, el.selectionStart, el.selectionEnd);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start, end); });
  };
  const wrap = (mark: string) => edit((v, s, e) => [v.slice(0, s) + mark + v.slice(s, e) + mark + v.slice(e), s + mark.length, e + mark.length]);
  // A line's prefix (a heading, a quote, a list) replaces the one it has, or comes off if it is the same.
  const prefix = (p: string, toggle = true, kinds = /^(#{1,6} |> |- |\d+\. )/) => edit((v, s, e) => {
    const from = v.lastIndexOf("\n", s - 1) + 1;
    const line = v.slice(from);
    const had = kinds.exec(line)?.[0] ?? "";
    const put = toggle && had === p ? "" : p;
    const shift = put.length - had.length;
    return [v.slice(0, from) + put + v.slice(from + had.length), Math.max(from, s + shift), Math.max(from, e + shift)];
  });
  const divider = () => edit((v, s) => { const add = `${s && v[s - 1] !== "\n" ? "\n" : ""}\n---\n\n`; return [v.slice(0, s) + add + v.slice(s), s + add.length, s + add.length]; });
  const history = (command: "undo" | "redo") => { target?.el.focus(); document.execCommand(command); };
  // Buttons keep the writing's selection: they act on press without taking the focus.
  const hold = { onPointerDown: (e: React.PointerEvent) => e.preventDefault(), onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  return (
    <div className="study-footer" role="toolbar" aria-label="Formatting">
      {menu ? <div className="study-footer__catch" onClick={close} /> : null}
      <div className="study-footer__row">
        <div className="study-footer__anchor">
          <button type="button" className="study-footer__heading" aria-haspopup="menu" aria-expanded={menu === "heading"} {...hold} onClick={() => toggle("heading")}>
            <b>{HEADINGS[header][0]}</b><span><Feather name="chevron-up" size={18} color="var(--canvas)" /></span>
          </button>
          {menu === "heading" ? <Popover left={0} width={220}>{HEADINGS.map(([label, level]) => <Item key={label} icon="type" label={label} on={header === level} onClick={() => { prefix(level === 0 ? "" : level === 1 ? "# " : "## ", false, /^#{1,6} /); close(); }} />)}</Popover> : null}
        </div>
        <Format label="Bold" onClick={() => wrap("**")}><Feather name="bold" size={16} color="var(--accent)" /></Format>
        <Format label="Italic" onClick={() => wrap("*")}><Feather name="italic" size={16} color="var(--accent)" /></Format>
        <div className="study-footer__anchor">
          <button type="button" className="study-footer__more" aria-label="More" aria-haspopup="menu" aria-expanded={menu === "more"} {...hold} onClick={() => toggle("more")}><Feather name="more-horizontal" size={18} color="var(--accent)" /></button>
          {menu === "more" ? <Popover left={-112} width={250}>
            <div className="study-footer__grid">
              <div><Format label="Quote" onClick={() => { prefix("> "); close(); }}><span className="study-footer__quote">”</span></Format></div>
              <hr />
              <div>
                <Format label="Bulleted list" onClick={() => { prefix("- "); close(); }}><Feather name="list" size={20} color="var(--accent)" /></Format>
                <Format label="Numbered list" onClick={() => { prefix("1. "); close(); }}><Feather name="list-ordered" size={20} color="var(--accent)" /></Format>
                <Format label="Divider" onClick={() => { divider(); close(); }}><Feather name="minus" size={20} color="var(--accent)" /></Format>
              </div>
              <hr />
              <div>
                <button type="button" className="study-footer__history" aria-label="Undo" {...hold} onClick={() => history("undo")}><Feather name="rotate-ccw" size={20} color="var(--accent)" /></button>
                <button type="button" className="study-footer__history" aria-label="Redo" {...hold} onClick={() => history("redo")}><Feather name="rotate-cw" size={20} color="var(--accent)" /></button>
              </div>
            </div>
          </Popover> : null}
        </div>
        <span className="study-footer__spacer" />
        <div className="study-footer__anchor">
          <button type="button" className="study-footer__add" aria-label="Add" aria-haspopup="menu" aria-expanded={menu === "block"} {...hold} onClick={() => toggle("block")}><Feather name="plus-square" size={22} color="var(--accent)" /></button>
          {menu === "block" ? <Popover right={0} width={250} bottom={30}>
            <Item icon="file-text" label="Add writing" onClick={() => { close(); onAdd("writing"); }} />
            <Item icon="book-open" label="Add Scripture" onClick={() => { close(); onAdd("scripture"); }} />
            <Item icon="type" label="Add a Strong's entry" onClick={() => { close(); onAdd("strong"); }} />
          </Popover> : null}
        </div>
      </div>
    </div>
  );
}

function Format({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="study-footer__format" aria-label={label} title={label} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}
function Popover({ children, left, right, width, bottom = 40 }: { children: ReactNode; left?: number; right?: number; width: number; bottom?: number }) {
  return <div className="study-footer__popover" role="menu" style={{ left, right, width, bottom }}>{children}</div>;
}
function Item({ icon, label, on, onClick }: { icon: FeatherName; label: string; on?: boolean; onClick: () => void }) {
  const color = on === undefined ? "var(--text-1)" : on ? "var(--accent)" : "var(--text-3)";
  return <button type="button" role="menuitem" className="study-footer__item" style={{ color }} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={onClick}><span><Feather name={icon} size={16} color={color} /></span>{label}</button>;
}
