import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { expand, useLast, useProgress } from "@/lib/marks";
import { useBackButton } from "@/tg/hooks";
import { haptic } from "@/tg/sdk";
import { Empty, Icon, List, Screen, Segmented, Skeleton } from "@/ui/ui";

type Part = "Old Testament" | "New Testament" | "Apocrypha";
const PARTS: [Part, string][] = [["Old Testament", "Old"], ["New Testament", "New"], ["Apocrypha", "Apocrypha"]];

export function Bible() {
  const [params, setParams] = useSearchParams();
  const open = params.get("book") ?? undefined;
  useBackButton(true);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [part, setPart] = useState<Part>("Old Testament");
  const [last] = useLast();
  const [progress] = useProgress();
  useEffect(() => { const b = books.data?.find((x) => x.slug === open); if (b) setPart(b.testament); }, [open, books.data]);
  useEffect(() => { if (open) document.getElementById(`book-${open}`)?.scrollIntoView({ block: "start" }); }, [open, part]);
  const list = useMemo(() => (books.data ?? []).filter((b) => b.testament === part), [books.data, part]);
  const toggle = (slug: string) => { haptic("select"); setParams(open === slug ? {} : { book: slug }, { replace: true }); };
  return (
    <Screen title="Bible" kicker="King James Version · with the Apocrypha">
      <Segmented label="Testament" value={part} onChange={setPart} options={PARTS} />
      {books.isPending ? <Skeleton rows={10} /> : books.isError ? <Empty title="The books did not load">Check your connection and try again.</Empty> : (
        <List>
          {list.map((b) => {
            const read = expand(progress[b.slug]);
            return (
              <div key={b.slug} id={`book-${b.slug}`} style={{ scrollMarginTop: 12 }}>
                <button type="button" className="row" aria-expanded={open === b.slug} onClick={() => toggle(b.slug)}>
                  <span className="row__body"><span className="row__title">{b.book}</span>{read.size ? <span className="row__sub">{read.size} of {b.chapters} read</span> : null}</span>
                  <span className="row__count">{b.chapterIds.length}</span>
                  <span className="row__chev" style={{ transform: open === b.slug ? "rotate(90deg)" : undefined, transition: "transform .15s" }}><Icon name="chevron" size={18} /></span>
                </button>
                {open === b.slug ? <div className="chapters">{b.chapterIds.map((c) => <Link key={c} to={`/read/${b.slug}/${c}`} data-last={last?.slug === b.slug && last.chapter === c ? "" : undefined} style={read.has(c) && !(last?.slug === b.slug && last.chapter === c) ? { color: "var(--a-muted)" } : undefined} aria-label={`${b.book} ${c}`}>{c}</Link>)}</div> : null}
              </div>
            );
          })}
        </List>
      )}
    </Screen>
  );
}
