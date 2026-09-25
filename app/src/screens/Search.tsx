import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { useRecentSearches } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { api, features, readClipboard, scanQr } from "@/tg/sdk";
import { Chip, Chips, Empty, Icon, List, Row, Screen, SearchField, Section, Skeleton, useGo } from "@/ui/ui";

type Hit = { kind: string; title: string; url: string; sub: string; snippet: string; loose?: boolean };
type Result = { ok: true; q: string; mode: "strict" | "loose" | "mixed"; counts: Record<string, number>; hits: Hit[] } | { ok: false; reason: string };

const KIND_LABEL: Record<string, string> = { verse: "Scripture", law: "Laws", precept: "Precepts", case: "Case studies", study: "Study notes", class: "Sabbath classes", captains: "15 Min w/ Captains", history: "Our Hidden History", encyclopedia: "Encyclopedia" };
const KIND_ORDER = ["verse", "class", "captains", "history", "study", "law", "precept", "case", "encyclopedia"];
const EXAMPLES = ["Passover", "Sabbath", "Melchizedek", "usury", "Ezekiel 37", "\"seventh day\"", "the twelve tribes"];

/** "john 3:16", "1 kings 8", "ps 23" -> a reader path, so a reference typed in search opens the chapter. */
const BOOKS: Record<string, string> = { gen: "genesis", ex: "exodus", exo: "exodus", lev: "leviticus", num: "numbers", deut: "deuteronomy", deu: "deuteronomy", josh: "joshua", judg: "judges", jdg: "judges", ruth: "ruth", "1 sam": "1-samuel", "2 sam": "2-samuel", "1 kgs": "1-kings", "1 ki": "1-kings", "2 kgs": "2-kings", "2 ki": "2-kings", "1 chr": "1-chronicles", "2 chr": "2-chronicles", ezra: "ezra", neh: "nehemiah", esth: "esther", job: "job", ps: "psalms", psa: "psalms", psalm: "psalms", prov: "proverbs", pr: "proverbs", eccl: "ecclesiastes", ecc: "ecclesiastes", song: "song-of-solomon", isa: "isaiah", jer: "jeremiah", lam: "lamentations", ezek: "ezekiel", eze: "ezekiel", dan: "daniel", hos: "hosea", joel: "joel", amos: "amos", obad: "obadiah", jon: "jonah", mic: "micah", nah: "nahum", hab: "habakkuk", zeph: "zephaniah", hag: "haggai", zech: "zechariah", mal: "malachi", matt: "matthew", mt: "matthew", mk: "mark", lk: "luke", jn: "john", acts: "acts", rom: "romans", "1 cor": "1-corinthians", "2 cor": "2-corinthians", gal: "galatians", eph: "ephesians", phil: "philippians", col: "colossians", "1 thess": "1-thessalonians", "2 thess": "2-thessalonians", "1 tim": "1-timothy", "2 tim": "2-timothy", tit: "titus", phlm: "philemon", heb: "hebrews", jas: "james", "1 pet": "1-peter", "2 pet": "2-peter", "1 jn": "1-john", "2 jn": "2-john", "3 jn": "3-john", jude: "jude", rev: "revelation", tob: "tobit", jdt: "judith", wis: "wisdom", sir: "sirach", bar: "baruch", "1 macc": "1-maccabees", "2 macc": "2-maccabees", "1 esd": "1-esdras", "2 esd": "2-esdras" };
export function referencePath(q: string): string | null {
  const m = /^\s*((?:[1-3]\s*)?[a-z][a-z .]*?)\s*(\d{1,3})(?::(\d{1,3}(?:\s*-\s*\d{1,3})?))?\s*$/i.exec(q);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const slug = BOOKS[name] ?? (/^[a-z]{3,}( [a-z]+)*$/.test(name) ? name.replace(/^(\d) /, "$1-").replace(/ /g, "-") : null);
  if (!slug) return null;
  const v = m[3]?.replace(/\s/g, "");
  return `/bible/${slug}/${m[2]}${v ? `?v=${v}` : ""}`;
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "", only = params.get("only") ?? undefined;
  const go = useGo();
  const [input, setInput] = useState(q);
  const [recent, setRecent] = useRecentSearches();
  useEffect(() => { setInput(q); }, [q]);
  useBackButton(!q, () => { if (q) { setParams({}, { replace: true }); return true; } });
  const set = (next: Record<string, string | undefined>, replace = false) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q, only, ...next })) if (v) p.set(k, v);
    setParams(p, { replace });
  };
  const submit = (text = input) => {
    const t = text.trim(); if (!t) return;
    const ref = referencePath(t);
    if (ref) { go(ref); return; }
    setRecent([t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
    set({ q: t, only: undefined });
  };
  // A QR code on a flyer, or a link on the clipboard, opens straight to the page.
  const scan = async () => { const text = await scanQr("Scan a CyberJudah link"); if (text) openText(text); };
  const paste = async () => { const text = await readClipboard(); if (text) { setInput(text); submit(text); } };
  const openText = (text: string) => { try { const u = new URL(text); if (/cyberjudah\.io$/.test(u.hostname)) { go(u.pathname + u.search + u.hash); return; } } catch { /* not a link */ } setInput(text); submit(text); };

  return (
    <Screen title="Search" action={features.qr ? <button type="button" className="icon-btn" aria-label="Scan a QR code" onClick={scan}><Icon name="qr" size={20} /></button> : undefined}>
      <SearchField id="q" value={input} onChange={(v) => { setInput(v); if (!v) set({ q: undefined, only: undefined }, true); }} onSubmit={() => submit()} placeholder="Scripture, classes, law…" autoFocus={!q}
        trailing={features.clipboard ? <button type="button" className="field__clear" aria-label="Paste" onClick={paste}><Icon name="copy" size={14} /></button> : undefined} />
      {!q ? (
        <>
          {recent.length ? <Section title="Recent" action={<button type="button" className="link" onClick={() => setRecent([])}>Clear</button>}><List>{recent.map((r) => <Row key={r} onClick={() => { setInput(r); submit(r); }} title={r} trailing={<span className="row__chev"><Icon name="clock" size={16} /></span>} />)}</List></Section> : null}
          <Section title="Try"><Chips>{EXAMPLES.map((e) => <Chip key={e} onClick={() => { setInput(e); submit(e); }}>{e}</Chip>)}</Chips></Section>
          <p className="hint">Every verse, class, study note, law, precept and case. A reference like <b>John 3:16</b> opens the chapter; quote a phrase for an exact match.</p>
        </>
      ) : <Results q={q} only={only} onOnly={(k) => set({ only: k })} />}
    </Screen>
  );
}

function Results({ q, only, onOnly }: { q: string; only?: string; onOnly: (k?: string) => void }) {
  const res = useQuery({ queryKey: ["search", q, only ?? ""], queryFn: () => api<Result>(`/api/search?q=${encodeURIComponent(q)}${only ? `&only=${only}` : ""}&limit=${only ? 200 : 6}`) });
  if (res.isPending) return <Skeleton rows={7} />;
  const r = res.data;
  if (!r || !r.ok) return <Empty title="Search is not answering right now">Check your connection and try again.</Empty>;
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (!r.hits.length) return <Empty title={`Nothing found for “${q}”`}>Try fewer words, or another spelling.</Empty>;
  const kinds = KIND_ORDER.filter((k) => r.counts[k] || r.hits.some((h) => h.kind === k));
  return (
    <>
      <Chips><Chip on={!only} onClick={() => onOnly(undefined)}>All {total}</Chip>{kinds.map((k) => <Chip key={k} on={only === k} onClick={() => onOnly(only === k ? undefined : k)}>{KIND_LABEL[k] ?? k} {r.counts[k] ?? ""}</Chip>)}</Chips>
      {r.mode !== "strict" ? <p className="hint">Few exact matches, so results with any of the words are included.</p> : null}
      {(only ? [only] : kinds).map((k) => {
        const hits = r.hits.filter((h) => h.kind === k); if (!hits.length) return null;
        const more = (r.counts[k] ?? 0) - hits.length;
        return <Section key={k} title={KIND_LABEL[k] ?? k}><List>{hits.map((h) => <Row key={h.url} href={h.url} meta={h.sub || undefined} title={h.title} sub={h.snippet} />)}{!only && more > 0 ? <button type="button" className="more-btn" onClick={() => onOnly(k)}>Show {more} more</button> : null}</List></Section>;
      })}
    </>
  );
}
