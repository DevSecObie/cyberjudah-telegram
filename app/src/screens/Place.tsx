import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { data, type Place as P } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { useBackButton } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { EntityAvatar } from "@/ui/avatar";
import { refLabel, refOfPath, ScriptureCard, type VerseRef } from "@/ui/scripture";
import { Empty, Screen } from "@/ui/ui";
import { EntityMore, EntitySection, EntitySkeleton } from "./Person";

/**
 * A place of the Bible, laid out as Bible Strong's entity page (StrongEntityPage) is for a place:
 * the summary card (its picture, "Place" and its region, its name and its Strong's numbers, the
 * other names the King James gives it), then every verse that names it, as cards with the King
 * James text. Bible Strong keeps its map section switched off (ENTITY_LOCATION_VISIBLE), so the
 * map point is not shown. Names, region and verses are STEPBible's TIPNR (CC BY 4.0).
 */
const VERSES_FIRST = 5, VERSES_MORE = 10;
/** TIPNR's 'H0804G' as the lexicon's 'H804'. */
const lexiconCode = (s: string) => { const m = /^([HG])0*(\d+)/.exec(s); return m ? `${m[1]}${m[2]}` : null; };

export function Place() {
  const { id = "" } = useParams();
  useBackButton();
  const p = useQuery({ queryKey: ["place", id], queryFn: () => data.place(id), staleTime: Infinity, retry: 1 });
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [versesShown, setVersesShown] = useVisitState("verses", VERSES_FIRST);
  useKeptScroll(!!p.data && !!books.data);

  if (p.isPending) return <Screen className="entity"><EntitySkeleton /></Screen>;
  if (p.isError || !p.data) return (
    <Screen className="entity">
      <Empty title="This place did not load" action={{ label: "Try again", onClick: () => void p.refetch() }}>Check your connection.</Empty>
    </Screen>
  );
  const d: P = p.data;
  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const verses = d.verses.map(refOfPath).filter((r): r is VerseRef => !!r);
  const codes = [...new Set(d.strongs.map(lexiconCode).filter((c): c is string => !!c))];

  return (
    <Screen className="entity">
      <header className="entity__summary">
        <div className="entity__id">
          <EntityAvatar name={d.name} kind="place" size={48} />
          <div>
            <p className="entity__eyebrow">{["Place", d.region].filter(Boolean).join(" · ")}</p>
            <h1 className="entity__name">{d.name}</h1>
            {codes.length ? (
              <div className="entity__codes">
                {codes.map((c) => <Link key={c} to={`/lexicon/${c}`} className="entity__code" aria-label={`Strong's ${c}`} onClick={() => haptic("select")}>{c}<Feather name="chevron-right" size={10} color="currentColor" /></Link>)}
              </div>
            ) : null}
          </div>
        </div>
        {d.names.length > 1 ? <p className="entity__aka">Also called {d.names.filter((n) => n !== d.name).join(", ")}</p> : null}
      </header>

      <EntitySection title="Verses" count={verses.length} note={verses.length ? <>First named in {refLabel(verses[0], bookName)}</> : null}>
        <div className="entity__cards">
          {verses.slice(0, versesShown).map((r) => <ScriptureCard key={`${r.slug}/${r.chapter}/${r.from}`} at={r} label={refLabel(r, bookName)} />)}
        </div>
        <EntityMore shown={versesShown} total={verses.length} step={VERSES_MORE} onMore={setVersesShown} />
      </EntitySection>

      <p className="entity__source">Names, region and verses: <button type="button" onClick={() => openLink(d.source.url)}>{d.source.name}</button> ({d.source.license}).</p>
    </Screen>
  );
}
