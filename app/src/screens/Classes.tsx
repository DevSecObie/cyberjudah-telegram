import { useDeferredValue, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { fmtDate } from "@/api/data";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { Button, Chip, Chips, Empty, Icon, Img, Screen, SearchField, Segmented, Skeleton } from "@/ui/ui";
import { KIND_NAME, teachingTo, useTeachings } from "./Home";

type Feed = "all" | "classes" | "captains" | "history" | "truth";
const FEEDS: [Feed, string][] = [["all", "All"], ["classes", "Sabbath"], ["captains", "Captains"], ["history", "History"], ["truth", "Truth"]];
const TRUTH = "The Truth Shall Make You Free";
const PAGE = 30;

/**
 * The teachings as a feed of cards, filtered by series, teacher and year, or by anything
 * typed: title, topic, book, teacher.
 */
export function Classes() {
  const [params, setParams] = useSearchParams();
  const feed = (FEEDS.some(([f]) => f === params.get("feed")) ? params.get("feed") : "all") as Feed;
  const teacher = params.get("teacher") ?? "", year = params.get("year") ?? "";
  useBackButton(true);
  useBottomButtons(null, null);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const query = useDeferredValue(q.trim().toLowerCase());
  const res = useTeachings();
  const set = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ feed, teacher, year, ...next })) if (v && v !== "all") p.set(k, v); setParams(p, { replace: true }); setShown(PAGE); };
  const inFeed = useMemo(() => (res.data ?? []).filter((t) => feed === "all" || (feed === "history" ? t.kind === "history" : feed === "captains" ? t.kind === "captains" : feed === "truth" ? t.kind === "class" && t.collection === TRUTH : t.kind === "class" && t.collection !== TRUTH)), [res.data, feed]);
  const teachers = useMemo(() => [...new Set(inFeed.map((t) => t.teacher).filter(Boolean))].sort(), [inFeed]);
  const years = useMemo(() => [...new Set(inFeed.map((t) => t.date.slice(0, 4)).filter(Boolean))].sort().reverse(), [inFeed]);
  const rows = useMemo(() => inFeed.filter((t) => (!teacher || t.teacher === teacher) && (!year || t.date.startsWith(year)) && (!query || `${t.title} ${t.teacher} ${t.topics.join(" ")} ${t.books.join(" ")}`.toLowerCase().includes(query))), [inFeed, teacher, year, query]);
  return (
    <Screen title="Classes">
      <Segmented label="Series" value={feed} onChange={(f) => set({ feed: f, teacher: undefined, year: undefined })} options={FEEDS} />
      <SearchField id="class-q" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Title, topic, book or teacher" />
      {teachers.length > 1 || years.length > 1 ? (
        <Chips>
          {years.length > 1 ? years.slice(0, 8).map((y) => <Chip key={y} on={year === y} onClick={() => set({ year: year === y ? undefined : y })}>{y}</Chip>) : null}
          {teachers.length > 1 ? teachers.map((t) => <Chip key={t} on={teacher === t} onClick={() => set({ teacher: teacher === t ? undefined : t })}>{t}</Chip>) : null}
        </Chips>
      ) : null}
      {res.isPending ? <Skeleton rows={8} thumb /> : res.isError ? <Empty title="The classes did not load">Check your connection and try again.</Empty> : !rows.length ? <Empty title="No class matches that">Try a topic like “Passover”, or a book like “Isaiah”.</Empty> : (
        <>
          <p className="hint">{rows.length} {rows.length === 1 ? "teaching" : "teachings"}</p>
          <div className="feed">
            {rows.slice(0, shown).map((t) => (
              <Link key={t.url} to={teachingTo(t)} className="feed__card">
                <span className="feed__img"><Img src={t.thumb} /><span className="feed__kind">{KIND_NAME[t.kind]}</span></span>
                <span className="feed__body"><b>{t.title}</b><small>{[t.sub, fmtDate(t.date), t.teacher].filter(Boolean).join(" · ")}{t.pending ? <span className="soon">Notes coming soon</span> : null}</small>{t.books.length ? <span className="feed__books">{t.books.slice(0, 3).map((b) => <em key={b}>{b}</em>)}</span> : null}</span>
              </Link>
            ))}
          </div>
          {rows.length > shown ? <Button mode="bezeled" size="m" stretched onClick={() => setShown(shown + PAGE)}>Show more ({rows.length - shown} left)</Button> : null}
        </>
      )}
    </Screen>
  );
}
