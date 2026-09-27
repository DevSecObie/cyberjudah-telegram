import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { useRecentSearches } from "@/lib/marks";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { Button, Chip, Chips, Empty, Icon, Img, List, Row, Screen, Section, Skeleton, timestamp } from "@/ui/ui";
import { fmtDate } from "@/api/data";
import { FEED_NAME, Marked, SearchHero, teachingPath, useTeachingsSearch, type TeachingHit } from "@/ui/search-hero";
import { thumbOf } from "@/ui/ui";
import { Link } from "react-router";

const EXAMPLES = ["Passover", "Seattle", "Matthew 15:24", "\"most high\"", "usury", "the lost sheep"];

/** "john 3:16", "1 kings 8", "ps 23" -> a reader path, for the Bible tab's reference box. */
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
 * Search the classes by what was said in them: every recording's captions, the way the site
 * searches them. A hit opens the class at that moment, the notes beside the recording.
 */
export function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const feed = params.get("feed") ?? "", page = Math.max(0, Number(params.get("page")) || 0);
  const [input, setInput] = useState(q);
  const [recent, setRecent] = useRecentSearches();
  useEffect(() => { setInput(q); }, [q]);
  useBackButton(false, () => { if (q) { setParams({}, { replace: true }); return true; } });
  useBottomButtons(null, null);
  const set = (next: Record<string, string | undefined>, replace = false) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q, feed, ...next })) if (v) p.set(k, v);
    setParams(p, { replace });
  };
  const submit = (text = input) => {
    const t = text.trim(); if (!t) return;
    setRecent([t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
    set({ q: t, page: undefined });
  };
  const typing = input.trim() !== q;

  return (
    <Screen title="Search" kicker="What was said in the classes">
      <SearchHero value={input} onChange={setInput} onSubmit={submit} autoFocus={!q} />
      <Chips><Chip on={!feed} onClick={() => set({ feed: undefined, page: undefined })}>All collections</Chip>{Object.entries(FEED_NAME).map(([k, name]) => <Chip key={k} on={feed === k} onClick={() => set({ feed: k, page: undefined })}>{name}</Chip>)}</Chips>
      {q && !typing ? <Recordings q={q} feed={feed} page={page} onPage={(p) => set({ page: p ? String(p) : undefined })} /> : (
        <>
          <p className="hint">Type a word, a name, a place or a Scripture that was said in a class. Quotation marks find an exact phrase.</p>
          {recent.length ? <Section title="Recent" action={<button type="button" className="link" onClick={() => setRecent([])}>Clear</button>}><List>{recent.map((r) => <Row key={r} onClick={() => { setInput(r); submit(r); }} title={r} trailing={<span className="row__chev"><Icon name="clock" size={16} /></span>} />)}</List></Section> : null}
          <Section title="Try"><Chips>{EXAMPLES.map((e) => <Chip key={e} onClick={() => { setInput(e); submit(e); }}>{e}</Chip>)}</Chips></Section>
        </>
      )}
    </Screen>
  );
}

/** The recordings' passages that match, as the site lists them: twenty a page, best first. */
function Recordings({ q, feed, page, onPage }: { q: string; feed: string; page: number; onPage: (p: number) => void }) {
  const res = useTeachingsSearch(q, feed, page);
  if (res.isPending) return <Skeleton rows={6} thumb />;
  const r = res.data;
  if (!r || !r.ok) return <Empty title="Search is not answering right now">Try again in a moment.</Empty>;
  if (!r.hits.length) return <Empty title={page ? "No more results" : `Nothing said for “${q}”`}>Try fewer words, another spelling, or another collection.</Empty>;
  return (
    <>
      <p className="hint">Results {page * 20 + 1}–{page * 20 + r.hits.length} for “{q}”{page ? ` · Page ${page + 1}` : ""}</p>
      <div className="recs">{r.hits.map((h, i) => <Recording key={`${h.video}:${h.start}:${i}`} h={h} eager={i < 3} />)}</div>
      <div className="btn--row">
        {page > 0 ? <Button mode="bezeled" size="m" stretched onClick={() => onPage(page - 1)}>Previous</Button> : null}
        {r.more ? <Button mode="bezeled" size="m" stretched onClick={() => onPage(page + 1)}>Next</Button> : null}
      </div>
    </>
  );
}

/** One matching moment: the class at that second, with the words that matched lit. */
function Recording({ h, eager }: { h: TeachingHit; eager: boolean }) {
  const at = Math.max(0, Math.floor(h.start));
  return (
    <Link to={teachingPath(h)} className="rec">
      <span className="rec__thumb"><Img src={thumbOf(h.video)} eager={eager} /><span className="rec__time">{timestamp(at)}</span></span>
      <span className="rec__body">
        <span className="rec__meta">{FEED_NAME[h.feed] ?? h.feed} · {h.date ? fmtDate(h.date) : "Date unavailable"} · <b>{timestamp(at)}</b></span>
        <span className="rec__title"><Marked text={h.matchedTitle || h.title} /></span>
        <span className="rec__excerpt"><Marked text={h.excerpt} /></span>
        <span className="rec__links">{h.note ? "Watch at this moment · Read the notes" : "Watch at this moment"}</span>
      </span>
    </Link>
  );
}
