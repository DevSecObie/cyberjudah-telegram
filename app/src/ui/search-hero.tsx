import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { api, haptic, hideKeyboard } from "@/tg/sdk";
import { toAppPath } from "@shared/links.mjs";
import { Icon } from "./ui";

/**
 * The search that fronts the library. The field rotates prompts while it is empty (after
 * Aceternity's "placeholders and vanish" input) and, as soon as a few letters are typed,
 * lists the teachings that match, grouped and with the words lit (after 21st.dev's
 * command palette). Enter, or "See all", opens the full results.
 */
export type Hit = { kind: string; title: string; url: string; sub: string; snippet: string; loose?: boolean };
export type SearchResult = { ok: true; q: string; mode: "strict" | "loose" | "mixed"; counts: Record<string, number>; hits: Hit[] } | { ok: false; reason: string };
export const KIND_LABEL: Record<string, string> = { class: "Sabbath classes", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "Study notes", law: "Laws", precept: "Precepts", case: "Case studies", encyclopedia: "Encyclopedia", verse: "Scripture", web: "Approved source" };
/** Teaching first: what was taught, then the law, then the text itself. */
export const KIND_ORDER = ["class", "captains", "history", "study", "law", "precept", "case", "encyclopedia", "verse"];
export const PROMPTS = ["Passover", "Seattle", "Matthew 15:24", "the lost sheep", "\"most high\"", "usury", "Melchizedek"];
export const ASK_PROMPTS = ["Why do we keep the Passover?", "Who are the twelve tribes today?", "What does the law say about usury?", "How is the Sabbath kept?", "Who was Melchizedek?", "What was taught about honouring parents?"];
export type TeachingHit = { title: string; matchedTitle: string; excerpt: string; feed: string; date: string; video: string; start: number; note: string; timing: "caption" | "passage" };
export type TeachingsResult = { ok: true; q: string; feed: string; page: number; hits: TeachingHit[]; more: boolean } | { ok: false; reason: string };
export const FEED_NAME: Record<string, string> = { classes: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History" };
/** A spoken hit opens the class notes at that moment when there are notes, else the recording itself. */
export const teachingPath = (h: { video: string; start: number; note?: string }) => h.note ? `/note${h.note}?t=${Math.round(h.start)}&video=${encodeURIComponent(h.video)}` : `/watch/${encodeURIComponent(h.video)}?t=${Math.round(h.start)}`;
/** The site's /teachings search: words together, or a quoted phrase, over every recording's passages. */
export function useTeachingsSearch(q: string, feed = "", page = 0, enabled = true) {
  return useQuery({ queryKey: ["teachings", q, feed, page], enabled: enabled && q.trim().length >= 2, queryFn: () => api<TeachingsResult>(`/api/teachings?q=${encodeURIComponent(q.trim())}&feed=${encodeURIComponent(feed)}&page=${page}`), staleTime: 60_000 });
}
/** The site marks matches with U+E000 … U+E001; render them as <mark>. */
export function Marked({ text }: { text: string }) {
  return <>{text.split(/(\uE000[^\uE000\uE001]*\uE001)/g).filter(Boolean).map((part, i) => part.startsWith("\uE000") ? <mark key={i}>{part.slice(1, -1)}</mark> : part)}</>;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A hit's link: a class section by its heading, a verse by its number. */
export const hitPath = (h: Hit) => { const base = toAppPath(h.url) ?? h.url; return h.sub && /^\/(classes|captains|history|study)\//.test(h.url) ? `${base}#${slug(h.sub)}` : base; };


const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The needle lit in the text: the whole phrase where it appears as typed, else each word. */
export function Lit({ text, needle, phrase }: { text: string; needle: string; phrase?: boolean }) {
  const words = needle.replace(/"/g, "").split(/[^\p{L}\p{N}']+/u).filter((w) => w.length > (phrase ? 0 : 1));
  if (!words.length) return <>{text}</>;
  const whole = phrase ? new RegExp(`(${words.map(esc).join("[^\\p{L}\\p{N}]+")})`, "iu") : null;
  const re = whole && whole.test(text) ? new RegExp(whole.source, "igu") : new RegExp(`(${words.map(esc).join("|")})`, "ig");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

/** The search field, or in ask mode the question field: same box, the prompts and the button change. */
export function SearchHero({ value, onChange, onSubmit, autoFocus, big, mode = "search", children }: { value: string; onChange: (v: string) => void; onSubmit: (q: string) => void; autoFocus?: boolean; big?: boolean; mode?: "search" | "ask"; children?: ReactNode }) {
  const [i, setI] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const ask = mode === "ask";
  const prompts = ask ? ASK_PROMPTS : PROMPTS;
  useEffect(() => { if (value) return; const t = setInterval(() => setI((n) => (n + 1) % prompts.length), 3000); return () => clearInterval(t); }, [value, prompts.length]);
  return (
    <form className={`shero${big ? " shero--big" : ""}`} data-focus={focused ? "" : undefined} data-mode={ask ? "ask" : undefined} role="search" onSubmit={(e) => { e.preventDefault(); hideKeyboard(); onSubmit(value); }}>
      <div className="shero__field">
        <Icon name={ask ? "note" : "search"} size={20} />
        <input ref={inputRef} id="q" type="search" enterKeyHint={ask ? "send" : "search"} autoComplete="off" autoCorrect="off" spellCheck={false} value={value} autoFocus={autoFocus} aria-label={ask ? "Ask CyberJudah" : "Search the teachings"} placeholder=" "
          onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        {!value ? <span className="shero__prompts" aria-hidden="true">{prompts.map((p, k) => <span key={p} className="shero__prompt" data-on={k === i % prompts.length ? "" : undefined}>{p}</span>)}</span> : null}
        {value ? <button type="button" className="shero__clear" aria-label="Clear" title="Clear" onClick={() => { onChange(""); inputRef.current?.focus(); }}>×</button> : null}
        <button type="submit" className="shero__go" aria-label={ask ? "Ask" : "Search"} title={ask ? "Ask" : "Search"} disabled={!value.trim()}><Icon name="chevron" size={18} /></button>
      </div>
      {children}
    </form>
  );
}
