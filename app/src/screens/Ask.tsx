import { marked } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, ApiError, app, authHeaders, confirm, ensureDevice, isTelegramWebApp, haptic, hideKeyboard, openInvoice, requestWriteAccess, user } from "@/tg/sdk";
import { saveReminder, timeLabel, timeZone, type Settings as ReminderSettings } from "@/lib/reminders";
import { useContent } from "./Reminders";
import { safeLinks } from "@/lib/safe-links";
import { resetTime } from "@/lib/reset-time";
import { chosenModel, chooseModel } from "@/lib/ask-model";
import { agree, consented } from "@/lib/ai-consent";
import { spinnerLine } from "@/lib/spinner";
import { Trouble } from "@/ui/trouble";
import { OpenInTelegram } from "@/ui/open-in-telegram";
import { Sheet } from "@/bible/ui/Sheet";
import { Icon, timestamp } from "@/ui/ui";
import { KIND_LABEL, hitPath, teachingPath } from "@/ui/search-hero";
import { assetUrl } from "@/lib/asset";
import { showOf } from "@/lib/series";
import { linkRefsInHtml, useBookSlugs } from "@/ui/reftext";
import { KIND_NAME } from "./Home";

export type Passage = { kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string; text: string };
export type Source = Passage & { n: number };
/** A change the assistant proposed; only the reader's Confirm carries it out (bot/src/assistant.mjs). */
export type Action = { id: string; kind: "reminder"; summary: string; settings: ReminderSettings; state?: "applied" | "cancelled" };
type Turn = { role: "user" | "assistant"; content: string; sources?: Source[]; passages?: Source[]; error?: string; cut?: boolean; thinking?: boolean; status?: string; steps?: string[]; followups?: string[]; actions?: Action[]; waiting?: boolean; backup?: boolean; limited?: boolean; consent?: { provider: string; model: string } };
/** The welcome screen's starters: a question and the line under it. */
const EXAMPLES: [string, string][] = [
  ["Why do we keep the Passover?", "The feast, from the law to Christ"],
  ["Who are the twelve tribes today?", "Where the scattered nation is now"],
  ["What does the law say about usury?", "Lending among the brethren"],
  ["How is the Sabbath kept?", "The day, the rest and the assembly"],
];
/** Kept per account: a phone shared by two readers never shows one the other's conversation. */
const STORE = `cj:ask:${user?.id ?? "guest"}`;

/**
 * The conversation lives outside the screen, for as long as the app is open: an answer keeps
 * streaming in while the reader visits a source and is there when they come back. It is kept in
 * the device's storage too, so a refresh or a new session opens it again; the answers themselves
 * are saved to the person's account on the server (see ChatsSheet). `gen` changes whenever the
 * conversation is replaced (a new chat, another chat opened), so an answer still arriving for the
 * old one never lands in the new one.
 */
type Conv = { turns: Turn[]; chatId: string | null; busy: boolean; gen: number };
const readStore = (): Conv => {
  try {
    // The old shared key held whoever asked last on this device: it is not carried over.
    localStorage.removeItem("cj:ask");
    const raw = localStorage.getItem(STORE);
    const saved = raw ? JSON.parse(raw) as { turns?: Turn[]; chatId?: string | null } : null;
    const turns = (saved?.turns ?? []).filter((t) => t && !t.thinking && !t.waiting);
    return { turns, chatId: saved?.chatId ?? null, busy: false, gen: 0 };
  } catch { return { turns: [], chatId: null, busy: false, gen: 0 }; }
};
let conv: Conv = readStore();
const convListeners = new Set<() => void>();
const setConv = (next: Partial<Conv> | ((c: Conv) => Partial<Conv>)) => {
  conv = { ...conv, ...(typeof next === "function" ? next(conv) : next) };
  try { localStorage.setItem(STORE, JSON.stringify({ turns: conv.turns.filter((t) => !t.thinking && !t.waiting), chatId: conv.chatId })); } catch { /* private mode */ }
  convListeners.forEach((l) => l());
};
const useConv = () => useSyncExternalStore((l) => { convListeners.add(l); return () => { convListeners.delete(l); }; }, () => conv);
let convAbort: AbortController | null = null;
/** Replace the conversation (a new chat, or a saved one opened): whatever was arriving for the old one is let go. */
const replaceConv = (next: { turns: Turn[]; chatId: string | null }) => { convAbort?.abort(); convAbort = null; setConv({ ...next, busy: false, gen: conv.gen + 1 }); };
/** Patch the last turn of conversation `gen` only (the answer being written); a replaced conversation is left alone. */
const patchLast = (gen: number, fn: (t: Turn) => Turn) => { if (conv.gen === gen) setConv((c) => ({ turns: c.turns.map((t, i) => (i === c.turns.length - 1 ? fn(t) : t)) })); };

