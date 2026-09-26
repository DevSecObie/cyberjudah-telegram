import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { useRecentSearches } from "@/lib/marks";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, features, readClipboard, scanQr } from "@/tg/sdk";
import { Button, Chip, Chips, Empty, Icon, List, Row, Screen, Section, Segmented, Skeleton, timestamp, useGo } from "@/ui/ui";
import { fmtDate } from "@/api/data";
import { KIND_NAME } from "./Home";
import { hitPath, KIND_LABEL, KIND_ORDER, Lit, LiveResults, SearchHero, transcriptPath, useTranscriptSearch, type SearchResult, type TranscriptHit } from "@/ui/search-hero";

const EXAMPLES = ["Passover", "Sabbath", "Melchizedek", "usury", "Ezekiel 37", "\"seventh day\"", "the twelve tribes"];
const SPOKEN_EXAMPLES = ["Matthew 15:24", "the lost sheep", "Deuteronomy 28", "Most High", "so-called", "Shabbat shalom"];
const TEACHING = new Set(["class", "captains", "history", "study"]);

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

/**
 * Search the teachings: results as you type, and on Enter the full results, the classes,
 * episodes and notes first, scripture folded at the end unless the query is a reference.
 */
export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "", only = params.get("only") ?? undefined;
  const where = params.get("in") === "transcripts" ? "transcripts" : "teachings";
  const go = useGo();
  const [input, setInput] = useState(q);
  const [recent, setRecent] = useRecentSearches();
  useEffect(() => { setInput(q); }, [q]);
  useBackButton(!q, () => { if (q) { setParams({}, { replace: true }); return true; } });
  useBottomButtons(null, null);
  const set = (next: Record<string, string | undefined>, replace = false) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q, only, in: where === "transcripts" ? "transcripts" : undefined, ...next })) if (v) p.set(k, v);
    setParams(p, { replace });
  };
  const submit = (text = input) => {
    const t = text.trim(); if (!t) return;
    const ref = where === "teachings" ? referencePath(t) : null;
    if (ref) { go(ref); return; }
    setRecent([t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
    set({ q: t, only: undefined });
  };
  const scan = async () => { const text = await scanQr("Scan a CyberJudah link"); if (text) openText(text); };
  const paste = async () => { const text = await readClipboard(); if (text) { setInput(text); submit(text); } };
  const openText = (text: string) => { try { const u = new URL(text); if (/cyberjudah\.io$/.test(u.hostname)) { go(u.pathname + u.search + u.hash); return; } } catch { /* not a link */ } setInput(text); submit(text); };
  const typing = input.trim() !== q;

  return (
    <Screen kicker="The teaching library" title="Search teachings" action={<span className="head__actions">{features.clipboard ? <button type="button" className="icon-btn" aria-label="Paste" onClick={paste}><Icon name="copy" size={18} /></button> : null}{features.qr ? <button type="button" className="icon-btn" aria-label="Scan a QR code" onClick={scan}><Icon name="qr" size={20} /></button> : null}</span>}>
      <Segmented label="Where" value={where} onChange={(w) => set({ in: w === "transcripts" ? "transcripts" : undefined }, true)} options={[["teachings", "Teachings"], ["transcripts", "Spoken, word for word"]]} />
      <SearchHero value={input} onChange={setInput} onSubmit={submit} autoFocus={!q}>
        {typing && where === "teachings" ? <LiveResults q={input} onAll={submit} onSpoken={(t) => { setInput(t); set({ q: t, only: undefined, in: "transcripts" }); }} /> : null}
      </SearchHero>
      {where === "transcripts" ? (q && !typing ? <Spoken q={q} /> : (
        <>
          <p className="hint">Every recording's captions, searched for <b>exactly</b> what you type: the words in that order, side by side. A hit opens the class notes at that moment, or the recording where the words were said. A Scripture like <b>Matthew 15:24</b> finds where it was read.</p>
          <Section title="Try"><Chips>{SPOKEN_EXAMPLES.map((e) => <Chip key={e} onClick={() => { setInput(e); submit(e); }}>{e}</Chip>)}</Chips></Section>
        </>
      )) : !q ? (
        <>
          <p className="hint hint--lede">Find a Scripture. Open the recording where it was spoken. Read the class notes alongside it.</p>
          {recent.length ? <Section title="Recent" action={<button type="button" className="link" onClick={() => setRecent([])}>Clear</button>}><List>{recent.map((r) => <Row key={r} onClick={() => { setInput(r); submit(r); }} title={r} trailing={<span className="row__chev"><Icon name="clock" size={16} /></span>} />)}</List></Section> : null}
          <Section title="Try"><Chips>{EXAMPLES.map((e) => <Chip key={e} onClick={() => { setInput(e); submit(e); }}>{e}</Chip>)}</Chips></Section>
          <p className="hint">Every class, episode, study note, law, precept and case, and every verse. A reference like <b>Matthew 15:24</b> opens the chapter; quote a phrase for an exact match.</p>
        </>
      ) : !typing ? <Results q={q} only={only} onOnly={(k) => set({ only: k })} /> : null}
    </Screen>
  );
}

function Results({ q, only, onOnly }: { q: string; only?: string; onOnly: (k?: string) => void }) {
  const res = useQuery({ queryKey: ["search", q, only ?? ""], queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(q)}${only ? `&only=${only}` : ""}&limit=${only ? 200 : 6}`) });
  const [verses, setVerses] = useState(false);
  if (res.isPending) return <Skeleton rows={7} />;
  const r = res.data;
  if (!r || !r.ok) return <Empty title="Search is not answering right now">Check your connection and try again.</Empty>;
  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (!r.hits.length) return <Empty title={`Nothing found for “${q}”`}>Try fewer words, or another spelling.</Empty>;
  const kinds = KIND_ORDER.filter((k) => r.counts[k] || r.hits.some((h) => h.kind === k));
  const taught = kinds.filter((k) => TEACHING.has(k)).reduce((n, k) => n + (r.counts[k] ?? 0), 0);
  return (
    <>
      <p className="hint">{taught ? <><b>{taught}</b> teaching{taught === 1 ? "" : "s"} and </> : null}{total} results{r.mode !== "strict" ? ", with any of the words where exact matches were few" : ""}.</p>
      <Chips><Chip on={!only} onClick={() => onOnly(undefined)}>All</Chip>{kinds.map((k) => <Chip key={k} on={only === k} onClick={() => onOnly(only === k ? undefined : k)}>{KIND_LABEL[k] ?? k} {r.counts[k] ?? ""}</Chip>)}</Chips>
      {(only ? [only] : kinds).map((k) => {
        const hits = r.hits.filter((h) => h.kind === k); if (!hits.length) return null;
        const more = (r.counts[k] ?? 0) - hits.length;
        if (k === "verse" && !only && !verses) return <button key={k} type="button" className="fold" onClick={() => setVerses(true)}><Icon name="book" size={16} /> Show {r.counts.verse ?? hits.length} verses that say this</button>;
        return (
          <Section key={k} title={KIND_LABEL[k] ?? k}>
            <List>
              {hits.map((h) => <Row key={h.url + h.sub} href={hitPath(h)} meta={h.sub || undefined} title={<Lit text={h.title} needle={q} />} sub={<Lit text={h.snippet} needle={q} />} />)}
              {!only && more > 0 ? <button type="button" className="more-btn" onClick={() => onOnly(k)}>Show {more} more</button> : null}
            </List>
          </Section>
        );
      })}
    </>
  );
}

/** The exact hits, newest recording first, each with the second it was said. */
function Spoken({ q }: { q: string }) {
  const [pages, setPages] = useState(1);
  const PAGE = 20;
  const first = useTranscriptSearch(q, PAGE, 0);
  if (first.isPending) return <Skeleton rows={6} />;
  const r = first.data;
  if (!r || !r.ok) return <Empty title="The transcripts are not answering right now">Check your connection and try again.</Empty>;
  if (!r.total) return <Empty title={`“${q}” was not said in any recording`}>Word for word, that is. Try fewer words, or search the teachings instead.</Empty>;
  return (
    <>
      <p className="hint">Said in <b>{r.recordings}</b> recording{r.recordings === 1 ? "" : "s"}{r.total > r.recordings ? `, ${r.total} times` : ""}. Newest first.</p>
      <List>
        {r.hits.map((h) => <SpokenRow key={`${h.video}-${h.t}`} h={h} q={q} />)}
        {Array.from({ length: pages - 1 }, (_, i) => <SpokenPage key={i} q={q} offset={(i + 1) * PAGE} limit={PAGE} />)}
      </List>
      {r.hits.length >= PAGE && pages * PAGE < r.total ? <Button mode="bezeled" size="m" stretched onClick={() => setPages(pages + 1)}>Show more</Button> : null}
    </>
  );
}
function SpokenPage({ q, offset, limit }: { q: string; offset: number; limit: number }) {
  const res = useTranscriptSearch(q, limit, offset);
  if (!res.data?.ok) return null;
  return <>{res.data.hits.map((h) => <SpokenRow key={`${h.video}-${h.t}`} h={h} q={q} />)}</>;
}
function SpokenRow({ h, q }: { h: TranscriptHit; q: string }) {
  return <Row href={transcriptPath(h)} meta={<>{KIND_NAME[h.kind as keyof typeof KIND_NAME] ?? h.kind}{h.date ? ` · ${fmtDate(h.date)}` : ""} · <b className="tx__at">{timestamp(h.t)}</b></>} title={h.title} sub={<Lit text={h.snippet} needle={q} phrase />} />;
}
