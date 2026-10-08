import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useRecentSearches } from "@/lib/marks";
import { showOf } from "@/lib/series";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { api, ApiError, haptic, hideKeyboard, openLink } from "@/tg/sdk";
import { Button, Chip, Icon, Img, Skeleton, timestamp, type IconName } from "@/ui/ui";
import { fmtDate } from "@/api/data";
import { FEED_NAME, KIND_LABEL, Lit, Marked, hitPath, teachingPath, useTeachingsSearch, type Hit, type SearchResult, type TeachingHit } from "@/ui/search-hero";
import { answerHtml, passageLabel, passagePath, type Source } from "./Ask";
import { linkRefsInHtml, useBookSlugs } from "@/ui/reftext";
import { THUMB, thumbOf } from "@/ui/ui";
import { frameStyle, useBoard } from "@/lib/frames";
import { Trouble } from "@/ui/trouble";
import { ReportAnswer } from "@/ui/report";
import { SearchBar, useSettled } from "@/ui/search-bar";

const EXAMPLES = ["Passover", "Melchizedek", "Matthew 15:24", "\"most high\"", "twelve tribes", "usury"];

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
 * Search: everything the library holds, in one place. As you type, the results come in: what was
 * said in the classes (the recordings' spoken passages, at the moment), the Scripture, the notes,
 * and the law. A scope bar narrows to one of them, with its count; a reference ("John 3:16")
 * opens the Bible there. Enter keeps the search (recent searches, a link to share). The keyboard
 * works it end to end: / or Ctrl+K to the field, the arrows through the results, Escape back.
 */
type Scope = "top" | "spoken" | "scripture" | "notes" | "law";
const SCOPES: [Scope, string][] = [["top", "Top"], ["spoken", "Said in class"], ["scripture", "Scripture"], ["notes", "Notes"], ["law", "Law"]];
const SCOPE_KINDS: Record<Exclude<Scope, "top" | "spoken">, string[]> = {
  scripture: ["verse"],
  notes: ["class", "captains", "history", "study", "encyclopedia", "book"],
  law: ["law", "precept", "case"],
};
const KIND_ICON: Record<string, IconName> = { verse: "book", class: "play", captains: "play", history: "history", study: "note", law: "law", precept: "quote", case: "folder", encyclopedia: "layers", book: "layers" };
/** The order the Top results read in: what was taught, then the text, then the law. */
const TOP_ORDER = ["class", "captains", "history", "study", "verse", "precept", "law", "case", "encyclopedia", "book"];
const LABEL: Record<string, string> = { ...KIND_LABEL, book: "Library books" };

function useLibrary(q: string, live: boolean) {
  return useQuery({
    queryKey: ["library-search", q, live],
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(q.trim())}&limit=40${live ? "&live=1" : ""}`),
  });
}

/** A reference's parts ("/bible/john/3?v=16-18"), for the classes that taught it. */
function refParts(path: string | null): { slug: string; chapter: number; verses: number[] } | null {
  const m = path ? /^\/bible\/([^/?]+)\/(\d+)(?:\?v=(\d+)(?:-(\d+))?)?/.exec(path) : null;
  if (!m) return null;
  const a = Number(m[3] || 0), b = Number(m[4] || a);
  return { slug: m[1], chapter: Number(m[2]), verses: a ? Array.from({ length: Math.min(b - a + 1, 60) }, (_, i) => a + i) : [] };
}
type TaughtRow = { first: number; last: number | null; video: string; start: number; timing: string; title: string; feed: string; date: string; note: string; heard: string };
/** For a reference, what was said in class is where the classes taught that verse, not where its words were spoken. */
function useTaughtRef(ref: string | null) {
  const parts = refParts(ref);
  return useQuery({
    queryKey: ["taught-ref", parts?.slug, parts?.chapter, parts?.verses.join(",")],
    enabled: !!parts,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await api<{ ok: boolean; rows: TaughtRow[]; total: number }>(`/api/taught/${parts!.slug}/${parts!.chapter}?v=${parts!.verses.join(",")}`);
      const seen = new Set<string>();
      const hits: TeachingHit[] = [];
      for (const row of r.ok ? r.rows : []) {
        if (seen.has(row.video)) continue; seen.add(row.video);
        hits.push({ title: row.title, matchedTitle: "", excerpt: row.heard, feed: row.feed, date: row.date, video: row.video, start: row.start, note: row.note, timing: row.timing === "caption" ? "caption" : "passage" });
      }
      return { hits, total: r.ok ? r.total : 0 };
    },
  });
}

export function Search() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const q = params.get("q") ?? "";
  const feed = params.get("feed") ?? "", page = Math.max(0, Number(params.get("page")) || 0);
  const scope = (SCOPES.find(([s]) => s === params.get("in"))?.[0] ?? "top") as Scope;
  const [input, setInput] = useState(q);
  const [recent, setRecent] = useRecentSearches();
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => { setInput(q); }, [q]);
  useBackButton(false, () => { if (q || input) { setInput(""); setParams({}, { replace: true }); return true; } });
  useBottomButtons(null, null);

  // Results follow the words as they are typed; Enter keeps them.
  const settled = useSettled(input, 220);
  const term = input.trim() === q.trim() ? q : settled;
  const live = term.trim() !== q.trim();
  const library = useLibrary(term, live);
  const spoken = useTeachingsSearch(term, feed, scope === "spoken" ? page : 0);
  const ref = referencePath(term);
  const taught = useTaughtRef(ref);

  const set = (next: Record<string, string | undefined>, replace = false) => {
    const p = new URLSearchParams(); for (const [k, v] of Object.entries({ q, feed, in: scope === "top" ? undefined : scope, ...next })) if (v) p.set(k, v);
    setParams(p, { replace });
  };
  const submit = (text = input) => {
    const t = text.trim(); if (!t) return;
    hideKeyboard();
    setRecent([t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 8));
    set({ q: t, page: undefined });
  };
  const choose = (text: string) => { setInput(text); submit(text); };

  const hits = library.data?.ok ? library.data.hits : [];
  const counts = library.data?.ok ? library.data.counts : {};
  const count = (s: Scope) => s === "top" ? undefined : s === "spoken" ? (spoken.data?.ok ? spoken.data.hits.length + (spoken.data.more ? "+" : "") : undefined) : SCOPE_KINDS[s].reduce((n, k) => n + (counts[k] ?? 0), 0) || undefined;
  const busy = (library.isFetching || spoken.isFetching) && term.trim().length >= 2;
  const total = hits.length + (spoken.data?.ok ? spoken.data.hits.length : 0);
  // A failure is announced as a failure (the alert below names it), never as "0 results".
  const failed = (library.isError || library.data?.ok === false) && (spoken.isError || spoken.data?.ok === false || !spoken.data);

  return (
    <main className="screen srch">
      <h1 className="sr-only">Search</h1>
      <SearchBar keyboardDock id="q" value={input} onChange={setInput} onSubmit={() => submit()} onCancel={() => { setInput(""); if (q) setParams({}, { replace: true }); }}
        placeholder="Search CyberJudah" busy={busy} autoFocus={!q} results={results} controls="srch-results">
        {term.trim().length >= 2 ? (
          <div className="srch__scopes" role="tablist" aria-label="Search in">
            {SCOPES.map(([s, label]) => (
              <button key={s} type="button" role="tab" aria-selected={scope === s} className="srch__scope" onClick={() => { haptic("select"); set({ in: s === "top" ? undefined : s, page: undefined }, true); }}>
                {label}{count(s) !== undefined ? <span className="srch__count">{count(s)}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </SearchBar>
      <p className="sr-only" aria-live="polite">{term.trim().length >= 2 && !busy && !failed ? `${total} ${total === 1 ? "result" : "results"} for ${term}` : ""}</p>
      <div id="srch-results" ref={results} className="srch__results">
        {term.trim().length < 2 ? (
          <Start recent={recent} onPick={choose} onForget={(r) => setRecent(recent.filter((x) => x !== r))} onClear={() => setRecent([])} />
        ) : scope === "spoken" ? (
          <>
            <div className="chips srch__feeds"><Chip on={!feed} onClick={() => set({ feed: undefined, page: undefined }, true)}>All collections</Chip>{Object.entries(FEED_NAME).map(([k, name]) => <Chip key={k} on={feed === k} onClick={() => set({ feed: k, page: undefined }, true)}>{name}</Chip>)}</div>
            <Spoken q={term} res={spoken} page={page} onPage={(p) => set({ page: p ? String(p) : undefined })} />
          </>
        ) : scope === "top" ? (
          <Top term={term} aiQ={q} refPath={ref} taught={taught.data} library={library} spoken={spoken} hits={hits} counts={counts} onScope={(s) => set({ in: s, page: undefined }, true)} onOpenRef={() => ref && navigate(ref)} />
        ) : (
          <Library scope={scope} library={library} hits={hits.filter((h) => SCOPE_KINDS[scope].includes(h.kind))} q={term} />
        )}
      </div>
    </main>
  );
}

/** Before a search: recent searches to pick up again, and a few to try. */
function Start({ recent, onPick, onForget, onClear }: { recent: string[]; onPick: (q: string) => void; onForget: (q: string) => void; onClear: () => void }) {
  return (
    <div className="srch__start">
      {recent.length ? (
        <section aria-labelledby="srch-recent">
          <div className="srch__head"><h2 id="srch-recent">Recent</h2><button type="button" className="link" onClick={onClear}>Clear</button></div>
          <ul className="srch__recent">
            {recent.map((r) => (
              <li key={r}>
                <button type="button" data-result="" className="srch__recentbtn" onClick={() => onPick(r)}><Icon name="clock" size={16} /><span>{r}</span></button>
                <button type="button" className="srch__forget" aria-label={`Remove ${r} from recent searches`} title={`Remove ${r} from recent searches`} onClick={() => onForget(r)}><Icon name="close" size={12} /></button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="srch__empty">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></svg>
        <p>Every class, verse, note and law. Words together, a <b>"quoted phrase"</b>, or a reference like <b>John 3:16</b>.</p>
        <div className="srch__try">{EXAMPLES.map((e) => <button key={e} type="button" data-result="" onClick={() => onPick(e)}>{e}</button>)}</div>
      </div>
    </div>
  );
}

type LibraryQuery = ReturnType<typeof useLibrary>;
type SpokenQuery = ReturnType<typeof useTeachingsSearch>;

type SearchAi = { ok: boolean; answer?: string; sources?: Source[]; model?: string; error?: string };

/**
 * The AI answer block: one free-tier answer over the library for the submitted search, above the
 * keyword results. It fires once per submitted search (not while typing), fails silent so the
 * keyword results always remain, and each citation chip opens its source.
 */
function AiAnswer({ q }: { q: string }) {
  const navigate = useNavigate();
  const slugs = useBookSlugs();
  const res = useQuery({
    queryKey: ["search-ai", q],
    enabled: q.trim().length >= 2,
    staleTime: 120_000,
    retry: false,
    queryFn: () => api<SearchAi>(`/api/search/answer?q=${encodeURIComponent(q.trim())}`),
  });
  const data = res.data;
  const html = useMemo(() => (data?.ok && data.answer ? linkRefsInHtml(answerHtml(data.answer, data.sources ?? []), slugs) : ""), [data, slugs]);
  if (q.trim().length < 2) return null;
  if (res.isPending) {
    return (
      <section className="srch__group srch__ai" aria-label="AI answer">
        <div className="srch__head"><h2><Icon name="spark" size={16} />AI answer</h2></div>
        <div className="msg__thinking" role="status"><span className="answer__dots" aria-hidden="true"><i /><i /><i /></span>Answering from the library…</div>
      </section>
    );
  }
  if (res.isError || !data?.ok || !data.answer) return null;
  const sources = data.sources ?? [];
  const open = (s: Source) => { haptic("select"); if (s.kind === "web" && /^https:\/\//.test(s.url)) openLink(s.url); else navigate(passagePath(s)); };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const ref = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.reflink, a.applink");
    if (ref) { e.preventDefault(); haptic("select"); navigate(ref.getAttribute("href")!.replace(/&amp;/g, "&")); return; }
    const c = (e.target as HTMLElement).closest<HTMLElement>("[data-n]");
    const s = c && sources.find((x) => x.n === Number(c.dataset.n));
    if (s) { e.preventDefault(); open(s); }
  };
  return (
    <section className="srch__group srch__ai" aria-label="AI answer">
      <div className="srch__head"><h2><Icon name="spark" size={16} />AI answer</h2><span className="srch__count">free</span></div>
      <div className="msg__text" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
      {sources.length ? (
        <div className="srcrail">
          {sources.map((s) => (
            <button key={s.n} type="button" className="srccard" onClick={() => open(s)}>
              <span className="srccard__top"><b className="cite">{s.n}</b><small>{passageLabel(s)}</small></span>
              <span className="srccard__title">{s.title}</span>
            </button>
          ))}
        </div>
      ) : null}
      <p className="hint">From the library, answered by the free model. It can be wrong — check the sources.</p>
      <div className="msg__actions"><ReportAnswer of={{ kind: "search", ...(data.model ? { model: data.model } : {}) }} /></div>
    </section>
  );
}

/** Top: a reference first, then what was said in class, then each kind of library result, three of each. */
function Top({ term, aiQ, refPath, taught, library, spoken, hits, counts, onScope, onOpenRef }: { term: string; aiQ: string; refPath: string | null; taught?: { hits: TeachingHit[]; total: number }; library: LibraryQuery; spoken: SpokenQuery; hits: Hit[]; counts: Record<string, number>; onScope: (s: Scope) => void; onOpenRef: () => void }) {
  const groups = useMemo(() => TOP_ORDER.map((k) => [k, hits.filter((h) => h.kind === k)] as const).filter(([, list]) => list.length), [hits]);
  // A reference: the classes that taught it. Words: where they were said.
  const moments = taught?.hits.length ? taught.hits.slice(0, 3) : spoken.data?.ok ? spoken.data.hits.slice(0, 3) : [];
  const momentCount = taught?.hits.length ? String(taught.total) : spoken.data?.ok ? `${spoken.data.hits.length}${spoken.data.more ? "+" : ""}` : undefined;
  const loading = library.isPending || (spoken.isPending && !moments.length);
  const failed = library.isError || (library.data && !library.data.ok);
  if (loading && !groups.length) return <Skeleton rows={6} thumb />;
  if (failed && !moments.length) return <Trouble error={library.error ?? new ApiError(503, "/api/search", "unavailable")} what="search" q={term} onRetry={() => void library.refetch()} />;
  if (!groups.length && !moments.length && !refPath) return <NoResults q={term} />;
  const scopeOf = (k: string): Scope => (Object.entries(SCOPE_KINDS).find(([, ks]) => ks.includes(k))?.[0] ?? "notes") as Scope;
  return (
    <>
      <AiAnswer q={aiQ} />
      {refPath ? (
        <button type="button" data-result="" className="srch__ref" onClick={onOpenRef}>
          <span className="srch__refIcon"><Icon name="book" size={22} /></span>
          <span className="srch__refText"><small>Open in the Bible</small><b>{term.trim().replace(/\b\w/g, (c) => c.toUpperCase())}</b></span>
          <Icon name="chevron" size={18} />
        </button>
      ) : null}
      {moments.length ? (
        <Group title={taught?.hits.length ? "Taught in class" : "Said in class"} count={momentCount} onAll={taught?.hits.length ? undefined : () => onScope("spoken")}>
          <div className="recs recs--compact">{moments.map((h, i) => <Recording key={`${h.video}:${h.start}:${i}`} h={h} eager={i < 2} />)}</div>
        </Group>
      ) : null}
      {groups.map(([kind, list]) => (
        <Group key={kind} title={LABEL[kind] ?? kind} count={counts[kind] ? String(counts[kind]) : undefined} onAll={(counts[kind] ?? list.length) > 3 ? () => onScope(scopeOf(kind)) : undefined}>
          <ul className="srch__list">{list.slice(0, 3).map((h) => <Result key={`${h.kind}|${h.url}`} h={h} q={term} />)}</ul>
        </Group>
      ))}
    </>
  );
}

function Group({ title, count, onAll, children }: { title: string; count?: string; onAll?: () => void; children: ReactNode }) {
  return (
    <section className="srch__group" aria-label={title}>
      <div className="srch__head"><h2>{title}{count ? <span className="srch__count">{count}</span> : null}</h2>{onAll ? <button type="button" className="srch__all" onClick={onAll}>See all</button> : null}</div>
      {children}
    </section>
  );
}

/** One library result: its kind's icon, the title, where it is, and the words that matched lit. */
function Result({ h, q }: { h: Hit; q: string }) {
  const phrase = /^".*"$/.test(q.trim());
  return (
    <li>
      <Link to={hitPath(h)} data-result="" className="srch__hit" onClick={() => haptic("select")}>
        <span className="srch__kind" data-kind={h.kind}><Icon name={KIND_ICON[h.kind] ?? "note"} size={18} /></span>
        <span className="srch__body">
          <span className="srch__title">{h.title}</span>
          {h.sub ? <span className="srch__sub">{h.sub}</span> : null}
          {h.snippet ? <span className="srch__snip"><Lit text={h.snippet} needle={q} phrase={phrase} /></span> : null}
        </span>
        <span className="srch__go" aria-hidden="true"><Icon name="chevron" size={16} /></span>
      </Link>
    </li>
  );
}

function Library({ scope, library, hits, q }: { scope: Scope; library: LibraryQuery; hits: Hit[]; q: string }) {
  if (library.isPending) return <Skeleton rows={8} />;
  if (library.isError || (library.data && !library.data.ok)) return <Trouble error={library.error ?? new ApiError(503, "/api/search", "unavailable")} what="search" q={q} onRetry={() => void library.refetch()} />;
  if (!hits.length) return <NoResults q={q} where={SCOPES.find(([s]) => s === scope)?.[1]} />;
  return <ul className="srch__list srch__list--full">{hits.map((h) => <Result key={`${h.kind}|${h.url}`} h={h} q={q} />)}</ul>;
}

function NoResults({ q, where }: { q: string; where?: string }) {
  return (
    <div className="srch__none" role="status">
      <b>Nothing found for “{q}”{where ? ` in ${where}` : ""}</b>
      <p>Try fewer words, another spelling, or the start of a word. A name can be spelled two ways in the KJV (Elijah, Elias); either finds both.</p>
    </div>
  );
}

/** What was said in class: the recordings' passages that match, twenty a page, best first. */
function Spoken({ q, res, page, onPage }: { q: string; res: SpokenQuery; page: number; onPage: (p: number) => void }) {
  if (res.isPending) return <Skeleton rows={6} thumb />;
  const r = res.data;
  if (res.isError || !r) return <Trouble error={res.error} what="search" q={q} onRetry={() => void res.refetch()} />;
  if (!r.ok) return <Trouble error={new ApiError(503, "/api/teachings", r.reason)} what="search" q={q} onRetry={() => void res.refetch()} />;
  if (!r.hits.length) return page ? <NoResults q={q} where="the later pages" /> : <NoResults q={q} where="what was said in class" />;
  return (
    <>
      <p className="hint">Moments {page * 20 + 1}–{page * 20 + r.hits.length} for “{q}”{page ? ` · Page ${page + 1}` : ""}</p>
      <div className="recs">{r.hits.map((h, i) => <Recording key={`${h.video}:${h.start}:${i}`} h={h} eager={i < 3} />)}</div>
      <div className="btn--row">
        {page > 0 ? <Button appearance="bordered" size="md" stretched onClick={() => onPage(page - 1)}>Previous</Button> : null}
        {r.more ? <Button appearance="bordered" size="md" stretched onClick={() => onPage(page + 1)}>Next</Button> : null}
      </div>
    </>
  );
}

/** One matching moment: the class at that second, with the words that matched lit. */
function Recording({ h, eager }: { h: TeachingHit; eager: boolean }) {
  const at = Math.max(0, Math.floor(h.start));
  // The picture of the moment itself when the recording's frames are in; the cover otherwise.
  const board = useBoard(h.video);
  const frame = frameStyle(h.video, board.data, at);
  return (
    <Link to={teachingPath(h)} className="rec" data-result="">
      <span className="rec__thumb">{frame ? <span className="rec__frame" style={frame} /> : <Img src={thumbOf(h.video)} eager={eager} {...THUMB} />}<span className="rec__time">{timestamp(at)}</span></span>
      <span className="rec__body">
        <span className="rec__meta">{showOf(h.title) ?? FEED_NAME[h.feed] ?? h.feed} · {h.date ? fmtDate(h.date) : "Date unavailable"} · <b>{timestamp(at)}</b></span>
        <span className="rec__title"><Marked text={h.matchedTitle || h.title} /></span>
        <span className="rec__excerpt"><Marked text={h.excerpt} /></span>
        <span className="rec__links">{h.note ? "Watch at this moment · Read the notes" : "Watch at this moment"}</span>
      </span>
    </Link>
  );
}