type AskFail = { error?: string; reason?: string; provider?: string; model?: string; browser?: boolean };
/** What went wrong, from the status and the server's own words. */
const failure = (status: number, body: AskFail | null): string =>
  status === 428 && body?.error === "consent" ? "consent" : status === 402 ? "allowance" : status === 429 ? (body?.browser ? "browser-limit" : "limit") : status === 400 && body?.error === "too-short" ? "too-short"
    : status === 401 ? (body?.reason === "missing" ? "signin" : "session") : `unavailable:${status}`;
/** No line from the server for this long (it sends one every 15 seconds while it works): the connection is gone. */
const STALL_MS = 45_000;

/**
 * Ask a question: streamed in, saved to the account by the server as it completes. Returns
 * false when it was not sent (empty, or an answer is still coming), so the composer keeps the text.
 */
function askQuestion(text: string, opts: { retry?: boolean; onAccount?: () => void; setBalance?: (b: Balance) => void } = {}): boolean {
  const q = text.trim();
  if (!q || conv.busy) return false;
  void runQuestion(q, opts);
  return true;
}
async function runQuestion(q: string, opts: { retry?: boolean; onAccount?: () => void; setBalance?: (b: Balance) => void }) {
  haptic("select"); hideKeyboard();
  const base = opts.retry ? conv.turns.slice(0, -2) : conv.turns;
  // The server shapes the history for the model (normalizeHistory); only settled turns are sent.
  const history = base.filter((t) => !t.error && !t.thinking && t.content.trim()).slice(-8).map((t) => ({ role: t.role, content: t.content }));
  const id = conv.chatId ?? newId();
  setConv({ turns: [...base, { role: "user", content: q }, { role: "assistant", content: "", thinking: true }], chatId: id, busy: true });
  const gen = conv.gen;
  const patch = (fn: (t: Turn) => Turn) => patchLast(gen, fn);
  const ctl = new AbortController(); convAbort = ctl;
  let finished = false, stalled = false, heard = Date.now();
  const watch = setInterval(() => { if (Date.now() - heard > STALL_MS) { stalled = true; ctl.abort(); } }, 5000);
  try {
    // Outside Telegram the browser asks with its own credential (tg/sdk ensureDevice), made on its first question.
    if (!app && !(await ensureDevice())) { patch((t) => ({ ...t, thinking: false, error: navigator.onLine === false ? "offline" : "no-device" })); return; }
    const res = await fetch("/api/ask", { method: "POST", signal: ctl.signal, headers: authHeaders(new Headers({ "content-type": "application/json" })), body: JSON.stringify({ q, history, stream: true, chat: id, retry: !!opts.retry, consent: consented(), ...(chosenModel() ? { model: chosenModel() } : {}) }) });
    heard = Date.now();
    if (!res.ok || !res.body) {
      const body = await res.text().then((t) => { try { return JSON.parse(t.split("\n")[0]) as AskFail; } catch { return null; } }).catch(() => null);
      patch((t) => ({ ...t, thinking: false, error: failure(res.status, body), ...(body?.error === "consent" && body.provider ? { consent: { provider: body.provider, model: body.model ?? body.provider } } : {}) }));
      if (res.status === 402) opts.onAccount?.();
      return;
    }
    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    const handle = (l: string) => {
      if (!l.trim()) return;
      let msg: { passages?: Source[]; delta?: string; done?: boolean; sources?: Source[]; error?: string; status?: string; reset?: boolean; answer?: string; followups?: string[]; usage?: { units: number; balance: Balance }; action?: Action; actions?: Action[]; cut?: boolean; ping?: number; backup?: boolean; limited?: boolean };
      try { msg = JSON.parse(l); } catch { return; }
      if (msg.passages) patch((t) => ({ ...t, passages: msg.passages }));
      // The research as it happens: each search, reading and look-up is a step under the answer's head.
      if (msg.status) patch((t) => ({ ...t, status: msg.status, steps: /^(Searching|Reading|Looking)/.test(msg.status!) ? [...(t.steps ?? []), msg.status!] : t.steps }));
      if (msg.action) patch((t) => ({ ...t, actions: [...(t.actions ?? []), msg.action!] }));
      if (msg.reset) patch((t) => ({ ...t, content: "", thinking: true }));
      if (msg.delta) patch((t) => ({ ...t, thinking: false, content: t.content + msg.delta }));
      if (msg.usage) opts.setBalance?.(msg.usage.balance);
      if (msg.done) { finished = true; haptic("success"); patch((t) => ({ ...t, thinking: false, cut: !!msg.cut, error: undefined, content: msg.answer || t.content, sources: msg.sources ?? [], followups: msg.followups ?? [], actions: msg.actions ?? t.actions, backup: !!msg.backup, limited: !!msg.limited })); }
      // A failure after part of the answer keeps the part and says it was cut off.
      if (msg.error) { finished = true; patch((t) => (t.content ? { ...t, thinking: false, cut: true } : { ...t, thinking: false, error: msg.error })); }
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      heard = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buffer + decoder.decode());
    // The stream ended without its last line: the server may still finish and save it.
    if (!finished) { patch((t) => ({ ...t, thinking: false, error: "network" })); void recoverChat(); }
  } catch {
    if (ctl.signal.aborted && !stalled) patch((t) => (t.role !== "assistant" ? t : { ...t, thinking: false, error: t.content ? undefined : "stopped", cut: t.content ? true : undefined }));
    else {
      // The connection was lost (or went silent): the server goes on, so wait for its saved answer.
      patch((t) => ({ ...t, thinking: false, error: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "network" }));
      void recoverChat();
    }
  } finally {
    clearInterval(watch);
    if (convAbort === ctl) { convAbort = null; if (conv.gen === gen) setConv({ busy: false }); }
  }
}
const stopAsking = () => { convAbort?.abort(); };
const startNewChat = () => replaceConv({ turns: [], chatId: null });
const fromSaved = (turns: Turn[]): Turn[] => turns.map((t) => ({ ...t, sources: t.sources?.map((x) => ({ ...x, text: "" })) }));

