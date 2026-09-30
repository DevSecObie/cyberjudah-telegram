import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { data } from "@/api/data";
import { usePeopleNamed } from "@/lib/taught";
import { haptic } from "@/tg/sdk";

/**
 * Bible Strong's ChapterEntities ("In this chapter"), at the end of the chapter: everyone
 * named in it, most named first, each a round initial and a name that opens the person.
 */
export function ChapterPeople({ slug, chapter }: { slug: string; chapter: number }) {
  const navigate = useNavigate();
  const named = usePeopleNamed(slug, chapter);
  const everyone = useQuery({ queryKey: ["people-index"], enabled: !!named.data && Object.keys(named.data).length > 0, staleTime: Infinity, queryFn: () => data.people() });
  if (!named.data || !everyone.data) return null;
  const count = new Map<string, number>();
  for (const ids of Object.values(named.data)) for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  const byId = new Map(everyone.data.map((p) => [p.id, p]));
  const people = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ p: byId.get(id), n })).filter((x): x is { p: NonNullable<typeof x.p>; n: number } => !!x.p);
  if (!people.length) return null;
  return (
    <section className="bs-entities" aria-label="In this chapter">
      <h2 className="bs-entities__title"><span>In this chapter</span></h2>
      <p className="bs-entities__kind">People · {people.length}</p>
      <div className="bs-entities__row">
        {people.map(({ p, n }) => (
          <button key={p.id} type="button" className="bs-entity" onClick={() => { haptic("select"); navigate(`/person/${p.id}`); }} title={p.description}>
            <span className="bs-entity__avatar" aria-hidden="true">{p.name.replace(/[^A-Za-z]/g, "").slice(0, 1) || "?"}</span>
            <b>{p.name}</b>
            <small>{n} {n === 1 ? "verse" : "verses"}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
