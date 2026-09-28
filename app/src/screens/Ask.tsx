import { marked } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { app, haptic, hideKeyboard } from "@/tg/sdk";
import { Icon, timestamp } from "@/ui/ui";
import { KIND_LABEL, hitPath, teachingPath } from "@/ui/search-hero";
import { KIND_NAME } from "./Home";

export type Passage = { kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string; text: string };
export type Source = Passage & { n: number };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; passages?: Source[]; error?: string; thinking?: boolean };
/** The welcome screen's starters: a question and the line under it. */
const EXAMPLES: [string, string][] = [
  ["Why do we keep the Passover?", "The feast, from the law to Christ"],
  ["Who are the twelve tribes today?", "Where the scattered nation is now"],
  ["What does the law say about usury?", "Lending among the brethren"],
  ["How is the Sabbath kept?", "The day, the rest and the assembly"],
];
const STORE = "cj:ask";

/** Where a cited passage opens: the class at its moment, the note at its section, the verse. */
export const passagePath = (p: Passage) => p.video ? teachingPath({ video: p.video, start: p.t ?? 0, note: p.url }) : hitPath({ kind: p.kind, title: p.title, url: p.url, sub: p.sub ?? "", snippet: "" });
export const passageLabel = (p: Passage) => p.video ? `${KIND_NAME[p.sub as keyof typeof KIND_NAME] ?? "Recording"}${p.date ? ` · ${fmtDate(p.date)}` : ""} · ${timestamp(p.t ?? 0)}` : `${KIND_LABEL[p.kind] ?? p.kind}${p.sub ? ` · ${p.sub}` : ""}`;

/**
 * Ask CyberJudah, laid out like an AI chat app: a slim bar with a new-chat button, a welcome
 * with starters, your messages as bubbles and CyberJudah's answers as formatted prose with
 * numbered citations, a row of source cards, Copy and Retry, a Stop while it writes, and a
 * composer that grows as you type. Each answer is written from the closest passages of the
 * classes, the notes, the law and the Scripture, streamed in as the model writes it; every
 * citation is a tap into its source. The conversation outlives a trip to a source and back.
 */
