import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { data, type StrongsRow } from "@/api/data";
import { useBookmarks, useTags, type Highlight } from "@/bible/store";
import { usePlan } from "@/lib/marks";
import { useSavedRelations } from "@/lib/relations";
import { pickOfDay, pickRandom } from "@/lib/ofday";
import { haptic } from "@/tg/sdk";
import { store } from "@/tg/store";
import { Icon, type IconName } from "@/ui/ui";
import { strongOfDay, useStrongsIndex } from "./Lexicon";

/**
 * Bible Strong's Home widgets (features/home: StrongOfTheDay, NaveOfTheDay, WordOfTheDay,
 * RandomButton, ProfileStats, TimelineWidget), on CyberJudah's resources: the Strong's
 * lexicon, the topics the classes taught, Easton's dictionary, the people of the Bible.
 */

/** Bible Strong's WidgetContainer: a gradient card, the entry in the middle, a shuffle button, the resource's name as its footer. */
export function Widget({ label, title, sub, to, resource, resourceTo, icon, colors, loading, onShuffle }: { label: string; title?: string; sub?: string; to: string; resource: string; resourceTo: string; icon: IconName; colors: [string, string]; loading?: boolean; onShuffle?: () => void }) {
  const navigate = useNavigate();
  return (
    <div className="widget" style={{ background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})` }}>
      {onShuffle ? <button type="button" className="widget__shuffle" aria-label="Another one" onClick={(e) => { e.stopPropagation(); haptic("select"); onShuffle(); }}><Icon name="retry" size={16} /></button> : null}
      <Link to={to} className="widget__body" onClick={() => haptic("select")} aria-busy={loading || undefined}>
        <span className="widget__label">{label}</span>
        {loading ? <span className="widget__title" style={{ opacity: 0.6 }}>…</span> : <><b className="widget__title">{title}</b>{sub ? <span className="widget__sub">{sub}</span> : null}</>}
      </Link>
      <button type="button" className="widget__foot" onClick={() => { haptic("select"); navigate(resourceTo); }}><Icon name={icon} size={16} /> {resource}</button>
    </div>
  );
}

/** Strong of the day, Greek or Hebrew: the word, its meaning, a shuffle, the Lexicon under it. */
export function StrongOfTheDay({ lang }: { lang: "hebrew" | "greek" }) {
  const idx = useStrongsIndex();
  const [row, setRow] = useState<StrongsRow | undefined>();
  useEffect(() => { setRow(strongOfDay(idx.data, lang)); }, [idx.data, lang]);
  const pool = idx.data?.filter((r) => r.n[0] === (lang === "hebrew" ? "H" : "G") && r.count >= 5 && r.def) ?? [];
  const shuffle = () => setRow(pool[pickRandom(pool.length)]);
  const gloss = (row?.def.split(";")[0].replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() ?? "").replace(/^(.{34}[^ ]*) .*$/, "$1…");
  return <Widget label={lang === "hebrew" ? "Hebrew" : "Greek"} title={gloss} sub={row ? `${row.lemma} · ${row.xlit || row.n}` : undefined} to={row ? `/lexicon/${row.n}` : "/lexicon"} resource="Lexicon" resourceTo={`/lexicon?lang=${lang}`} icon="spark" colors={lang === "greek" ? ["rgba(86,204,242,1)", "rgba(47,128,237,1)"] : ["rgba(248,131,121,1)", "rgba(255,77,93,1)"]} loading={idx.isPending} onShuffle={idx.data ? shuffle : undefined} />;
}

/** Topic of the day: what the classes taught on a subject (Bible Strong's NaveOfTheDay, on the classes' own topics). */
export function TopicOfTheDay() {
  const topics = useQuery({ queryKey: ["topics"], queryFn: data.topics, staleTime: Infinity });
  const rows = topics.data?.filter((t) => t.notes >= 2) ?? [];
  const [i, setI] = useState<number | null>(null);
  const at = i ?? pickOfDay(rows.length, 3);
  const t = rows[at];
  return <Widget label="Topic" title={t?.label} sub={t ? `${t.notes} ${t.notes === 1 ? "class" : "classes"}${t.cases ? ` · ${t.cases} cases` : ""}` : undefined} to={t ? `/topics/${t.slug}` : "/topics"} resource="Topics" resourceTo="/topics" icon="tag" colors={["rgba(155,89,182,1)", "rgba(108,52,131,1)"]} loading={topics.isPending} onShuffle={rows.length ? () => setI(pickRandom(rows.length)) : undefined} />;
}

/** Word of the day from Easton's Bible Dictionary (Bible Strong's WordOfTheDay). */
export function WordOfTheDay() {
  const [letter, setLetter] = useState(() => "ABCDEGHJKLMNOPRSTZ"[pickOfDay(18, 4)]);
  const page = useQuery({ queryKey: ["dict", "", letter], queryFn: () => fetch(`/api/dictionary?letter=${letter}`).then((r) => r.json() as Promise<{ rows: { slug: string; term: string }[] }>), staleTime: Infinity });
  const rows = page.data?.rows ?? [];
  const [i, setI] = useState<number | null>(null);
  const row = rows[i ?? pickOfDay(rows.length, 5)];
  const shuffle = () => { if (Math.random() < 0.5 || !rows.length) { setLetter("ABCDEGHJKLMNOPRSTZ"[pickRandom(18)]); setI(null); } else setI(pickRandom(rows.length)); };
  return <Widget label="Word" title={row?.term} sub={row ? "Easton's Bible Dictionary" : undefined} to={row ? `/dictionary/${row.slug}` : "/dictionary"} resource="Dictionary" resourceTo="/dictionary" icon="type" colors={["#ffd255", "#ffbc00"]} loading={page.isPending} onShuffle={shuffle} />;
}

/** A person of the day, out of every named person in the Bible. */
export function PersonOfTheDay() {
  const people = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  const rows = people.data?.filter((p) => p.verses >= 3) ?? [];
  const [i, setI] = useState<number | null>(null);
  const p = rows[i ?? pickOfDay(rows.length, 6)];
  return <Widget label="Person" title={p?.name} sub={p ? (p.description || `${p.verses} verses`).replace(/\.$/, "") : undefined} to={p ? `/person/${p.id}` : "/bible"} resource="People" resourceTo="/people" icon="star" colors={["rgba(46,204,113,1)", "rgba(39,140,90,1)"]} loading={people.isPending} onShuffle={rows.length ? () => setI(pickRandom(rows.length)) : undefined} />;
}

/** Precept of the day: a subject scripture speaks to, out of the precept index. */
export function PreceptOfTheDay() {
  const q = useQuery({ queryKey: ["precepts"], queryFn: data.precepts, staleTime: Infinity });
  const rows = q.data ?? [];
  const [i, setI] = useState<number | null>(null);
  const p = rows[i ?? pickOfDay(rows.length, 7)];
  return <Widget label="Precept" title={p?.title} sub={p ? `${p.refs} ${p.refs === 1 ? "scripture" : "scriptures"}` : undefined} to={p ? `/precepts/${p.slug}` : "/precepts"} resource="Precepts" resourceTo="/precepts" icon="quote" colors={["rgba(0,229,255,.95)", "rgba(0,140,180,1)"]} loading={q.isPending} onShuffle={rows.length ? () => setI(pickRandom(rows.length)) : undefined} />;
}

/** A random chapter of the Bible, at a random verse (Bible Strong's RandomButton on the reader). */
export function useRandomVerse() {
  const navigate = useNavigate();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  return async () => {
    if (!books.data?.length) return;
    haptic("select");
    const b = books.data[pickRandom(books.data.length)];
    const ch = 1 + pickRandom(b.chapters);
    try { const c = await data.chapter(b.slug, ch); navigate(`/read/${b.slug}/${ch}?v=${1 + pickRandom(c.verses.length)}`); } catch { navigate(`/read/${b.slug}/${ch}`); }
  };
}

/** Everything the reader has kept, counted (Bible Strong's ProfileStats): highlights, bookmarks, notes, tags. */
export function useStudyCounts() {
  const [bookmarks] = useBookmarks();
  const [tags] = useTags();
  const [totals, setTotals] = useState<{ highlights: number; notes: number } | null>(null);
  useEffect(() => {
    let live = true;
    const off: (() => void)[] = [];
    const counts = new Map<string, number>();
    const publish = () => { if (live) setTotals({ highlights: [...counts].filter(([k]) => k.startsWith("bs_h_")).reduce((n, [, v]) => n + v, 0), notes: [...counts].filter(([k]) => k.startsWith("bs_n_")).reduce((n, [, v]) => n + v, 0) }); };
    const update = (key: string, raw: string | null) => {
      if (!live) return;
      try { counts.set(key, Object.keys(JSON.parse(raw ?? "{}") as Record<string, Highlight>).length); } catch { counts.set(key, 0); }
      publish();
    };
    void store.keys().then(async (keys) => {
      for (const key of keys.filter((k) => k.startsWith("bs_h_") || k.startsWith("bs_n_"))) {
        if (!live) return;
        let fresh = false;
        off.push(store.subscribe(key, (raw) => { fresh = true; update(key, raw); }));
        const raw = await store.get(key);
        if (!fresh) update(key, raw);
      }
      if (live) publish();
    }).catch(() => { if (live) setTotals({ highlights: 0, notes: 0 }); });
    return () => { live = false; off.forEach((stop) => stop()); };
  }, []);
  return { highlights: totals?.highlights ?? 0, bookmarks: bookmarks.length, notes: totals?.notes ?? 0, tags: Object.keys(tags).length, ready: totals !== null };
}

export function StudyStats({ expanded = false }: { expanded?: boolean }) {
  const c = useStudyCounts();
  const [plan] = usePlan();
  const relations = useSavedRelations();
  const cells: [string, number, string, IconName][] = [
    ["Highlights", c.highlights, "/bookmarks?tab=highlights", "compose"],
    ["Bookmarks", c.bookmarks, "/bookmarks", "bookmark"],
    ["Notes", c.notes, "/bookmarks?tab=notes", "note"],
    ...(expanded ? [["Studies", plan ? 1 : 0, "/plan", "check"], ["Links", relations.length, "/relations", "link"]] as [string, number, string, IconName][] : []),
    ["Tags", c.tags, "/tags", "tag"],
  ];
  return (
    <div className={`stats${expanded ? " stats--six" : ""}`} aria-label="What you have kept">
      {cells.map(([label, n, to, icon]) => <Link key={label} to={to} className="stats__cell" onClick={() => haptic("select")}><span className="stats__value">{expanded ? <Icon name={icon} size={20} /> : null}<b>{n.toLocaleString()}</b></span><small>{label}</small></Link>)}
    </div>
  );
}
