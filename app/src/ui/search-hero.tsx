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
export const KIND_LABEL: Record<string, string> = { class: "Sabbath classes", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "Study notes", law: "Laws", precept: "Precepts", case: "Case studies", encyclopedia: "Encyclopedia", verse: "Scripture" };
/** Teaching first: what was taught, then the law, then the text itself. */
export const KIND_ORDER = ["class", "captains", "history", "study", "law", "precept", "case", "encyclopedia", "verse"];
export const PROMPTS = ["What was taught on the Passover?", "Who was Melchizedek?", "Deuteronomy 28", "the Sabbath", "usury", "\"the twelve tribes\"", "Isaiah 58", "why we keep the feasts"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** A hit's link: a class section by its heading, a verse by its number. */
export const hitPath = (h: Hit) => { const base = toAppPath(h.url) ?? h.url; return h.sub && /^\/(classes|captains|history|study)\//.test(h.url) ? `${base}#${slug(h.sub)}` : base; };

export function useLiveSearch(q: string, limit = 3) {
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 220); return () => clearTimeout(t); }, [q]);
  const enabled = debounced.length >= 2;
  const res = useQuery({ queryKey: ["live", debounced, limit], enabled, queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(debounced)}&limit=${limit}`), staleTime: 60_000 });
  return { q: debounced, enabled, ...res };
}

export function Lit({ text, needle }: { text: string; needle: string }) {
  const words = needle.replace(/"/g, "").split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}

export function SearchHero({ value, onChange, onSubmit, autoFocus, big, children }: { value: string; onChange: (v: string) => void; onSubmit: (q: string) => void; autoFocus?: boolean; big?: boolean; children?: ReactNode }) {
  const [i, setI] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (value) return; const t = setInterval(() => setI((n) => (n + 1) % PROMPTS.length), 3000); return () => clearInterval(t); }, [value]);
  return (
    <form className={`hero${big ? " hero--big" : ""}`} data-focus={focused ? "" : undefined} role="search" onSubmit={(e) => { e.preventDefault(); hideKeyboard(); onSubmit(value); }}>
      <div className="hero__glow" aria-hidden="true" />
      <div className="hero__field">
        <Icon name="search" size={20} />
        <input ref={inputRef} id="q" type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={value} autoFocus={autoFocus} aria-label="Search the teachings" placeholder=" "
          onChange={(e) => onChange(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        {!value ? <span className="hero__prompts" aria-hidden="true">{PROMPTS.map((p, k) => <span key={p} className="hero__prompt" data-on={k === i ? "" : undefined}>{p}</span>)}</span> : null}
        {value ? <button type="button" className="hero__clear" aria-label="Clear" onClick={() => { onChange(""); inputRef.current?.focus(); }}>×</button> : null}
        <button type="submit" className="hero__go" aria-label="Search" disabled={!value.trim()}><Icon name="chevron" size={18} /></button>
      </div>
      {children}
    </form>
  );
}

/** The live list under the field: up to three hits per kind, teaching first. */
export function LiveResults({ q, onOpen, onAll }: { q: string; onOpen?: () => void; onAll: (q: string) => void }) {
  const live = useLiveSearch(q);
  if (!live.enabled) return null;
  const r = live.data;
  if (live.isPending) return <div className="live"><p className="live__hint">Searching…</p></div>;
  if (!r || !r.ok || !r.hits.length) return <div className="live"><p className="live__hint">Nothing yet for “{live.q}”. Press Enter to search every word.</p></div>;
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  const kinds = KIND_ORDER.filter((k) => r.hits.some((h) => h.kind === k));
  return (
    <div className="live" role="listbox" aria-label="Results as you type">
      {kinds.map((k) => (
        <div key={k} className="live__group">
          <p className="live__label">{KIND_LABEL[k] ?? k}{r.counts[k] ? <span> {r.counts[k]}</span> : null}</p>
          {r.hits.filter((h) => h.kind === k).slice(0, k === "verse" ? 2 : 3).map((h) => (
            <Link key={h.url + h.sub} to={hitPath(h)} className="live__row" role="option" onClick={() => { haptic("select"); onOpen?.(); }}>
              <span className="live__title"><Lit text={h.title} needle={live.q} />{h.sub ? <small> · {h.sub}</small> : null}</span>
              {h.snippet ? <span className="live__snip"><Lit text={h.snippet} needle={live.q} /></span> : null}
            </Link>
          ))}
        </div>
      ))}
      <button type="button" className="live__all" onClick={() => onAll(live.q)}>See all {total} results <Icon name="chevron" size={14} /></button>
    </div>
  );
}
