import { marked } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, ApiError, app, confirm, haptic, hideKeyboard, openInvoice } from "@/tg/sdk";
import { Trouble } from "@/ui/trouble";
import { Sheet } from "@/bible/ui/Sheet";
import { Icon, timestamp } from "@/ui/ui";
import { KIND_LABEL, hitPath, teachingPath } from "@/ui/search-hero";
import { KIND_NAME } from "./Home";

export type Passage = { kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string; text: string };
export type Source = Passage & { n: number };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; passages?: Source[]; error?: string; thinking?: boolean; status?: string; steps?: string[]; followups?: string[] };
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
  // The conversation's id on the server, where every finished answer is saved to the person.
  const [chatId, setChatId] = useState<string | null>(() => { try { return sessionStorage.getItem(`${STORE}:id`); } catch { return null; } });
  const [history, setHistory] = useState(false);
  const [plans, setPlans] = useState(false);
  const [acct, setAcct] = useState<AskAccount | null>(null);
  const loadAccount = () => api<AskAccount>("/api/ask/account").then(setAcct).catch(() => undefined);
  useEffect(() => { void loadAccount(); }, []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stick = useRef(true);
  // Ask is a tab: Telegram's back button closes the app from here, as on the other tabs.
  useBackButton(true);
  useBottomButtons(null, null);
  // While the question is being typed the tab bar steps aside for the keyboard, as in Messages.
  const typing = (on: boolean) => { if (on) document.documentElement.dataset.typing = ""; else delete document.documentElement.dataset.typing; };
  useEffect(() => () => typing(false), []);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(turns.filter((t) => !t.thinking))); if (chatId) sessionStorage.setItem(`${STORE}:id`, chatId); else sessionStorage.removeItem(`${STORE}:id`); } catch { /* private mode */ } }, [turns, chatId]);
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
    const id = chatId ?? newId(); if (!chatId) setChatId(id);
    const patch = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)));
    const ctl = new AbortController(); abortRef.current = ctl;
    try {
      const res = await fetch("/api/ask", { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", Authorization: `tma ${app?.initData ?? ""}` }, body: JSON.stringify({ q, history, stream: true, chat: id }) });
      if (!res.ok || !res.body) { patch((t) => ({ ...t, thinking: false, error: res.status === 402 ? "allowance" : res.status === 429 ? "limit" : res.status === 401 ? "session" : `unavailable:${res.status}` })); if (res.status === 402) void loadAccount(); return; }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          let msg: { passages?: Source[]; delta?: string; done?: boolean; sources?: Source[]; error?: string; status?: string; reset?: boolean; answer?: string; followups?: string[]; usage?: { units: number; balance: Balance } };
          try { msg = JSON.parse(l); } catch { continue; }
          if (msg.passages) patch((t) => ({ ...t, passages: msg.passages }));
          // The research as it happens: each search and reading is a step under the answer's head.
          if (msg.status) patch((t) => ({ ...t, status: msg.status, steps: /^(Searching|Reading)/.test(msg.status!) ? [...(t.steps ?? []), msg.status!] : t.steps }));
          if (msg.reset) patch((t) => ({ ...t, content: "", thinking: true }));
          if (msg.delta) patch((t) => ({ ...t, thinking: false, content: t.content + msg.delta }));
          if (msg.usage) setAcct((a) => (a ? { ...a, balance: msg.usage!.balance } : a));
          if (msg.done) patch((t) => ({ ...t, thinking: false, content: msg.answer ?? t.content, sources: msg.sources ?? [], followups: msg.followups ?? [] }));
          if (msg.error) patch((t) => ({ ...t, thinking: false, error: msg.error }));
        }
      }
      patch((t) => (t.thinking ? { ...t, thinking: false, error: t.content ? undefined : "unavailable" } : t));
    } catch {
      patch((t) => (ctl.signal.aborted ? { ...t, thinking: false, error: t.content ? undefined : "stopped" } : { ...t, thinking: false, error: "unavailable" }));
    } finally { setBusy(false); abortRef.current = null; }
  };
  const stop = () => { haptic("select"); abortRef.current?.abort(); };
  const newChat = () => { haptic("select"); abortRef.current?.abort(); setTurns([]); setChatId(null); setInput(""); boxRef.current?.focus(); };
  const openChat = (c: SavedChat) => { abortRef.current?.abort(); setChatId(c.id); setTurns(c.turns.map((t) => ({ ...t, sources: t.sources?.map((x) => ({ ...x, text: "" })) }))); setHistory(false); stick.current = true; };
  useEffect(() => { if (first) { setParams({}, { replace: true }); void send(first); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  return (
    <main className="chat2">
      <header className="chat2__bar">
        <button type="button" className="chat2__new" aria-label="Your chats" onClick={() => { haptic("select"); setHistory(true); }}><Icon name="history" size={21} /></button>
        <button type="button" className="chat2__heading" onClick={() => { if (acct?.metered) { haptic("select"); setPlans(true); } }}><b>Ask CyberJudah</b><small>{meterLine(acct)}</small></button>
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
            ? <div key={`${chatId}-${i}`} className="msg msg--me"><div className="msg__bubble">{t.content}</div></div>
            : <AssistantTurn key={`${chatId}-${i}`} t={t} question={turns[i - 1]?.content ?? ""} last={i === turns.length - 1} busy={busy} onRetry={() => void send(lastUser, true)} onFollow={(q) => void send(q)} onPlans={() => setPlans(true)} />)}
          <div ref={endRef} className="chat2__end" />
        </div>
      )}

      {plans && acct ? <PlansSheet acct={acct} onClose={() => setPlans(false)} onPaid={() => { setPlans(false); void pollAccount(acct, setAcct); }} /> : null}
      {history ? <ChatsSheet current={chatId} onClose={() => setHistory(false)} onOpen={openChat} onDeleted={(id) => { if (id === chatId) { setTurns([]); setChatId(null); } }} /> : null}
      <form className="composer2" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <div className="composer2__box">
          <textarea ref={boxRef} value={input} rows={1} placeholder={turns.length ? "Ask a follow-up" : "Ask CyberJudah"} aria-label="Your question" enterKeyHint="send" onChange={(e) => setInput(e.target.value)} onFocus={() => typing(true)} onBlur={() => typing(false)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
          {busy
            ? <button type="button" className="composer2__go composer2__go--stop" aria-label="Stop" onClick={stop}><span /></button>
            : <button type="submit" className="composer2__go" aria-label="Send" disabled={!input.trim()}><Icon name="arrowUp" size={20} /></button>}
        </div>
        <p className="composer2__note">Answers can be wrong. Check them against the sources.</p>
      </form>
    </main>
  );
}

