import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { data, when } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { Empty, List, Row, Screen, SearchField, Segmented, Skeleton } from "@/ui/ui";

type Feed = "classes" | "captains" | "history" | "truth";
const FEEDS: [Feed, string][] = [["classes", "Sabbath"], ["captains", "Captains"], ["history", "History"], ["truth", "Truth"]];
const TRUTH = "The Truth Shall Make You Free";
const PAGE = 40;
type Item = { url: string; title: string; date: string; teacher: string; thumb: string; topics: string[]; books: string[]; sub?: string };

function useFeed(feed: Feed) {
  return useQuery({
    queryKey: ["feed", feed],
    queryFn: async (): Promise<Item[]> => {
      if (feed === "history") return (await data.history()).map((r) => ({ url: r.url, title: r.title, date: r.date ?? "", teacher: r.teacher, thumb: r.thumb, topics: r.topics, books: [], sub: r.episode ? `Episode ${r.episode}` : undefined }));
      const rows = feed === "captains" ? await data.captains() : await data.classes();
      return rows.filter((r) => (feed === "truth" ? r.collection === TRUTH : feed === "classes" ? r.collection !== TRUTH : true)).map((r) => ({ url: r.url, title: r.title, date: r.date, teacher: r.teacher, thumb: r.thumb, topics: r.topics ?? [], books: r.books }));
    },
  });
}

export function Classes() {
  const [params, setParams] = useSearchParams();
  const feed = (FEEDS.some(([f]) => f === params.get("feed")) ? params.get("feed") : "classes") as Feed;
  useBackButton(true);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const query = useDeferredValue(q.trim().toLowerCase());
  const res = useFeed(feed);
  const rows = useMemo(() => {
    const all = [...(res.data ?? [])].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return query ? all.filter((r) => `${r.title} ${r.teacher} ${r.topics.join(" ")} ${r.books.join(" ")}`.toLowerCase().includes(query)) : all;
  }, [res.data, query]);
  return (
    <Screen title="Classes" kicker="Watch · read · listen">
      <Segmented label="Series" value={feed} onChange={(f) => { setShown(PAGE); setParams({ feed: f }, { replace: true }); }} options={FEEDS} />
      <SearchField id="class-q" value={q} onChange={(v) => { setQ(v); setShown(PAGE); }} placeholder="Filter by title, topic, book or teacher" />
      {res.isPending ? <Skeleton rows={8} thumb /> : res.isError ? <Empty title="The classes did not load">Check your connection and try again.</Empty> : !rows.length ? <Empty title="No class matches that">Try a topic like “Passover”, or a book like “Isaiah”.</Empty> : (
        <List>
          {rows.slice(0, shown).map((r) => <Row key={r.url} href={r.url} thumb={r.thumb} meta={[r.sub, when(r.date, r.teacher)].filter(Boolean).join(" · ")} title={r.title} />)}
          {rows.length > shown ? <button type="button" className="more-btn" onClick={() => setShown(shown + PAGE)}>Show more ({rows.length - shown} left)</button> : null}
        </List>
      )}
    </Screen>
  );
}
