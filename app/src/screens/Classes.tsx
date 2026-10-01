import { useDeferredValue, useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { Button, Chip, Chips, Empty, Img, Screen, SearchField, Skeleton } from "@/ui/ui";
import { KIND_NAME, teachingTo, useTeachings } from "./Home";

type Feed = "all" | "classes" | "captains" | "history" | "truth";
const FEEDS: [Feed, string][] = [["all", "All"], ["classes", "Sabbath"], ["captains", "Captains"], ["history", "History"], ["truth", "Truth"]];
const TRUTH = "The Truth Shall Make You Free";
const PAGE = 30;

/**
 * The teachings as a feed of cards, filtered by series, teacher and year, or by anything
 * typed: title, topic, book, teacher.
 */
/** Teachings by the month they were given, newest first; undated ones last. */
function months<T extends { date: string }>(rows: T[]): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const t of rows) {
    const k = t.date ? new Date(`${t.date.slice(0, 7)}-01T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "Undated";
    (out.get(k) ?? out.set(k, []).get(k)!).push(t);
  }
  return [...out.entries()];
}

export function Classes() {
  const [params, setParams] = useSearchParams();
  const feed = (FEEDS.some(([f]) => f === params.get("feed")) ? params.get("feed") : "all") as Feed;
  const teacher = params.get("teacher") ?? "", year = params.get("year") ?? "";
  useBackButton(true);
  useBottomButtons(null, null);
  const [q, setQ] = useVisitState("q", "");
  const [shown, setShown] = useVisitState("shown", PAGE);
  const query = useDeferredValue(q.trim().toLowerCase());
  const res = useTeachings();
  useKeptScroll(!!res.data);
  const set = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ feed, teacher, year, ...next })) if (v && v !== "all") p.set(k, v); setParams(p, { replace: true }); setShown(PAGE); };
  const inFeed = useMemo(() => (res.data ?? []).filter((t) => feed === "all" || (feed === "history" ? t.kind === "history" : feed === "captains" ? t.kind === "captains" : feed === "truth" ? t.kind === "class" && t.collection === TRUTH : t.kind === "class" && t.collection !== TRUTH)), [res.data, feed]);
  const teachers = useMemo(() => [...new Set(inFeed.map((t) => t.teacher).filter(Boolean))].sort(), [inFeed]);
  const years = useMemo(() => [...new Set(inFeed.map((t) => t.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [inFeed]);
  const counts = useMemo(() => Object.fromEntries(FEEDS.map(([f]) => [f, (res.data ?? []).filter((t) => f === "all" || (f === "history" ? t.kind === "history" : f === "captains" ? t.kind === "captains" : f === "truth" ? t.kind === "class" && t.collection === TRUTH : t.kind === "class" && t.collection !== TRUTH)).length])), [res.data]);
  const rows = useMemo(() => inFeed.filter((t) => (!teacher || t.teacher === teacher) && (!year || t.date.startsWith(year)) && (!query || `${t.title} ${t.teacher} ${t.topics.join(" ")} ${t.books.join(" ")}`.toLowerCase().includes(query))), [inFeed, teacher, year, query]);
  return (
    <Screen title="Classes">
      <div className="cases__eras" role="group" aria-label="Series"><Chips>{FEEDS.map(([f, label]) => <Chip key={f} on={feed === f} onClick={() => set({ feed: f, teacher: undefined, year: undefined })}>{label}{res.data ? <span className="chip__n">{counts[f]}</span> : null}</Chip>)}</Chips></div>
      <SearchField id="class-q" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Title, topic, book or teacher" />
      {teachers.length > 1 || years.length > 1 ? (
        <div className="filters">
          {years.length > 1 ? <div className="filters__row"><small>Year</small><div className="filters__scroll"><Chips>{years.slice(0, 10).map((y) => <Chip key={y} on={year === y} onClick={() => set({ year: year === y ? undefined : y })}>{y}</Chip>)}</Chips></div></div> : null}
          {teachers.length > 1 ? <div className="filters__row"><small>Teacher</small><div className="filters__scroll"><Chips>{teachers.map((t) => <Chip key={t} on={teacher === t} onClick={() => set({ teacher: teacher === t ? undefined : t })}>{t}</Chip>)}</Chips></div></div> : null}
          {teacher || year || feed !== "all" ? (
            <div className="filters__active">
              <span>Showing{feed !== "all" ? ` ${FEEDS.find(([f]) => f === feed)?.[1] ?? feed}` : ""}{teacher ? ` · ${teacher}` : ""}{year ? ` · ${year}` : ""}</span>
              <button type="button" onClick={() => { setQ(""); set({ feed: "all", teacher: undefined, year: undefined }); }}>Clear filters</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {res.isPending ? <Skeleton rows={8} thumb /> : res.isError ? <Empty title="The classes did not load">Check your connection and try again.</Empty> : !rows.length ? <Empty title="No class matches that" action={{ label: "Clear filters", onClick: () => { setQ(""); set({ feed: "all", teacher: undefined, year: undefined }); } }}>Try a topic like “Passover”, or a book like “Isaiah”.</Empty> : (
        <>
          <p className="hint">{rows.length.toLocaleString()} {rows.length === 1 ? "teaching" : "teachings"}</p>
          {months(rows.slice(0, shown)).map(([month, items]) => (
            <section key={month} className="classes__month" aria-label={month}>
              <h2 className="cases__eraname">{month}<span>{items.length}</span></h2>
              <div className="feed">
                {items.map((t) => (
                  <Link key={t.url} to={teachingTo(t)} className="feed__card">
                    <span className="feed__img"><Img src={t.thumb} /><span className="feed__kind">{KIND_NAME[t.kind]}</span></span>
                    <span className="feed__body"><b>{t.title}</b><small>{[t.sub, fmtDate(t.date), t.teacher].filter(Boolean).join(" · ")}{t.pending ? <span className="soon">Notes coming soon</span> : null}</small>{t.books.length ? <span className="feed__books">{t.books.slice(0, 3).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
          {rows.length > shown ? <Button mode="bezeled" size="m" stretched onClick={() => setShown(shown + PAGE)}>Show more ({rows.length - shown} left)</Button> : null}
        </>
      )}
    </Screen>
  );
}
