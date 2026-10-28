import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";

import { data, type Place as P } from "@/api/data";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { useBackButton } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { EntityAvatar } from "@/ui/avatar";
import { refLabel, refOfPath, ScriptureCard, type VerseRef } from "@/ui/scripture";
import { Empty, Screen } from "@/ui/ui";
import { EntityMore, EntitySection, EntitySkeleton } from "./Person";

/**
 * A place of the Bible, laid out as Bible Strong's entity page (StrongEntityPage) is for a place:
 * the summary card (its picture, "Place", its name, what the King James says of it and the other
 * names it gives it), where it is when Wikidata has the exact place (the pin's point, with its
 * Wikidata link), then every verse that names it, as cards with the King James text. Names and
 * verses are rebuilt from the King James Bible with Apocrypha.
 */
const VERSES_FIRST = 5, VERSES_MORE = 10;

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

  return (
    <Screen className="entity">
      <header className="entity__summary">
        <div className="entity__id">
          <EntityAvatar name={d.name} kind="place" size={48} />
          <div>
            <p className="entity__eyebrow">{["Place", d.region].filter(Boolean).join(" · ")}</p>
            <h1 className="entity__name">{d.name}</h1>
          </div>
        </div>
        {d.description ? <p className="entity__desc">{d.description}.</p> : null}
        {d.names.length > 1 ? <p className="entity__aka">Also called {d.names.filter((n) => n !== d.name).join(", ")}</p> : null}
      </header>

      {d.pin ? (
        <EntitySection title="Where it is">
          <p className="entity__note">
            {Math.abs(d.pin.lat).toFixed(2)}° {d.pin.lat >= 0 ? "N" : "S"}, {Math.abs(d.pin.lon).toFixed(2)}° {d.pin.lon >= 0 ? "E" : "W"} · <button type="button" onClick={() => { haptic("select"); openLink(d.pin!.url); }}>{d.pin.label} on Wikidata</button>
          </p>
        </EntitySection>
      ) : null}

      <EntitySection title="Verses" count={verses.length} note={verses.length ? <>First named in {refLabel(verses[0], bookName)}</> : null}>
        <div className="entity__cards">
          {verses.slice(0, versesShown).map((r) => <ScriptureCard key={`${r.slug}/${r.chapter}/${r.from}`} at={r} label={refLabel(r, bookName)} />)}
        </div>
        <EntityMore shown={versesShown} total={verses.length} step={VERSES_MORE} onMore={setVersesShown} />
      </EntitySection>

      <p className="entity__source">Names and verses from the King James Bible with Apocrypha.{d.pin ? " Location from Wikidata, only where it has the exact place." : ""}</p>
    </Screen>
  );
}