/** Failures after which the server may still have finished and saved the answer. */
const RECOVERABLE = new Set(["network", "offline", "interrupted", "unavailable"]);
let recovering = false;
/**
 * A conversation left mid-answer (the app closed or refreshed, the connection lost): the server
 * goes on and saves the answer, so it is fetched back, and while the server says it is still
 * answering, waited for. Only when the server has neither is it called interrupted.
 */
async function recoverChat() {
  const last = conv.turns[conv.turns.length - 1];
  // A browser's conversation is not saved on the server (it has no account there): nothing to fetch back.
  if (!app) return;
  const open = last && (last.role === "user" || (last.role === "assistant" && ((last.error && RECOVERABLE.has(last.error)) || last.cut)));
  if (recovering || conv.busy || !conv.chatId || !open) return;
  const id = conv.chatId, gen = conv.gen;
  const qi = last.role === "user" ? conv.turns.length - 1 : conv.turns.length - 2;
  const question = conv.turns[qi]?.content.trim();
  const still = () => conv.gen === gen && conv.chatId === id && !conv.busy;
  recovering = true;
  try {
    for (let i = 0; i < 45 && still(); i++) {
      let r: { chat?: SavedChat | null; pending?: { q: string } | null } | null = null;
      try { r = await api<{ ok: boolean; chat?: SavedChat | null; pending?: { q: string } | null }>(`/api/chats/${id}`); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) { if (i === 0 && still() && last.role === "user") setConv((c) => ({ turns: [...c.turns, { role: "assistant", content: "", error: navigator.onLine === false ? "offline" : "network" }] })); return; } }
      if (!still()) return;
      const saved = r?.chat?.turns ?? [];
      const n = saved.length;
      // The question's answer is saved: the conversation is the server's from here.
      if (n >= 2 && saved[n - 1].role === "assistant" && saved[n - 2].content.trim() === question) { setConv({ turns: fromSaved(saved) }); return; }
      if (r?.pending?.q?.trim() === question) {
        // Still being answered: say so, and look again in a few seconds.
        setConv((c) => {
          const turns = c.turns[c.turns.length - 1]?.role === "user" ? [...c.turns, { role: "assistant" as const, content: "" }] : [...c.turns];
          turns[turns.length - 1] = { ...turns[turns.length - 1], content: "", error: undefined, cut: false, waiting: true, thinking: true, status: "Still answering" };
          return { turns };
        });
        await new Promise((res) => setTimeout(res, 4000));
        continue;
      }
      break;
    }
    if (!still()) return;
    setConv((c) => {
      const turns = c.turns[c.turns.length - 1]?.role === "user" ? [...c.turns, { role: "assistant" as const, content: "" }] : [...c.turns];
      const t = turns[turns.length - 1];
      turns[turns.length - 1] = t.content && !t.waiting ? { ...t, thinking: false, waiting: false, cut: true } : { ...t, content: "", thinking: false, waiting: false, error: "interrupted" };
      return { turns };
    });
  } finally { recovering = false; }
}

