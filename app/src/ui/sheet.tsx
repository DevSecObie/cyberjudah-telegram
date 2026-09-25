import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { haptic, hideKeyboard } from "@/tg/sdk";

/**
 * A bottom sheet, the app's own: Telegram's showPopup takes three buttons at most, and a
 * verse has more to offer (highlight colours, a note, copy, share). Opened from anywhere
 * with `useSheet().open(...)`; Telegram's back button closes it first (see useBackButton).
 */
export type SheetItem = { id: string; text: string; icon?: ReactNode; destructive?: boolean; hint?: string };
export type SheetSpec = {
  title?: string;
  items?: SheetItem[];
  /** Highlight colours: the ids are the colour keys. */
  colors?: { id: string; label: string; css: string; on?: boolean }[];
  /** A text field: resolves with `{ id: "text", value }`. */
  text?: { label: string; value?: string; placeholder?: string; submit: string };
};
export type SheetAnswer = { id: string; value?: string } | null;

type Ctx = { open(spec: SheetSpec): Promise<SheetAnswer>; close(): void; isOpen: boolean };
const SheetContext = createContext<Ctx>({ open: async () => null, close: () => {}, isOpen: false });
export const useSheet = () => useContext(SheetContext);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [spec, setSpec] = useState<SheetSpec | null>(null);
  const resolver = useRef<((a: SheetAnswer) => void) | null>(null);
  const [text, setText] = useState("");
  const answer = useCallback((a: SheetAnswer) => { resolver.current?.(a); resolver.current = null; setSpec(null); }, []);
  const open = useCallback((s: SheetSpec) => new Promise<SheetAnswer>((resolve) => { resolver.current?.(null); resolver.current = resolve; setText(s.text?.value ?? ""); setSpec(s); haptic("select"); }), []);
  const ctx = useMemo(() => ({ open, close: () => answer(null), isOpen: spec !== null }), [open, answer, spec]);
  useEffect(() => { if (!spec) return; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") answer(null); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [spec, answer]);
  return (
    <SheetContext.Provider value={ctx}>
      {children}
      {spec ? (
        <div className="sheet__scrim" onClick={(e) => { if (e.target === e.currentTarget) answer(null); }}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={spec.title ?? "Options"} data-sheet-open="">
            <div className="sheet__grip" aria-hidden="true" />
            {spec.title ? <p className="sheet__title">{spec.title}</p> : null}
            {spec.colors ? (
              <div className="sheet__colors" role="group" aria-label="Highlight colour">
                {spec.colors.map((c) => <button key={c.id} type="button" className="swatch" aria-pressed={c.on} aria-label={c.label} style={{ background: c.css }} onClick={() => answer({ id: c.id })} />)}
              </div>
            ) : null}
            {spec.text ? (
              <form className="sheet__form" onSubmit={(e) => { e.preventDefault(); hideKeyboard(); answer({ id: "text", value: text.trim() }); }}>
                <label htmlFor="sheet-text">{spec.text.label}</label>
                <textarea id="sheet-text" rows={4} value={text} placeholder={spec.text.placeholder} onChange={(e) => setText(e.target.value)} autoFocus maxLength={1500} />
                <div className="btn--row"><button type="button" className="btn btn--quiet" onClick={() => answer(null)}>Cancel</button><button type="submit" className="btn">{spec.text.submit}</button></div>
              </form>
            ) : null}
            {spec.items?.length ? (
              <div className="sheet__items">
                {spec.items.map((it) => <button key={it.id} type="button" className="sheet__item" data-destructive={it.destructive ? "" : undefined} onClick={() => answer({ id: it.id })}>{it.icon ? <span className="sheet__icon">{it.icon}</span> : null}<span><b>{it.text}</b>{it.hint ? <small>{it.hint}</small> : null}</span></button>)}
              </div>
            ) : null}
            {!spec.text ? <button type="button" className="sheet__cancel" onClick={() => answer(null)}>Cancel</button> : null}
          </div>
        </div>
      ) : null}
    </SheetContext.Provider>
  );
}