function AssistantTurn({ t, question, last, busy, onRetry, onFollow, onPlans }: { t: Turn; question: string; last: boolean; busy: boolean; onRetry: () => void; onFollow: (q: string) => void; onPlans: () => void }) {
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
      {t.steps?.length ? <Research steps={t.steps} live={!!t.thinking || (busy && last)} count={t.passages?.length ?? 0} /> : null}
      {t.thinking ? (
        <div className="msg__thinking"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span>{t.status && !/^(Searching|Reading)/.test(t.status) ? `${t.status}…` : t.passages?.length ? `Reading ${t.passages.length} passages from the teachings…` : "Searching the teachings…"}</div>
      ) : t.error === "allowance" && !t.content ? (
        <div className="paywall">
          <b>You have used today's free answers</b>
          <p>Subscribe for a month of in-depth answers, or top up with Stars. Your free answers come back tomorrow.</p>
          <button type="button" className="paywall__go" onClick={onPlans}>See the plans</button>
        </div>
      ) : t.error && !t.content ? (
        t.error === "limit" || t.error === "too-short" || t.error === "stopped" ? (
          <div className="msg__error">
            <p>{t.error === "limit" ? "That is a hundred questions today. The count starts again tomorrow." : t.error === "too-short" ? "Ask a fuller question." : "Stopped."}</p>
            {last && t.error !== "limit" ? <button type="button" className="msg__action" onClick={onRetry}><Icon name="retry" size={16} />Try again</button> : null}
          </div>
        ) : <Trouble error={new ApiError(t.error === "session" ? 401 : Number(t.error?.split(":")[1]) || 503, "/api/ask", t.error === "session" ? "stale" : t.error)} what="ask" q={question} onRetry={last ? onRetry : undefined} />
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
          {last && !busy && t.followups?.length ? (
            <div className="followups">
              {t.followups.map((q) => <button key={q} type="button" className="followup" onClick={() => onFollow(q)}><Icon name="arrowUp" size={14} /><span>{q}</span></button>)}
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

type Balance = { free: number; plan: number; planOn: boolean; planUntil: number | null; planAllowance: number; credits: number; total: number };
type AskAccount = { metered: boolean; unlimited: boolean; balance: Balance; perQuestion: number; freeDaily: number; plan: { stars: number; units: number }; packs: { stars: number; units: number }[] };
const answers = (units: number, per: number) => Math.max(0, Math.floor(units / Math.max(per, 1)));
/** The line under Ask's title: how much is left, in answers, the way an AI app shows it. */
function meterLine(a: AskAccount | null): string {
  if (!a || !a.metered) return "Answers from the teachings";
  if (a.unlimited) return "Unlimited · admin";
  const n = answers(a.balance.total, a.perQuestion);
  if (a.balance.planOn) return `Monthly plan · about ${n} answers left`;
  if (!n) return "No answers left today · see plans";
  return `About ${n} ${n === 1 ? "answer" : "answers"} left${a.balance.credits ? "" : " today"} · plans`;
}
/** After paying, the credit lands when Telegram tells the bot; look again for a little while. */
async function pollAccount(before: AskAccount, set: (a: AskAccount) => void) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const a = await api<AskAccount>("/api/ask/account").catch(() => null);
    if (a) { set(a); if (a.balance.total > before.balance.total || a.balance.planOn !== before.balance.planOn) return; }
  }
}

/** The plans: what is left now, the monthly subscription, and top-up packs, paid in Stars. */
function PlansSheet({ acct, onClose, onPaid }: { acct: AskAccount; onClose: () => void; onPaid: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const per = acct.perQuestion, b = acct.balance;
  const buy = async (item: string) => {
    haptic("select"); setBusy(item);
    try {
      const r = await api<{ ok: boolean; link?: string }>("/api/ask/buy", { method: "POST", json: { item } });
      if (r.link) { const status = await openInvoice(r.link); if (status === "paid") { haptic("success"); onPaid(); } }
    } catch { /* the invoice could not be made; the sheet stays open */ }
    finally { setBusy(null); }
  };
  const until = b.planUntil ? new Date(b.planUntil).toLocaleDateString([], { month: "long", day: "numeric" }) : "";
  return (
    <Sheet open onClose={onClose} height="full" title="Ask CyberJudah" subTitle="Paid with Telegram Stars" className="chats-sheet">
      <div className="plans">
        <div className="plans__now">
          <b>About {answers(b.total, per)} answers left</b>
          <small>{[b.free ? `${answers(b.free, per)} free today` : "", b.planOn ? `${answers(b.plan, per)} this month, until ${until}` : "", b.credits ? `${answers(b.credits, per)} in credit` : ""].filter(Boolean).join(" · ") || "Your free answers come back tomorrow"}</small>
          <div className="plans__bar"><i style={{ width: `${Math.min(100, Math.round((b.total / Math.max(b.total + 1, (b.planOn ? b.planAllowance : acct.freeDaily) + b.credits)) * 100))}%` }} /></div>
        </div>
        <div className="plan plan--main">
          <div><b>Monthly</b><small>About {answers(acct.plan.units, per)} in-depth answers every month. Renews until you cancel in Telegram.</small></div>
          {b.planOn ? <span className="plan__on">Active</span> : <button type="button" className="plan__buy" disabled={!!busy} onClick={() => void buy("plan")}>{busy === "plan" ? "…" : `⭐ ${acct.plan.stars}`}<small>/month</small></button>}
        </div>
        <p className="plans__label">Top up</p>
        {acct.packs.map((p) => (
          <div key={p.stars} className="plan">
            <div><b>About {answers(p.units, per)} answers</b><small>Credit that does not expire</small></div>
            <button type="button" className="plan__buy plan__buy--quiet" disabled={!!busy} onClick={() => void buy(`pack:${p.stars}`)}>{busy === `pack:${p.stars}` ? "…" : `⭐ ${p.stars}`}</button>
          </div>
        ))}
        <p className="hint">A deep question, with several searches of the library, uses more than a quick follow-up. Everyone gets {answers(acct.freeDaily, per)} free answers a day. Your chats, search, reading and PDFs stay free.</p>
      </div>
    </Sheet>
  );
}

type SavedChat = { id: string; title: string; updated: string; turns: Turn[] };
type ChatSummary = { id: string; title: string; updated: string; count: number };
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24);
const when = (iso: string) => {
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

/** Every conversation the person had with CyberJudah, kept on the server: tap to reopen, delete to forget. */
function ChatsSheet({ current, onClose, onOpen, onDeleted }: { current: string | null; onClose: () => void; onOpen: (c: SavedChat) => void; onDeleted: (id: string) => void }) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void api<{ chats: ChatSummary[] }>("/api/chats").then((r) => setChats(r.chats)).catch(() => setFailed(true)); }, []);
  const open = async (id: string) => { haptic("select"); try { const r = await api<{ chat: SavedChat }>(`/api/chats/${id}`); onOpen(r.chat); } catch { setFailed(true); } };
  const remove = async (c: ChatSummary) => {
    if (!(await confirm(`Delete "${c.title}"?`))) return;
    await api(`/api/chats/${c.id}`, { method: "DELETE" }).catch(() => undefined);
    haptic("success"); setChats((cs) => (cs ?? []).filter((x) => x.id !== c.id)); onDeleted(c.id);
  };
  return (
    <Sheet open onClose={onClose} height="full" title="Your chats" subTitle="Saved to your account" className="chats-sheet">
      <div className="chats">
        {failed ? <p className="hint">Your chats could not be loaded. Check the connection and try again.</p>
          : !chats ? <p className="hint">Loading…</p>
          : !chats.length ? <p className="hint">No chats yet. Every question you ask is saved here with its answer.</p>
          : chats.map((c) => (
            <div key={c.id} className="chats__row" data-current={c.id === current ? "" : undefined}>
              <button type="button" className="chats__open" onClick={() => void open(c.id)}><b>{c.title}</b><small>{when(c.updated)} · {c.count} {c.count === 1 ? "question" : "questions"}</small></button>
              <button type="button" className="chats__del" aria-label={`Delete ${c.title}`} onClick={() => void remove(c)}><Icon name="trash" size={18} /></button>
            </div>
          ))}
      </div>
    </Sheet>
  );
}

/**
 * What CyberJudah looked at before answering, the way a research assistant shows its work:
 * one line while it works, the list of searches and readings when tapped.
 */
function Research({ steps, live, count }: { steps: string[]; live: boolean; count: number }) {
  const [open, setOpen] = useState(false);
  const searches = steps.filter((s) => s.startsWith("Searching")).length, readings = steps.length - searches;
  const summary = live ? steps[steps.length - 1] : [searches ? `${searches} search${searches > 1 ? "es" : ""}` : "", readings ? `${readings} reading${readings > 1 ? "s" : ""}` : "", count ? `${count} sources` : ""].filter(Boolean).join(" · ");
  return (
    <div className="research" data-open={open ? "" : undefined}>
      <button type="button" className="research__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="search" size={14} /><span>{live ? `${summary}…` : `Researched: ${summary}`}</span><span className="research__chev"><Icon name="chevron" size={14} /></span>
      </button>
      {open ? <ul className="research__steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ul> : null}
    </div>
  );
}

/** Any HTML the model writes shows as text; ">" stays, since it only starts a quote in markdown. */
const escapeHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** The answer as text for the clipboard: the citation markers dropped. */
const plain = (text: string) => text.replace(/\n?[ \t]*\**Follow-ups:[\s\S]*$/i, "").replace(/\s*\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, "").replace(/ +([.,;:!?])/g, "$1").trim();

/**
 * The answer as formatted prose: the model's markdown (bold, lists, headings) rendered with
 * any HTML it wrote shown as text, and each [n] marker a numbered chip that opens source n.
 * A marker still arriving mid-stream ("[1") is held back until it is whole.
 */
export function answerHtml(text: string, sources: Source[]): string {
  const known = new Set(sources.map((s) => s.n));
  const marked_ = escapeHtml(text.replace(/\n?[ \t]*\**Follow-ups:[\s\S]*$/i, "").replace(/\s*\[\d{0,2}$/, ""))
    .replace(/\s*\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g, (_m, list: string) => list.split(/\s*,\s*/).map((n) => (known.has(Number(n)) ? ` CJCITE${n}CJ` : "")).join(""));
  const html = marked.parse(marked_, { gfm: true, breaks: false, async: false }) as string;
  return html.replace(/ ?CJCITE(\d{1,2})CJ/g, (_m, n: string) => `<button type="button" class="cite" data-n="${n}" aria-label="Source ${n}">${n}</button>`);
}
