import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { data, fmtDate, type ClassBookMoment, type ClassWikiPage } from "@/api/data";
import { useBackButton } from "@/tg/hooks";
import { Player } from "@/ui/player";
import { Empty, List, Loading, Row, Screen, SearchField, Section } from "@/ui/ui";

/**
 * The Wikipedia pages the classes put on screen and read from. Each page opens inside the app,
 * Wikipedia's own mobile page in a frame, under the class moments that read it.
 * Wikipedia's text is CC BY-SA, so the page names Wikipedia and links its license.
 */

const TITLE = /^[^#<>[\]{}|]{1,255}$/;
export const wikiKey = (p: Pick<ClassWikiPage, "wiki">) => encodeURIComponent(p.wiki);
const useClassWiki = () => useQuery({ queryKey: ["class-wikipedia"], queryFn: data.classWikipedia, staleTime: Infinity });
const momentHref = (m: ClassBookMoment) => (m.url ? `/note${m.url}?t=${m.t}` : `/watch/${m.video}?t=${m.t}`);

export function ClassWikiListScreen() {
  useBackButton();
  const pages = useClassWiki();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => (pages.data ?? []).filter((p) => !needle || p.title.toLowerCase().includes(needle)), [pages.data, needle]);
  return (
    <Screen title="Wikipedia" kicker="Pages the classes read on screen">
      <SearchField id="class-wiki-q" value={q} onChange={setQ} placeholder="Search the pages" />
      {pages.isPending ? <Loading /> : pages.isError ? (
        <Empty title="The pages did not load" action={{ label: "Retry", onClick: () => void pages.refetch() }}>Check your connection.</Empty>
      ) : !rows.length ? <Empty title={`No page found for “${q}”`} /> : (
        <List>{rows.map((p) => <Row key={p.wiki} href={`/class-wikipedia/${wikiKey(p)}`} title={p.title} sub={p.moments[0]?.title ?? ""} />)}</List>
      )}
    </Screen>
  );
}

export function ClassWikiScreen() {
  useBackButton();
  const { key = "" } = useParams();
  const pages = useClassWiki();
  const [playing, setPlaying] = useState<string | null>(null);
  const p = pages.data?.find((x) => x.wiki === key);
  if (pages.isPending) return <Screen title="…"><Loading /></Screen>;
  if (!p || !TITLE.test(p.wiki)) return <Screen title="Wikipedia"><Empty title="This page was not found" /></Screen>;
  return (
    <Screen title={p.title} kicker="From Wikipedia, as read in class">
      <Section title="In the classes">
        <div className="class-book__moments">{p.moments.map((m) => {
          const id = `${m.video}-${m.t}`;
          return (
            <article key={id} className="class-book__moment">
              <Player video={m.video} start={m.t} playing={playing === id} onPlay={() => setPlaying(id)} title={m.title || "Class"} />
              <Link to={momentHref(m)} className="class-book__title"><b>{m.title || "Class"}</b><small>{[fmtDate(m.date ?? ""), m.teacher].filter(Boolean).join(" · ")}</small></Link>
            </article>
          );
        })}</div>
      </Section>
      <Section title="The page">
        <iframe className="class-book-reader__frame" src={`https://en.m.wikipedia.org/wiki/${encodeURIComponent(p.wiki)}`} title={`${p.title}, Wikipedia`}
          referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups" />
        <p className="hint">Text from Wikipedia, available under the Creative Commons Attribution-ShareAlike License.</p>
      </Section>
    </Screen>
  );
}