/** Where a cited passage opens: the class at its moment, the note at its section, the verse. */
export const passagePath = (p: Passage) => p.video ? teachingPath({ video: p.video, start: p.t ?? 0, note: p.url }) : hitPath({ kind: p.kind, title: p.title, url: p.url, sub: p.sub ?? "", snippet: "" });
export const passageLabel = (p: Passage) => p.video ? `${showOf(p.title) ?? KIND_NAME[p.sub as keyof typeof KIND_NAME] ?? "Recording"}${p.date ? ` · ${fmtDate(p.date)}` : ""} · ${timestamp(p.t ?? 0)}` : `${KIND_LABEL[p.kind] ?? p.kind}${p.sub ? ` · ${p.sub}` : ""}`;

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
  const { turns, chatId, busy } = useConv();
  const [history, setHistory] = useState(false);
  const [plans, setPlans] = useState(false);
  const [picking, setPicking] = useState(false);
  const [modelId, setModelId] = useState(chosenModel);
  const [acct, setAcct] = useState<AskAccount | null>(null);
  const loadAccount = () => api<AskAccount>("/api/ask/account").then(setAcct).catch(() => undefined);
  // A browser gets its credential on opening Ask, so the allowance line and the first question are ready.
  useEffect(() => { void (app ? loadAccount() : ensureDevice().then((d) => (d ? loadAccount() : undefined))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const model = acct?.models?.find((m) => m.id === modelId) ?? acct?.models?.find((m) => m.id === acct.model);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  // Ask is a tab: Telegram's back button closes the app from here, as on the other tabs.
  useBackButton(true);
  useBottomButtons(null, null);
  // While the question is being typed the tab bar steps aside for the keyboard, as in Messages.
  const typing = (on: boolean) => { if (on) document.documentElement.dataset.typing = ""; else delete document.documentElement.dataset.typing; };
  useEffect(() => () => typing(false), []);

  // Follow the answer as it streams, unless the reader scrolled up to read.
  useEffect(() => {
    const onScroll = () => { stick.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);
  // The conversation keeps clear of the composer, whatever its height (a long question, the keyboard).
  const formRef = useRef<HTMLFormElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const f = formRef.current, m = mainRef.current;
    if (!f || !m || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => m.style.setProperty("--composer-h", `${Math.ceil(f.getBoundingClientRect().height)}px`));
    ro.observe(f);
    return () => ro.disconnect();
  }, []);
  // The composer grows with the question, up to a few lines.
  useLayoutEffect(() => { const b = boxRef.current; if (!b) return; b.style.height = "auto"; b.style.height = `${Math.min(b.scrollHeight, 160)}px`; }, [input]);

  const setBalance = (b: Balance) => setAcct((a) => (a ? { ...a, balance: b } : a));
  // The composer keeps what was typed unless the question went (an answer still coming holds it back).
  const send = (text: string, retry = false) => { stick.current = true; if (askQuestion(text, { retry, onAccount: () => void loadAccount(), setBalance }) && text === input) setInput(""); };
  const stop = () => { haptic("select"); stopAsking(); };
  const newChat = () => { haptic("select"); startNewChat(); setInput(""); boxRef.current?.focus(); };
  const openChat = (c: SavedChat) => { replaceConv({ chatId: c.id, turns: fromSaved(c.turns) }); setHistory(false); stick.current = true; void recoverChat(); };
  // A question from elsewhere (Home, a verse) starts its own conversation, once (StrictMode runs effects twice).
  // A link to one saved chat (?chat=<id>, as Ask's own answers give) opens it, from anywhere in
  // the app or from an answer on this screen.
  const linked = params.get("chat");
  useEffect(() => {
    if (!linked) return;
    setParams({}, { replace: true });
    if (!app || !/^[a-z0-9]{8,40}$/.test(linked)) return;
    if (linked === conv.chatId) { void recoverChat(); return; }
    void api<{ chat: SavedChat | null; pending?: { q: string } | null }>(`/api/chats/${linked}`)
      .then((r) => openChat(r.chat ?? { id: linked, title: "", updated: "", turns: r.pending ? [{ role: "user", content: r.pending.q }] : [] }))
      .catch(() => undefined);
  }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || linked) return;
    asked.current = true;
    // While an answer is still coming the question waits in the composer, rather than being dropped.
    if (first) { setParams({}, { replace: true }); if (conv.busy) setInput(first); else { startNewChat(); send(first); } }
    else void recoverChat();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back to the app, or back online: an answer the server finished meanwhile is fetched.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") void recoverChat(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("online", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("online", again); };
  }, []);

  // Outside Telegram (a browser, or Telegram's own browser without launch data) Ask answers with the
  // free model under the browser's credential, and the conversation stays on this device.
  const browser = !app;
  const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
  return (
    <main className="chat2" ref={mainRef}>
      <header className="chat2__bar">
        <button type="button" className="chat2__new" aria-label="Your chats" disabled={browser} title={browser ? "Your chats are kept with your Telegram account" : undefined} onClick={() => { haptic("select"); setHistory(true); }}><Icon name="history" size={21} /></button>
        <button type="button" className="chat2__heading" onClick={() => { if (acct?.metered) { haptic("select"); setPlans(true); } }}><b>Ask CyberJudah</b><small>{acct?.browser ? `${model?.name ?? "Free model"} · ${acct.browserDaily ?? 10} a day here` : model?.free && acct?.metered && !acct.unlimited ? `${model.name} · free` : meterLine(acct, model?.cost)}</small></button>
        <button type="button" className="chat2__new" aria-label="New chat" disabled={!turns.length} onClick={newChat}><Icon name="compose" size={21} /></button>
      </header>

      {!turns.length ? (
        <section className="chat2__welcome">
          <img className="chat2__mark" src={assetUrl("brand/cyber-lion.webp")} alt="" width={72} height={72} />
          <h1>What would you like to learn?</h1>
          <p>Ask about anything that was taught. Every answer comes from the classes, the notes, the law and the Scripture, and shows where it came from.</p>
          {browser && !isTelegramWebApp ? (
            <p className="chat2__outside" role="note">In this browser Ask answers with the free model, a few questions a day, and keeps the conversation on this device. <OpenInTelegram className="msg__link" label="In Telegram it answers in depth and saves your chats" /></p>
          ) : null}
          <div className="chat2__starters">
            {EXAMPLES.map(([q, sub]) => <button key={q} type="button" className="starter" onClick={() => send(q)}><b>{q}</b><small>{sub}</small></button>)}
          </div>
        </section>
      ) : (
        <div className="chat2__turns">
          {turns.map((t, i) => t.role === "user"
            ? <div key={`${chatId}-${i}`} className="msg msg--me"><div className="msg__bubble">{t.content}</div></div>
            : <AssistantTurn key={`${chatId}-${i}`} t={t} question={turns[i - 1]?.content ?? ""} last={i === turns.length - 1} busy={busy} chatId={chatId} onRetry={() => send(lastUser, true)} onFollow={(q) => send(q)} onPlans={() => setPlans(true)} />)}
          <div ref={endRef} className="chat2__end" />
        </div>
      )}

      {picking && acct?.models?.length ? <ModelSheet models={acct.models} current={model?.id} onClose={() => setPicking(false)} onPick={(id) => { chooseModel(id); setModelId(id); setPicking(false); haptic("select"); }} /> : null}
      {plans && acct ? <PlansSheet acct={acct} onClose={() => setPlans(false)} onPaid={() => { setPlans(false); void pollAccount(acct, setAcct); }} /> : null}
      {history ? <ChatsSheet current={chatId} onClose={() => setHistory(false)} onOpen={openChat} onDeleted={(id) => { if (id === conv.chatId) startNewChat(); }} /> : null}
      <form ref={formRef} className="composer2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="composer2__box">
          <textarea ref={boxRef} value={input} rows={1} placeholder={turns.length ? "Ask a follow-up" : "Ask CyberJudah"} aria-label="Your question" enterKeyHint="send" onChange={(e) => setInput(e.target.value)} onFocus={() => typing(true)} onBlur={() => typing(false)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
          {busy
            ? <button type="button" className="composer2__go composer2__go--stop" aria-label="Stop" onClick={stop}><span /></button>
            // Pressing Send keeps the focus in the question: a blur would bring the tab bar back and
            // move the composer under the finger before the tap ends, and the tap would be lost.
            : <button type="submit" className="composer2__go" aria-label="Send" disabled={!input.trim()} onPointerDown={(e) => e.preventDefault()}><Icon name="arrowUp" size={20} /></button>}
        </div>
        <p className="composer2__note">{model ? <><button type="button" className="composer2__model" aria-label={`Model: ${model.name}. Change`} onClick={() => setPicking(true)}>{model.name.replace(/^Claude /, "")}{model.free ? " · free" : ""}<span aria-hidden="true"> ▾</span></button> · </> : null}Answers can be wrong. Check them against the sources.</p>
      </form>
    </main>
  );
}

/**
 * The line while Ask works: a recovered answer says it is still coming; otherwise a line suited
 * to the question (lib/spinner.ts), a new one every few seconds. The research steps themselves
 * are listed above it as they happen.
 */
function Waiting({ question, status }: { question: string; status?: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 2800); return () => clearInterval(id); }, []);
  if (status === "Still answering") return <>Still answering…</>;
  return <>{spinnerLine(question, tick)}…</>;
}

