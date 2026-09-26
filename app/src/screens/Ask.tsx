import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { app, haptic, hideKeyboard } from "@/tg/sdk";
import { Chip, Chips, Icon, timestamp } from "@/ui/ui";
import { KIND_LABEL, hitPath, teachingPath } from "@/ui/search-hero";
import { KIND_NAME } from "./Home";

export type Passage = { kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string; text: string };
export type Source = Passage & { n: number };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; passages?: Source[]; error?: string; thinking?: boolean };
const EXAMPLES = ["Why do we keep the Passover?", "What does the law say about usury?", "Who are the twelve tribes today?", "What was taught about honouring parents?", "How is the Sabbath kept?"];

/** Where a cited passage opens: the class at its moment, the note at its section, the verse. */
export const passagePath = (p: Passage) => p.video ? teachingPath({ video: p.video, start: p.t ?? 0, note: p.url }) : hitPath({ kind: p.kind, title: p.title, url: p.url, sub: p.sub ?? "", snippet: "" });
export const passageLabel = (p: Passage) => p.video ? `${KIND_NAME[p.sub as keyof typeof KIND_NAME] ?? "Recording"}${p.date ? ` · ${fmtDate(p.date)}` : ""} · ${timestamp(p.t ?? 0)}` : `${KIND_LABEL[p.kind] ?? p.kind}${p.sub ? ` · ${p.sub}` : ""}`;

/**
 * Ask CyberJudah: a conversation with the library. Each answer is written from the closest
 * passages of the classes, the notes, the law and the Scripture, streamed in as the model
 * writes it, every claim cited, every citation a tap into its source; follow-ups continue
 * the thread.
 */
export function Ask() {
  const [params, setParams] = useSearchParams();
  const first = params.get("q") ?? "";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useBackButton(false);
  useBottomButtons(null, null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    haptic("select"); hideKeyboard();
    const history = turns.filter((t) => !t.error).slice(-6).map((t) => ({ role: t.role, content: t.content }));
    setTurns((ts) => [...ts, { role: "user", content: q }, { role: "assistant", content: "", thinking: true }]);
    setInput(""); setBusy(true);
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json", Authorization: `tma ${app?.initData ?? ""}` }, body: JSON.stringify({ q, history, stream: true }) });
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
      patch((t) => ({ ...t, thinking: false, error: "unavailable" }));
    } finally { setBusy(false); }
  };
  useEffect(() => { if (first) { setParams({}, { replace: true }); void send(first); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);

  return (
    <main className="screen chat">
      <header className="head"><div><p className="kicker">CyberJudah</p><h1 className="title">Ask CyberJudah</h1></div></header>
      {!turns.length ? (
        <div className="chat__intro">
          <p className="hint hint--lede">Ask anything about what was taught. Answers come from the classes, the Captains, the notes, the law, the cases and the Scripture, and every claim shows where it came from. Ask a follow-up to go deeper.</p>
          <Chips>{EXAMPLES.map((e) => <Chip key={e} onClick={() => void send(e)}>{e}</Chip>)}</Chips>
        </div>
      ) : null}
      <div className="chat__turns">
        {turns.map((t, i) => t.role === "user" ? <div key={i} className="bubble bubble--me">{t.content}</div> : <AssistantTurn key={i} t={t} />)}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <textarea ref={boxRef} value={input} rows={1} placeholder={turns.length ? "Ask a follow-up…" : "Ask CyberJudah…"} aria-label="Your question" enterKeyHint="send" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
        <button type="submit" className="composer__go" aria-label="Send" disabled={busy || !input.trim()}><Icon name="chevron" size={20} /></button>
      </form>
      {turns.length ? <button type="button" className="link chat__new" onClick={() => { setTurns([]); setInput(""); }}>New conversation</button> : null}
    </main>
  );
}

function AssistantTurn({ t }: { t: Turn }) {
  if (t.thinking) return <div className="bubble bubble--ai answer--thinking"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span>Reading the teachings…</div>;
  if (t.error && !t.content) return <div className="bubble bubble--ai bubble--err">{t.error === "limit" ? "That is a hundred questions today; the count starts again tomorrow." : t.error === "too-short" ? "Ask a fuller question." : "CyberJudah did not answer just now. Try again in a moment."}</div>;
  const sources = t.sources ?? [];
  const lookup = sources.length ? sources : (t.passages ?? []);
  return (
    <div className="bubble bubble--ai">
      <AnswerText text={t.content} sources={lookup} />
      {sources.length ? (
        <div className="sources">
          {sources.map((s) => <a key={s.n} className="source" href={passagePath(s)} onClick={(e) => { e.preventDefault(); haptic("select"); window.history.pushState(null, "", passagePath(s)); window.dispatchEvent(new PopStateEvent("popstate")); }}><b className="answer__n">{s.n}</b><span><span className="source__title">{s.title}</span><small>{passageLabel(s)}</small></span><Icon name="chevron" size={14} /></a>)}
        </div>
      ) : null}
    </div>
  );
}

/** The answer with its [n] citations as chips that open the passage. */
function AnswerText({ text, sources }: { text: string; sources: Source[] }) {
  return (
    <>
      {text.split(/\n{2,}/).filter(Boolean).map((para, i) => (
        <p key={i}>
          {para.split(/(\[\d{1,2}(?:\s*,\s*\d{1,2})*\])/g).map((part, k) => {
            const ns = /^\[/.test(part) ? (part.match(/\d{1,2}/g) ?? []).map(Number) : null;
            if (!ns) return part;
            return ns.map((n) => { const s = sources.find((x) => x.n === n); return s ? <a key={`${k}-${n}`} className="cite" href={passagePath(s)} onClick={(e) => { e.preventDefault(); haptic("select"); window.history.pushState(null, "", passagePath(s)); window.dispatchEvent(new PopStateEvent("popstate")); }}>{n}</a> : <sup key={`${k}-${n}`}>{n}</sup>; });
          })}
        </p>
      ))}
    </>
  );
}
