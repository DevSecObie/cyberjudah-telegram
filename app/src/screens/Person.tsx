import { CmsEditLink } from "@/admin/EditLink";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { data, fmtDate, type Person as P } from "@/api/data";
import { Feather } from "@/bible/icons";
import { useKeptScroll, useVisitState } from "@/lib/place";
import { teacherRank } from "@/lib/taught";
import { useBackButton } from "@/tg/hooks";
import { haptic, openLink } from "@/tg/sdk";
import { avatarKind, EntityAvatar } from "@/ui/avatar";
import { refLabel, refOfLink, refOfPath, ScriptureCard, usePassage, type VerseRef } from "@/ui/scripture";
import { Empty, Screen } from "@/ui/ui";
import { CaseCard } from "./Cases";
import { FamilyGraph, relationsOf } from "./FamilyGraph";

/**
 * A person of the Bible, laid out as Bible Strong's entity page (StrongEntityPage): the summary
 * card (their picture, what they are, their name and their Strong's numbers, then who they were),
 * the Relationships graph under a rule, and then, as cards with the King James text, what the
 * classes taught where they come up (the Bishops' and Deacons' first) and every verse that names
 * them. Each card goes to its verse. Names, family and verses are STEPBible's TIPNR (CC BY 4.0).
 */
const TAUGHT_FIRST = 3, TAUGHT_MORE = 6, VERSES_FIRST = 5, VERSES_MORE = 10;
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export function Person() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  useBackButton(false);
  const p = useQuery({ queryKey: ["person", id], queryFn: () => data.person(id), staleTime: Infinity, retry: 1 });
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [taughtShown, setTaughtShown] = useVisitState("taught", TAUGHT_FIRST);
  const [versesShown, setVersesShown] = useVisitState("verses", VERSES_FIRST);
  useKeptScroll(!!p.data && !!books.data);

  if (p.isPending) return <Screen className="entity"><EntitySkeleton /></Screen>;
  if (p.isError || !p.data) return (
    <Screen className="entity">
      <Empty title="This person did not load" action={{ label: "Try again", onClick: () => void p.refetch() }}>Check your connection, or <Link to="/people">browse everyone</Link>.</Empty>
    </Screen>
  );
  const d: P = p.data;
  const bookName = (slug: string) => books.data?.find((b) => b.slug === slug)?.book ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const verses = d.verses.map(refOfPath).filter((r): r is VerseRef => !!r);
  const taught = [...d.taught].sort((a, b) => teacherRank(a.note.teacher) - teacherRank(b.note.teacher) || b.note.date.localeCompare(a.note.date));
  const kind = avatarKind(d.type);
  const eyebrow = [d.type === "Female" ? "Woman" : d.type === "Male" ? "Man" : d.type === "Angel" ? "Angel" : kind === "group" ? "Group" : "Person", d.tribe].filter(Boolean).join(" · ");

  return (
    <Screen className="entity">
      <header className="entity__summary">
        <div className="entity__id">
          <EntityAvatar id={d.id} name={d.name} kind={kind} src={d.image?.src} size={48} />
          <div>
            <p className="entity__eyebrow">{eyebrow}</p>
            <h1 className="entity__name">{d.name}</h1>
            <StrongChips person={d} first={verses[0] ?? null} />
          </div>
        </div>
        <CmsEditLink kind="people" id={d.id} />
        {d.image ? <p className="hint">{d.image.caption} · {d.image.credit} · <a href={d.image.sourceUrl} target="_blank" rel="noopener noreferrer">{d.image.license}</a></p> : null}
        {d.description ? <p className="entity__desc">{d.description}.</p> : null}
        {d.names.length > 1 ? <p className="entity__aka">Also called {d.names.filter((n) => n !== d.name).join(", ")}</p> : null}
      </header>

      {relationsOf(d).length ? (
        <EntitySection title="Relationships">
          <FamilyGraph person={d} onOpenProfile={(pid) => { haptic("select"); navigate(`/person/${pid}`); }} />
        </EntitySection>
      ) : null}

      {d.cases?.length ? (
        <EntitySection title="Related case studies" count={d.cases.length}>
          <div className="entity__cards">
            {d.cases.map((c) => <CaseCard key={c.slug} to={c.url} name={c.name} preview={c.preview} kind={c.kind} meta={[c.kind === "blessing" ? "Blessing" : "Judgment", c.era, c.verdictLabel].join(" · ")} />)}
          </div>
        </EntitySection>
      ) : null}

      <EntitySection title="What the classes taught" count={taught.length}>
        {taught.length ? (
          <div className="entity__cards">
            {taught.slice(0, taughtShown).map((t, i) => {
              const at = refOfLink(t.url, t.verse);
              if (!at) return null;
              const watch = t.video ? () => { haptic("select"); openLink(`https://www.youtube.com/watch?v=${t.video}${t.t ? `&t=${t.t}s` : ""}`); } : null;
              return (
                <ScriptureCard key={`${t.note.url}:${i}`} at={at} label={t.verse || refLabel(at, bookName)}
                  extra={watch ? <button type="button" className="scard__act" onClick={watch}><Feather name="play" size={14} color="currentColor" />Watch{t.ts ? ` from ${t.ts}` : ""}</button> : null}>
                  <Teaching points={t.points} verse={at} />
                  <p className="scard__src">
                    <Link to={`/note${t.note.url}${t.t ? `?t=${t.t}` : ""}`} onClick={() => haptic("select")}>{t.note.label}</Link>
                    <span>{[t.note.teacher, t.note.date ? fmtDate(t.note.date) : ""].filter(Boolean).join(" · ")}</span>
                  </p>
                </ScriptureCard>
              );
            })}
          </div>
        ) : <p className="entity__empty">No class has taught on {d.name} by name yet.</p>}
        <More shown={taughtShown} total={taught.length} step={TAUGHT_MORE} onMore={setTaughtShown} />
      </EntitySection>

      <EntitySection title="Verses" count={verses.length} note={verses.length ? <>First named in {refLabel(verses[0], bookName)}</> : null}>
        <div className="entity__cards">
          {verses.slice(0, versesShown).map((r) => <ScriptureCard key={`${r.slug}/${r.chapter}/${r.from}`} at={r} label={refLabel(r, bookName)} />)}
        </div>
        <More shown={versesShown} total={verses.length} step={VERSES_MORE} onMore={setVersesShown} />
      </EntitySection>

      <p className="entity__source">Names, family and verses: <button type="button" onClick={() => openLink(d.source.url)}>{d.source.name}</button> ({d.source.license}).</p>
    </Screen>
  );
}

