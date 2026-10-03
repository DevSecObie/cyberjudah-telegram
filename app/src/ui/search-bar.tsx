import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";

import { Icon } from "@/ui/ui";

/**
 * The main search's field (Search.tsx), for every search in the app to share: the magnifier (a
 * spinner while results come in), the clear button, the / key hint, and Cancel while it is in
 * use. The keyboard works it end to end: / or Ctrl+K to the field from anywhere on the screen,
 * the down arrow into the results (any element marked `data-result` inside `results`), the
 * arrows through them, Escape back to the field, and Escape again to clear it.
 */
export function SearchBar({ id, value, onChange, onSubmit, onCancel, placeholder, busy, autoFocus, results, controls, children }: {
  id: string; value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel: () => void;
  placeholder: string; busy?: boolean; autoFocus?: boolean; results: RefObject<HTMLElement | null>; controls?: string; children?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); field.current?.focus(); field.current?.select(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The results answer the arrows and Escape too.
  useEffect(() => {
    const box = results.current;
    if (!box) return;
    const onKey = (e: KeyboardEvent) => {
      const list = [...box.querySelectorAll<HTMLElement>("[data-result]")]; const i = list.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); list[Math.min(i + 1, list.length - 1)]?.focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); if (i === 0) field.current?.focus(); else list[i - 1]?.focus(); }
      if (e.key === "Escape") { e.preventDefault(); field.current?.focus(); }
    };
    box.addEventListener("keydown", onKey);
    return () => box.removeEventListener("keydown", onKey);
  }, [results]);
  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { const first = results.current?.querySelector<HTMLElement>("[data-result]"); if (first) { e.preventDefault(); first.focus(); } }
    if (e.key === "Escape") { e.preventDefault(); if (value) onChange(""); else field.current?.blur(); }
  };
  return (
    <div className="srch__bar">
      <form className="srch__form" role="search" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <label className="srch__field" data-focus={focused ? "" : undefined}>
          <span className="srch__icon" aria-hidden="true">{busy ? <span className="srch__spin" /> : <Icon name="search" size={19} />}</span>
          <input ref={field} id={id} type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} autoFocus={autoFocus}
            placeholder={placeholder} aria-label={placeholder} aria-controls={controls}
            value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onFieldKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
          {value ? <button type="button" className="srch__clear" aria-label="Clear the search" onClick={() => { onChange(""); field.current?.focus(); }}><Icon name="close" size={14} /></button> : <kbd className="srch__kbd" aria-hidden="true">/</kbd>}
        </label>
        {focused || value ? <button type="button" className="srch__cancel" onMouseDown={(e) => e.preventDefault()} onClick={() => { field.current?.blur(); onCancel(); }}>Cancel</button> : null}
      </form>
      {children}
    </div>
  );
}

/** A value that settles after the typing pauses. */
export function useSettled<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = window.setTimeout(() => setV(value), ms); return () => window.clearTimeout(t); }, [value, ms]);
  return v;
}
