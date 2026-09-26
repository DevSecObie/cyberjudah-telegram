import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, haptic } from "@/tg/sdk";
import { Button, Chip, Chips, Empty, Icon, List, Row, Screen, Section, timestamp } from "@/ui/ui";
import { KIND_LABEL, hitPath, SearchHero, teachingPath } from "@/ui/search-hero";
import { KIND_NAME } from "./Home";

export type Passage = { kind: string; title: string; url: string; sub?: string; video?: string; t?: number; date?: string; text: string };
export type Answer = { ok: true; q: string; answer: string; sources: (Passage & { n: number })[] } | { ok: false; reason: string };
const EXAMPLES = ["Why do we keep the Passover?", "What does the law say about usury?", "Who are the twelve tribes today?", "What was taught about honouring parents?", "How is the Sabbath kept?"];

/** Where a cited passage opens: the class at its moment, the note at its section, the verse. */
export const passagePath = (p: Passage) => p.video ? teachingPath({ video: p.video, start: p.t ?? 0, note: p.url }) : hitPath({ kind: p.kind, title: p.title, url: p.url, sub: p.sub ?? "", snippet: "" });
export const passageLabel = (p: Passage) => p.video ? `${KIND_NAME[p.sub as keyof typeof KIND_NAME] ?? "Recording"}${p.date ? ` · ${fmtDate(p.date)}` : ""} · ${timestamp(p.t ?? 0)}` : `${KIND_LABEL[p.kind] ?? p.kind}${p.sub ? ` · ${p.sub}` : ""}`;

/**
 * Ask the teachings: a question answered from the closest passages of the library and the
 * transcripts only, every claim cited, every citation a tap into its source.
 */
export function Ask() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  useBackButton(false);
  useBottomButtons(null, null);
  const m = useMutation({ mutationFn: (question: string) => api<Answer>("/api/ask", { method: "POST", json: { q: question } }).catch((e: Error) => ({ ok: false as const, reason: /429/.test(e.message) ? "limit" : "unavailable" })) });
  const submit = (text: string) => { const t = text.trim(); if (!t) return; haptic("select"); setParams({ q: t }, { replace: true }); m.mutate(t); };
  useEffect(() => { if (q) m.mutate(q); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const r = m.data;
  return (
    <Screen kicker="Ask the teachings" title="What was taught?">
      <SearchHero value={input} onChange={setInput} onSubmit={submit} autoFocus={!q} />
      {m.isPending ? <div className="answer answer--thinking"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span>Reading the teachings…</div> : null}
      {r && !r.ok ? <Empty title={r.reason === "limit" ? "That is forty questions today" : r.reason === "too-short" ? "Ask a fuller question" : "The teachings did not answer"}>{r.reason === "limit" ? "The count starts again tomorrow. Search the teachings meanwhile." : "Try again in a moment."}</Empty> : null}
      {r?.ok ? (
        <>
          <div className="answer"><AnswerText text={r.answer} sources={r.sources} /></div>
          {r.sources.length ? (
            <Section title="From">
              <List>{r.sources.map((s) => <Row key={s.n} href={passagePath(s)} meta={<><b className="answer__n">{s.n}</b> {passageLabel(s)}</>} title={s.title} sub={s.text.slice(0, 160)} />)}</List>
            </Section>
          ) : null}
          <p className="hint">Answered from these passages only, not from the model's own knowledge. Read the sources; the teaching is theirs.</p>
          <Button mode="bezeled" size="m" stretched onClick={() => { setInput(""); setParams({}, { replace: true }); m.reset(); }}>Ask another</Button>
        </>
      ) : !m.isPending ? (
        <>
          <p className="hint hint--lede">A question, answered from what was taught: the classes, the Captains, the notes, the law, the cases and the Scripture, with every claim pointing at its source.</p>
          <Section title="Try"><Chips>{EXAMPLES.map((e) => <Chip key={e} onClick={() => { setInput(e); submit(e); }}>{e}</Chip>)}</Chips></Section>
        </>
      ) : null}
    </Screen>
  );
}

/** The answer with its [n] citations as chips that open the passage. */
function AnswerText({ text, sources }: { text: string; sources: (Passage & { n: number })[] }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
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