/** Bible Strong's StrongEditorialSection: a rule, the title as an eyebrow, the content. */
function EntitySection({ title, count, note, children }: { title: string; count?: number; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="entity__section" aria-label={title}>
      <h2 className="entity__eyebrow">{title}{count ? <span> · {count.toLocaleString()}</span> : null}</h2>
      {note ? <p className="entity__note">{note}</p> : null}
      {children}
    </section>
  );
}

function More({ shown, total, step, onMore }: { shown: number; total: number; step: number; onMore: (n: number) => void }) {
  if (shown >= total) return null;
  const next = Math.min(step, total - shown);
  return <button type="button" className="entity__more" onClick={() => { haptic("select"); onMore(shown + next); }}>Show {next} more<span> · {(total - shown).toLocaleString()} left</span></button>;
}

/** What a class drew from the verse: their points, leaving out one that only repeats the verse. */
function Teaching({ points, verse }: { points: string[]; verse: VerseRef }) {
  const text = fold(usePassage(verse).verses.map((v) => v.text).join(" "));
  const own = points.filter((pt) => { const f = fold(pt); return f && !(text && (f === text || text.includes(f))); });
  return own.length ? <ul className="scard__points">{own.map((pt, j) => <li key={j}>{pt}</li>)}</ul> : null;
}

/** The person's Strong's numbers, as Bible Strong shows them under the name: from the words of the verse that first names them. */
function StrongChips({ person, first }: { person: P; first: VerseRef | null }) {
  const p = usePassage(first);
  const names = new Set(person.names.map((n) => fold(n)));
  const codes = [...new Set(p.verses.flatMap((v) => ((v as { words?: [string, string[]][] }).words ?? [])
    .filter(([w]) => fold(w).split(" ").some((t) => names.has(t)))
    .flatMap(([, c]) => c.filter((x) => /^[HG]\d+$/.test(x)))))].slice(0, 3);
  if (!codes.length) return null;
  return (
    <div className="entity__codes">
      {codes.map((c) => <Link key={c} to={`/lexicon/${c}`} className="entity__code" aria-label={`Strong's ${c}`} onClick={() => haptic("select")}>{c}<Feather name="chevron-right" size={10} color="currentColor" /></Link>)}
    </div>
  );
}

function EntitySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="entity__id"><span className="skel" style={{ width: 48, height: 48, borderRadius: 24 }} /><div style={{ flex: 1, display: "grid", gap: 8 }}><span className="skel" style={{ width: 70, height: 10 }} /><span className="skel" style={{ width: "46%", height: 22 }} /></div></div>
      <span className="skel" style={{ width: "82%", height: 14, marginTop: 16 }} />
      {[0, 1].map((i) => <div key={i} className="scard" style={{ marginTop: 28 }}><span className="skel" style={{ width: 120, height: 14 }} /><div className="scard__text scard__text--wait"><span className="skel" /><span className="skel" /></div></div>)}
    </div>
  );
}