export function Ask() {
  const [params, setParams] = useSearchParams();
  const first = params.get("q") ?? "";
  const [turns, setTurns] = useState<Turn[]>(() => { try { return (JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Turn[]).filter((t) => !t.thinking); } catch { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stick = useRef(true);
  useBackButton(false);
  useBottomButtons(null, null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(turns.filter((t) => !t.thinking))); } catch { /* private mode */ } }, [turns]);
  // Follow the answer as it streams, unless the reader scrolled up to read.
  useEffect(() => {
    const onScroll = () => { stick.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);
  // The composer grows with the question, up to a few lines.
  useLayoutEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = "auto"; b.style.height = `${Math.min(b.scrollHeight, 160)}px`; }, [input]);

  const send = async (text: string, retry = false) => {
    const q = text.trim();
    if (!q || busy) return;
    haptic("select"); hideKeyboard();
    const base = retry ? turns.slice(0, -2) : turns;
    const history = base.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, content: t.content }));
    setTurns([...base, { role: "user", content: q }, { role: "assistant", content: "", thinking: true }]);
    setInput(""); setBusy(true); stick.current = true;
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));
    const ctl = new AbortController(); abortRef.current = ctl;
    try {
      const res = await fetch("/api/ask", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", Authorization: `tma ${app?.initData ?? ""}` }, body: JSON.stringify({ q, history, stream: true }) });
      if (!res.ok || !res.body) { patch((t) => ({ ...t, thinking: false, error: res.status === 429 ? "limit" : "unavailable" })); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let msg: { passages?: Source[]; delta?: string; done?: boolean; sources?: Source[]; error?: string };
          try { msg = JSON.parse(l); } catch { continue; }
          if (msg.passages) patch((t) => ({ ...t, passages: msg.passages }));
          if (msg.delta) patch((t) => ({ ...t, thinking: false, content: t.content + msg.delta }));
          if (msg.done) patch((t) => ({ ...t, thinking: false, sources: msg.sources ?? [] }));
          if (msg.error) patch((t) => ({ ...t, thinking: false, error: msg.error }));
        }
      }
      patch((t) => (t.thinking ? { ...t, thinking: false, error: t.content ? undefined : "unavailable" } : t));
    } catch {
      patch((t) => (ctl.signal.aborted ? { ...t, thinking: false, error: t.content ? undefined : "stopped" } : { ...t, thinking: false, error: "unavailable" }));
    } finally { setBusy(false); abortRef.current = null; }
  };
  const stop = () => { haptic("select"); abortRef.current?.abort(); };
  const newChat = () => { haptic("select"); abortRef.current?.abort(); setTurns([]); setInput(""); boxRef.current?.focus(); };
  useEffect(() => { if (first) { setParams({}, { replace: true }); void send(first); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  return (
    <main className="chat2">
      <header className="chat2__bar">
        <span className="chat2__spacer" />
        <div className="chat2__heading"><b>Ask CyberJudah</b><small>Answers from the teachings</small></div>
        <button type="button" className="chat2__new" aria-label="New chat" disabled={!turns.length} onClick={newChat}><Icon name="compose" size={21} /></button>
      </header>

      {!turns.length ? (
        <section className="chat2__welcome">
          <img className="chat2__mark" src="/brand/cyber-lion.webp" alt="" width={72} height={72} />
          <h1>What would you like to learn?</h1>
          <p>Ask about anything that was taught. Every answer comes from the classes, the notes, the law and the Scripture, and shows where it came from.</p>
          <div className="chat2__starters">
            {EXAMPLES.map(([q, sub]) => <button key={q} type="button" className="starter" onClick={() => void send(q)}><b>{q}</b><small>{sub}</small></button>)}
          </div>
        </section>
      ) : (
        <div className="chat2__turns">
          {turns.map((t, i) => t.role === "user"
            ? <div key={i} className="msg msg--me"><div className="msg__bubble">{t.content}</div></div>
            : <AssistantTurn key={i} t={t} last={i === turns.length - 1} onRetry={() => void send(lastUser, true)} />)}
          <div ref={endRef} className="chat2__end" />
        </div>
      )}

      <form className="composer2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <div className="composer2__box">
          <textarea ref={boxRef} value={input} rows={1} placeholder={turns.length ? "Ask a follow-up" : "Ask CyberJudah"} aria-label="Your question" enterKeyHint="send" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
          {busy
            ? <button type="button" className="composer2__go composer2__go--stop" aria-label="Stop" onClick={stop}><span /></button>
            : <button type="submit" className="composer2__go" aria-label="Send" disabled={!input.trim()}><Icon name="arrowUp" size={20} /></button>}
        </div>
        <p className="composer2__note">Answers can be wrong. Check them against the sources.</p>
      </form>
    </main>
  );
}

function AssistantTurn({ t, last, onRetry }: { t: Turn; last: boolean; onRetry: () => void }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const sources = t.sources ?? [];
  const lookup = sources.length ? sources : (t.passages ?? []);
  const html = useMemo(() => answerHtml(t.content, lookup), [t.content, lookup]);
  const open = (s: Source) => { haptic("select"); navigate(passagePath(s)); };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-n]");
    const s = c && lookup.find((x) => x.n === Number(c.dataset.n));
    if (s) { e.preventDefault(); open(s); }
  };
  const copy = () => { void navigator.clipboard?.writeText(plain(t.content)).then(() => { haptic("success"); setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); };

  return (
    <div className="msg msg--ai">
      <div className="msg__who"><img className="msg__avatar" src="/brand/cyber-lion.webp" alt="" width={24} height={24} />CyberJudah</div>
      {t.thinking ? (
        <div className="msg__thinking"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span>{t.passages?.length ? `Reading ${t.passages.length} passages from the teachings…` : "Searching the teachings…"}</div>
      ) : t.error && !t.content ? (
        <div className="msg__error">
          <p>{t.error === "limit" ? "That is a hundred questions today. The count starts again tomorrow." : t.error === "too-short" ? "Ask a fuller question." : t.error === "stopped" ? "Stopped." : "CyberJudah did not answer just now."}</p>
          {last && t.error !== "limit" ? <button type="button" className="msg__action" onClick={onRetry}><Icon name="retry" size={16} />Try again</button> : null}
        </div>
      ) : (
        <>
          <div className="msg__text" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
          {sources.length ? (
            <div className="msg__sources">
              <p className="msg__label">Sources · {sources.length}</p>
              <div className="srcrail">
                {sources.map((s) => (
                  <button key={s.n} type="button" className="srccard" onClick={() => open(s)}>
                    <span className="srccard__top"><b className="cite">{s.n}</b><small>{passageLabel(s)}</small></span>
                    <span className="srccard__title">{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {sources.length || !last ? (
            <div className="msg__actions">
              <button type="button" className="msg__action" onClick={copy} aria-label="Copy the answer"><Icon name={copied ? "check" : "copy"} size={16} />{copied ? "Copied" : "Copy"}</button>
              {last ? <button type="button" className="msg__action" onClick={onRetry} aria-label="Ask again"><Icon name="retry" size={16} />Retry</button> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The answer as text for the clipboard: the citation markers dropped. */
const plain = (text: string) => text.replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").replace(/ +([.,;:!?])/g, "$1").trim();

/**
 * The answer as formatted prose: the model's markdown (bold, lists, headings) rendered with
 * any HTML it wrote shown as text, and each [n] marker a numbered chip that opens source n.
 * A marker still arriving mid-stream ("[1") is held back until it is whole.
 */
export function answerHtml(text: string, sources: Source[]): string {
  const known = new Set(sources.map((s) => s.n));
  const marked_ = escapeHtml(text.replace(/\s*\[\d{0,2}$/, ""))
    .replace(/\s*\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (_m, list: string) => list.split(/\s*,\s*/).map((n) => (known.has(Number(n)) ? ` CJCITE${n}CJ` : "")).join(""));
  const html = marked.parse(marked_, { gfm: true, breaks: false, async: false }) as string;
  return html.replace(/ ?CJCITE(\d{1,2})CJ/g, (_m, n: string) => `<button type="button" class="cite" data-n="${n}" aria-label="Source ${n}">${n}</button>`);
}
