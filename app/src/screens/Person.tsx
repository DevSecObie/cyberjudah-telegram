import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { data, fmtDate, type Person as P } from "@/api/data";
import { teacherRank } from "@/lib/taught";
import { useBackButton } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { Empty, Screen, Section, Skeleton } from "@/ui/ui";
import { FamilyGraph, relationsOf } from "./FamilyGraph";

/**
 * A person of the Bible: their names, family and every verse they are named in (from
 * STEPBible's TIPNR, CC BY 4.0), and first what the classes taught where they come up, the
 * Bishops' and Deacons' teaching before everyone else's.
 */
export function Person() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useBackButton(false);
  const p = useQuery({ queryKey: ["person", id], queryFn: () => data.person(id), staleTime: Infinity });
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [all, setAll] = useState(false);
  const [allTaught, setAllTaught] = useState(false);
  if (p.isPending) return <Screen title="…"><Skeleton rows={4} /></Screen>;
  if (!p.data) return <Screen title="People"><Empty title="This person did not load" /></Screen>;
  const d: P = p.data;
  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug;
  const read = (ref: string) => { const [s, c, v] = ref.split("/"); haptic("select"); navigate(`/read/${s}/${c}?v=${v}`); };
  const taught = [...d.taught].sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher) || b.note.date.localeCompare(a.note.date));
  // Every verse, grouped by book in order.
  const groups: [string, string[]][] = [];
  for (const ref of d.verses) { const s = ref.split("/")[0]; const g = groups[groups.length - 1]; if (g && g[0] === s) g[1].push(ref); else groups.push([s, [ref]]); }
  const shown = all ? groups : groups.slice(0, 6);

  return (
    <Screen>
      <header className="person__card">
        <EntityAvatar name={d.name} kind={avatarKind(d.type)} size={64} />
        <div>
          <small className="person__eyebrow">{[d.type === "Female" ? "Woman" : d.type === "Male" ? "Man" : "Person", d.tribe].filter(Boolean).join(" · ")}</small>
          <h1>{d.name}</h1>
          {d.description ? <p>{d.description}</p> : null}
          {d.names.length > 1 ? <p className="person__aka">Also called {d.names.filter((n) => n !== d.name).join(", ")}</p> : null}
          <button type="button" className="person__first" onClick={() => read(d.verses[0])} disabled={!d.verses.length}>
            First named in {d.verses.length ? (() => { const [s0, c, v] = d.verses[0].split("/"); return `${bookName(s0)} ${c}:${v}`; })() : "—"} · {d.verses.length} {d.verses.length === 1 ? "verse" : "verses"}
          </button>
        </div>
      </header>

      {relationsOf(d).length ? (
        <Section title="Relationships">
          <FamilyGraph person={d} onOpenProfile={(pid) => navigate(`/person/${pid}`)} />
        </Section>
      ) : null}

      <Section title={taught.length ? `What the classes taught (${taught.length})` : "What the classes taught"}>
        {taught.length ? (
          <div className="person__taught">
            {(allTaught ? taught : taught.slice(0, 6)).map((t, i) => (
              <div key={i} className="person__teach">
                <button type="button" className="person__verse" onClick={() => { const m = /\/bible\/([a-z0-9-]+)\/(\d+)#v(\d+)/.exec(t.url); if (m) read(`${m[1]}/${m[2]}/${m[3]}`); }}>{t.verse}</button>
                <ul>{t.points.map((pt, j) => <li key={j}>{pt}</li>)}</ul>
                <p className="person__src">
                  {t.note.label}{t.note.date ? ` · ${fmtDate(t.note.date)}` : ""}{t.note.teacher ? ` · ${t.note.teacher}` : ""}
                  {t.video ? <button type="button" onClick={() => openLink(`https://www.youtube.com/watch?v=${t.video}${t.t ? `&t=${t.t}s` : ""}`)}> · Watch from {t.ts || "the start"}</button> : null}
                </p>
              </div>
            ))}
          </div>
        ) : <p className="hint">No class has taught about {d.name} by name yet.</p>}
        {!allTaught && taught.length > 6 ? <button type="button" className="person__more" onClick={() => setAllTaught(true)}>Show all {taught.length}</button> : null}
      </Section>

      <Section title={`Every verse (${d.verses.length})`}>
        <div className="person__verses">
          {shown.map(([slug, refs]) => (
            <div key={slug} className="person__book">
              <small>{bookName(slug)}</small>
              <div>{refs.map((r) => { const [, c, v] = r.split("/"); return <button key={r} type="button" onClick={() => read(r)}>{c}:{v}</button>; })}</div>
            </div>
          ))}
        </div>
        {!all && groups.length > 6 ? <button type="button" className="person__more" onClick={() => setAll(true)}>Show all {groups.length} books</button> : null}
      </Section>

      <p className="hint">Names, family and verses: {d.source.name} ({d.source.license}).</p>
    </Screen>
  );
}
