import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Icon } from "./ui";

/**
 * Short notifications. A message slides in above the dock and leaves on its own after `ms`, with a
 * line along its foot that runs out with the time; the time stops while the message is hovered or
 * holds the keyboard focus. An error stays until it is dismissed. Messages are announced: politely,
 * or at once for an error.
 */
type Tone = "info" | "success" | "error";
type Toast = { id: number; text: string; tone: Tone; ms: number };
type Ctx = { show(text: string, opts?: { tone?: Tone; ms?: number }): void };
const ToastContext = createContext<Ctx>({ show: () => {} });
export const useToast = () => useContext(ToastContext).show;

const MAX = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const next = useRef(1);
  const dismiss = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const show = useCallback((text: string, opts?: { tone?: Tone; ms?: number }) => {
    const tone = opts?.tone ?? "info";
    // An error waits for the reader; anything else times out.
    const ms = tone === "error" ? 0 : opts?.ms ?? 3500;
    setList((l) => [...l.filter((t) => t.text !== text), { id: next.current++, text, tone, ms }].slice(-MAX));
  }, []);
  useEffect(() => {
    const syncError = (event: Event) => show((event as CustomEvent<string>).detail, { tone: "error" });
    window.addEventListener("cj:sync-error", syncError);
    return () => window.removeEventListener("cj:sync-error", syncError);
  }, [show]);
  const ctx = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="toasts" aria-live="polite" aria-relevant="additions">
        {list.map((t) => <ToastView key={t.id} toast={t} onDone={() => dismiss(t.id)} />)}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(toast.ms);
  const started = useRef(Date.now());
  useEffect(() => {
    if (!toast.ms || paused) return;
    started.current = Date.now();
    const timer = window.setTimeout(onDone, left.current);
    return () => { window.clearTimeout(timer); left.current -= Date.now() - started.current; };
  }, [paused, toast.ms, onDone]);
  const hold = () => setPaused(true), go = () => setPaused(false);
  const icon = toast.tone === "error" ? "alert" : toast.tone === "success" ? "check" : "info";
  return (
    <div className="toast" data-tone={toast.tone} role={toast.tone === "error" ? "alert" : "status"}
      onMouseEnter={hold} onMouseLeave={go} onFocus={hold} onBlur={go}>
      <span className="toast__icon" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <span className="toast__text">{toast.text}</span>
      <button type="button" className="toast__close" aria-label="Dismiss" title="Dismiss" onClick={onDone}><Icon name="close" size={16} /></button>
      {toast.ms ? <span className="toast__timer" aria-hidden="true" style={{ ["--toast-ms" as string]: `${toast.ms}ms`, animationPlayState: paused ? "paused" : "running" }} /> : null}
    </div>
  );
}