/** Failures that need a sentence, not the troubleshooter. */
const PLAIN_ERRORS: Record<string, string> = {
  limit: "That is a hundred questions today. The count starts again tomorrow.",
  "too-short": "Ask a fuller question: a few words at least.",
  stopped: "Stopped here. The answer may still finish and be kept in Your chats.",
  refused: "CyberJudah can't answer that one. Ask about the Scripture, the teachings or the app.",
  busy: "CyberJudah's main model is busy right now, and the backup found nothing close enough to answer from. You were not charged. Try again in a moment.",
  empty: "No answer came back for that. Try asking it another way.",
  offline: "You are offline. Your question is kept; try again when you are connected.",
  network: "The connection dropped before the answer came. Try again.",
  interrupted: "This answer was interrupted before it was saved. Try again.",
  signin: "Open CyberJudah from Telegram to ask questions: your answers are saved to your Telegram account.",
  "browser-limit": "That is today's questions in this browser. They start again tomorrow, or open CyberJudah in Telegram to keep asking.",
  "no-device": "This browser could not be set up to ask just now. Try again in a minute.",
};

function AssistantTurn({ t, question, last, busy, chatId, onRetry, onFollow, onPlans }: { t: Turn; question: string; last: boolean; busy: boolean; chatId: string | null; onRetry: () => void; onFollow: (q: string) => void; onPlans: () => void }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const sources = t.sources ?? [];
  const lookup = sources.length ? sources : (t.passages ?? []);
  // Scripture named in the answer opens in the reader, as a reference does anywhere in the app.
  const slugs = useBookSlugs();
  const html = useMemo(() => linkRefsInHtml(answerHtml(t.content, lookup), slugs), [t.content, lookup, slugs]);
  const open = (s: Source) => { haptic("select"); navigate(passagePath(s)); };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const ref = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.reflink, a.applink");
    if (ref) { e.preventDefault(); haptic("select"); navigate(ref.getAttribute("href")!.replace(/&amp;/g, "&")); return; }
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-n]");
    const s = c && lookup.find((x) => x.n === Number(c.dataset.n));
    if (s) { e.preventDefault(); open(s); }
  };
  const copy = () => { void navigator.clipboard?.writeText(plain(t.content)).then(() => { haptic("success"); setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => undefined); };

  return (
    <div className="msg msg--ai">
      <div className="msg__who"><img className="msg__avatar" src={assetUrl("brand/cyber-lion.webp")} alt="" width={24} height={24} />CyberJudah</div>
      {t.steps?.length ? <Research steps={t.steps} live={!!t.thinking || (busy && last)} count={t.passages?.length ?? 0} /> : null}
      {t.thinking ? (
        <div className="msg__thinking" role="status"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span><Waiting question={question} status={t.status} /></div>
      ) : t.error === "consent" && t.consent && !t.content ? (
        <div className="paywall consent" role="group" aria-label="Your agreement">
          <b>Send your question to {t.consent.provider}?</b>
          <p>{t.consent.model} is run by {t.consent.provider}. To answer, CyberJudah sends it your question, the earlier questions in this chat, and passages from the library. {app ? "Your name and Telegram ID are not sent. Your chats are saved for you, encrypted, for 180 days unless you delete them." : "Nothing that identifies you is sent, and the conversation stays on this device."}</p>
          <div className="consent__actions">
            <button type="button" className="paywall__go" onClick={() => { agree(t.consent!.provider); haptic("success"); onRetry(); }}>Agree and ask</button>
            <a className="consent__more" href="/privacy" onClick={(e) => { e.preventDefault(); navigate("/privacy"); }}>Privacy policy</a>
          </div>
          <small>You can withdraw this at any time in Settings → Privacy. Choose another model to use a different provider.</small>
        </div>
      ) : t.error === "allowance" && !t.content ? (
        <div className="paywall">
          <b>You have used today's free answers</b>
          <p>Subscribe for a month of in-depth answers, or top up with Stars. Your free answers come back at {resetTime()}.</p>
          <button type="button" className="paywall__go" onClick={onPlans}>See the plans</button>
        </div>
      ) : t.error && !t.content ? (
        t.error in PLAIN_ERRORS ? (
          <div className="msg__error" role="alert">
            <p>{PLAIN_ERRORS[t.error]}</p>
            {t.error === "browser-limit" ? <OpenInTelegram className="msg__action" /> : null}
            {last && t.error !== "limit" && t.error !== "signin" && t.error !== "browser-limit" ? <button type="button" className="msg__action" onClick={onRetry}><Icon name="retry" size={16} />Try again</button> : null}
          </div>
        ) : <Trouble error={new ApiError(t.error === "session" ? 401 : Number(t.error?.split(":")[1]) || 503, "/api/ask", t.error === "session" ? "stale" : t.error)} what="ask" q={question} onRetry={last ? onRetry : undefined} />
      ) : (
        <>
          <div className="msg__text" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
          {t.actions?.length && !t.thinking ? (
            <div className="msg__actionsets">
              <p className="msg__label">Waiting for you</p>
              {t.actions.map((a) => <ActionCard key={a.id} action={a} chatId={chatId} />)}
            </div>
          ) : null}
          {sources.length ? (
            <div className="msg__sources">
              <p className="msg__label">Sources · {sources.length}</p>
              <div className="srcrail">
                {sources.map((s) => (
                  <button key={s.n} type="button" className="srccard" onClick={() => open(s)}>
                    <span className="srccard__top"><b className="cite">{s.n}</b><small>{passageLabel(s)}</small></span>
                    <span className="srccard__title">{s.title}</span>
                    {s.text ? <span className="srccard__text">{s.text}</span> : null}
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
          {t.limited ? <p className="msg__cut" role="status"><Icon name="info" size={14} />Today's in-depth answers are used, so this is a shorter answer from the library, at no charge. In-depth answers come back at {resetTime()}. <button type="button" className="msg__link" onClick={onPlans}>See the plans</button></p> : null}
          {t.backup ? <p className="msg__cut" role="status"><Icon name="info" size={14} />The main model was busy, so the backup model wrote this shorter answer. You were not charged for it. Retry for a full answer.</p> : null}
          {t.cut ? <p className="msg__cut" role="status"><Icon name="retry" size={14} />The answer was cut off before it finished.</p> : null}
          {!last || !busy ? (
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

/** An action's state, kept on the conversation so a reopened chat shows what was done. */
const markAction = (id: string, state: "applied" | "cancelled") => setConv((c) => ({ turns: c.turns.map((t) => (t.actions?.some((a) => a.id === id) ? { ...t, actions: t.actions.map((a) => (a.id === id ? { ...a, state } : a)) } : t)) }));

/**
 * A change Ask proposed, as a card: what it will do, and Confirm / Cancel. Nothing happens until
 * Confirm, which makes the change through the app's own reminder API with the reader's own
 * authority, and then shows what the server says the reminder now is. Ask never makes it.
 */
function ActionCard({ action, chatId }: { action: Action; chatId: string | null }) {
  const navigate = useNavigate();
  const content = useContent();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [result, setResult] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const record = (s: "applied" | "cancelled") => { markAction(action.id, s); if (chatId) void api(`/api/chats/${chatId}/actions/${action.id}`, { method: "POST", json: { state: s } }).catch(() => undefined); };
  const confirmIt = async () => {
    haptic("select"); setState("working"); setWhy("");
    try {
      // Telegram reminders need the bot allowed to write, which only the reader can grant.
      if (action.settings.channels?.telegram && !(await requestWriteAccess())) { setState("failed"); setWhy("Allow @CyberJudah_bot to message you first, then confirm again."); return; }
      const v = await saveReminder({ settings: { tz: timeZone(), ...action.settings }, ...(content ? { content } : {}) });
      const ch = v.channels.telegram && v.channels.push ? "by Telegram and push" : v.channels.push ? "by push" : v.channels.telegram ? "by Telegram" : "";
      setResult(v.on ? `Reminders are on, every day at ${timeLabel(v.hour, v.minute)}${ch ? ` ${ch}` : ""}${v.pausedUntil ? `, paused until ${v.pausedUntil === "9999-12-31" ? "you resume" : v.pausedUntil}` : ""}.` : "Reminders are off.");
      setState("idle"); haptic("success"); record("applied");
    } catch { setState("failed"); setWhy("That did not save. Check the connection and try again."); haptic("error"); }
  };
  const done = action.state === "applied", cancelled = action.state === "cancelled";
  return (
    <div className="actioncard" data-state={done ? "applied" : cancelled ? "cancelled" : state}>
      <div className="actioncard__what"><Icon name={done ? "check" : "bell"} size={18} /><span>{action.summary}</span></div>
      {done ? <p className="actioncard__note" role="status">{result ?? "Done. You confirmed this change."} <button type="button" className="linkish" onClick={() => navigate("/settings/reminders")}>Reading reminders</button></p>
        : cancelled ? <p className="actioncard__note">Cancelled. Nothing was changed.</p>
        : (
          <>
            <div className="actioncard__buttons">
              <button type="button" className="btn" disabled={state === "working" || !app} onClick={() => void confirmIt()}>{state === "working" ? "Saving…" : "Confirm"}</button>
              <button type="button" className="btn btn--quiet" disabled={state === "working"} onClick={() => { haptic("select"); record("cancelled"); }}>Cancel</button>
            </div>
            <p className="actioncard__note">{why || "Not done yet. It happens only if you confirm."}</p>
          </>
        )}
    </div>
  );
}

type Balance = { free: number; plan: number; planOn: boolean; planUntil: number | null; planAllowance: number; credits: number; total: number };
type AskModel = { id: string; name: string; provider: string; what: string; cost: number; free?: boolean };
type AskAccount = { browser?: boolean; browserDaily?: number; metered: boolean; unlimited: boolean; balance: Balance; perQuestion: number; freeDaily: number; plan: { stars: number; units: number }; packs: { stars: number; units: number }[]; models?: AskModel[]; model?: string };
const answers = (units: number, per: number) => Math.max(0, Math.floor(units / Math.max(per, 1)));
/** The line under Ask's title: how much is left, in answers, the way an AI app shows it. */
function meterLine(a: AskAccount | null, cost = 1): string {
  if (!a || !a.metered) return "Answers from the teachings";
  if (a.unlimited) return "Unlimited · admin";
  // A cheaper model makes the same allowance go further.
  const n = answers(a.balance.total, a.perQuestion * cost);
  if (a.balance.planOn) return `Monthly plan · about ${n} answers left`;
  if (!n) return `In-depth answers back at ${resetTime()} · plans`;
  return `About ${n} ${n === 1 ? "answer" : "answers"} left${a.balance.credits ? "" : " today"} · plans`;
}
/** How an answer on this model compares with one on Claude Opus 5, for the picker. */
const costLabel = (m: AskModel) => (m.free ? "Free" : m.cost >= 0.95 && m.cost <= 1.05 ? "×1" : m.cost < 0.1 ? `×${m.cost.toFixed(2)}` : `×${m.cost.toFixed(1)}`);
/**
 * The models a reader can answer with: the free one first, then every other by provider, with a
 * search; each with what it is, and how far the allowance goes on it next to Claude Opus 5.
 */
function ModelSheet({ models, current, onClose, onPick }: { models: AskModel[]; current?: string; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (m: AskModel) => words.every((w) => `${m.name} ${m.provider} ${m.id}`.toLowerCase().includes(w));
  const shown = models.filter(hit);
  const groups = [...new Set(shown.filter((m) => !m.free).map((m) => m.provider))];
  const row = (m: AskModel) => (
    <button key={m.id} type="button" role="radio" aria-checked={m.id === current} className={`models__row${m.id === current ? " is-on" : ""}`} onClick={() => onPick(m.id)}>
      <span><b>{m.name}</b><small>{m.what}</small></span>
      <span className={`models__cost${m.free ? " is-free" : ""}`} title="Cost of an answer next to Claude Opus 5">{costLabel(m)}</span>
      {m.id === current ? <Icon name="check" size={18} /> : null}
    </button>
  );
  return (
    <Sheet open onClose={onClose} height="full" title="Model" subTitle={`${models.length} models · charged at each model's own price`} className="chats-sheet">
      <div className="models" role="radiogroup" aria-label="Model">
        <input className="models__search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models or providers" aria-label="Search models" />
        {shown.filter((m) => m.free).map((m) => <div key="free" className="models__group"><h3>Free, always</h3>{row(m)}</div>)}
        {groups.map((g) => <div key={g} className="models__group"><h3>{g}</h3>{shown.filter((m) => !m.free && m.provider === g).map(row)}</div>)}
        {shown.length ? null : <p className="models__none">No model matches.</p>}
      </div>
    </Sheet>
  );
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
  // What is happening to one row: opening it, deleting it, or why that failed.
  const [row, setRow] = useState<{ id: string; state: "opening" | "deleting" | "failed"; why?: string } | null>(null);
  const load = () => { setFailed(false); void api<{ chats: ChatSummary[] }>("/api/chats").then((r) => setChats(r.chats ?? [])).catch(() => setFailed(true)); };
  useEffect(load, []);
  const open = async (c: ChatSummary) => {
    if (row?.state === "opening" || row?.state === "deleting") return;
    haptic("select"); setRow({ id: c.id, state: "opening" });
    try { const r = await api<{ chat: SavedChat | null; pending?: { q: string } | null }>(`/api/chats/${c.id}`); setRow(null); onOpen(r.chat ?? { id: c.id, title: c.title, updated: c.updated, turns: r.pending ? [{ role: "user", content: r.pending.q }] : [] }); }
    catch (e) {
      // Gone from the server (deleted on another device): it leaves the list too.
      if (e instanceof ApiError && e.status === 404) { setChats((cs) => (cs ?? []).filter((x) => x.id !== c.id)); setRow(null); return; }
      setRow({ id: c.id, state: "failed", why: "This chat could not be opened. Check the connection and try again." });
    }
  };
  const remove = async (c: ChatSummary) => {
    if (!(await confirm(`Delete "${c.title}"?`))) return;
    setRow({ id: c.id, state: "deleting" });
    try {
      const r = await api<{ ok: boolean }>(`/api/chats/${c.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("not deleted");
      haptic("success"); setRow(null); setChats((cs) => (cs ?? []).filter((x) => x.id !== c.id)); onDeleted(c.id);
    } catch { haptic("error"); setRow({ id: c.id, state: "failed", why: "This chat was not deleted. Check the connection and try again." }); }
  };
  return (
    <Sheet open onClose={onClose} height="full" title="Your chats" subTitle="Saved to your account" className="chats-sheet">
      <div className="chats" aria-busy={!chats && !failed}>
        {failed ? (
          <div className="chats__state" role="alert"><p className="hint">Your chats could not be loaded. Check the connection and try again.</p><button type="button" className="msg__action" onClick={load}><Icon name="retry" size={16} />Try again</button></div>
        ) : !chats ? <p className="hint">Loading your chats…</p>
          : !chats.length ? <p className="hint">No chats yet. Every question you ask is saved here with its answer.</p>
          : chats.map((c) => (
            <div key={c.id} className="chats__item">
              <div className="chats__row" data-current={c.id === current ? "" : undefined} aria-busy={row?.id === c.id && row.state !== "failed"}>
                <button type="button" className="chats__open" onClick={() => void open(c)}><b>{c.title}</b><small>{row?.id === c.id && row.state === "opening" ? "Opening…" : row?.id === c.id && row.state === "deleting" ? "Deleting…" : `${when(c.updated)} · ${c.count} ${c.count === 1 ? "question" : "questions"}`}</small></button>
                <button type="button" className="chats__del" aria-label={`Delete ${c.title}`} disabled={row?.id === c.id && row.state === "deleting"} onClick={() => void remove(c)}><Icon name="trash" size={18} /></button>
              </div>
              {row?.id === c.id && row.state === "failed" ? <p className="chats__why" role="alert">{row.why}</p> : null}
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
  const searches = steps.filter((s) => s.startsWith("Searching")).length, readings = steps.filter((s) => s.startsWith("Reading")).length, lookups = steps.filter((s) => s.startsWith("Looking")).length;
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k > 1 ? many : one}` : "");
  const summary = live ? steps[steps.length - 1] : [n(searches, "search", "searches"), n(readings, "reading", "readings"), n(lookups, "look-up in the app", "look-ups in the app"), count ? `${count} sources` : ""].filter(Boolean).join(" · ");
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
  const html = safeLinks(marked.parse(marked_, { gfm: true, breaks: false, async: false }) as string);
  return html.replace(/ ?CJCITE(\d{1,2})CJ/g, (_m, n: string) => `<button type="button" class="cite" data-n="${n}" aria-label="Source ${n}">${n}</button>`);
}
