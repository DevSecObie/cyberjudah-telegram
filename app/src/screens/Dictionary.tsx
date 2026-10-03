import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { share } from "@/lib/share";
import { Chip, Chips, Empty, List, Row, Screen, SearchField, Section, Skeleton } from "@/ui/ui";

type RowT = { slug: string; term: string };
type Page = { count: number; page: number; pages: number; rows: RowT[]; related: RowT[]; total: number };
type Entry = { slug: string; term: string; definitions: string[] };
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const STOP = new Set("the and for that with unto them they thou thee thy his him her she you your our this these those from into upon shall will hath have had not but which whom who whose what when where there their were was are had said saith came come went also then than all any every because before after more most such very over under out off yet let did doth till until against among".split(" "));

/**
 * Easton's Bible Dictionary: names, places, words. Opened from a verse (`?from=` carries
 * the verse text: the words in it that have entries are offered first), by letter, or by
 * search. Entries cite scripture in the dictionary's own abbreviated form.
 */
export function Dictionary() {
  useBackButton(false);
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? "";
  const letter = params.get("letter") ?? "";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const page = useQuery({ queryKey: ["dict", debounced, letter], queryFn: () => fetch(`/api/dictionary?q=${encodeURIComponent(debounced)}&letter=${letter}`).then((r) => r.json() as Promise<Page>), enabled: !!(debounced || letter) });
  // From a verse: try each word that might be a name or a term.
  const words = useMemo(() => [...new Set(from.replace(/[^A-Za-z' ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase())))].slice(0, 40), [from]);
  const found = useQuery({ queryKey: ["dict-from", words.join(",")], enabled: words.length > 0, queryFn: async () => {
    const hits = await Promise.all(words.map((w) => fetch(`/api/dictionary/lookup?word=${encodeURIComponent(w)}`).then((r) => (r.ok ? (r.json() as Promise<Entry>) : null)).catch(() => null)));
    const seen = new Set<string>();
    return hits.filter((h): h is Entry => !!h && !seen.has(h.slug) && seen.add(h.slug) !== undefined);
  } });
  return (
    <Screen title="Dictionary" kicker="Easton's Bible Dictionary · 3,963 entries">
      <SearchField id="dict-q" value={q} onChange={(v) => { setQ(v); if (letter) setParams({}, { replace: true }); }} placeholder="A name, a place, a word" autoFocus={!from && !letter} />
      {!q && !letter && !from ? <div className="letters">{LETTERS.map((l) => <button key={l} type="button" aria-pressed={letter === l} onClick={() => setParams({ letter: l }, { replace: true })}>{l}</button>)}</div> : null}
      {letter ? <Chips><Chip on onClick={() => setParams({}, { replace: true })}>{letter} ×</Chip></Chips> : null}
      {from && !q ? (
        <Section title="In These Verses">
          {found.isPending ? <Skeleton rows={3} /> : !found.data?.length ? <Empty title="No dictionary entry for these words">Search for a name or a place instead.</Empty> : <List>{found.data.map((e) => <Row key={e.slug} href={`/dictionary/${e.slug}`} title={e.term} sub={e.definitions[0]} />)}</List>}
        </Section>
      ) : null}
      {(debounced || letter) ? (page.isPending ? <Skeleton rows={8} /> : page.data ? (
        <>
          {page.data.rows.length ? <Section title={`${page.data.count} entries`}><List>{page.data.rows.map((r) => <Row key={r.slug} href={`/dictionary/${r.slug}`} title={r.term} />)}</List></Section> : <Empty title={`No entry called “${debounced}”`} />}
          {page.data.related.length ? <Section title="Mentioned in"><List>{page.data.related.map((r) => <Row key={r.slug} href={`/dictionary/${r.slug}`} title={r.term} />)}</List></Section> : null}
        </>
      ) : null) : null}
    </Screen>
  );
}

export function DictionaryEntry() {
  const { slug = "" } = useParams();
  useBackButton(false);
  const e = useQuery({ queryKey: ["dict-entry", slug], queryFn: () => fetch(`/api/dictionary/${slug}`).then((r) => r.json() as Promise<Entry>) });
  useBottomButtons(e.data ? { text: "Share", onClick: () => void share({ kind: "note", title: `${e.data!.term} · Easton's Bible Dictionary`, text: e.data!.definitions[0].slice(0, 300), sitePath: `/dictionary/${slug}` }) } : null);
  if (e.isPending) return <Screen title="…"><Skeleton rows={3} /></Screen>;
  if (!e.data?.term) return <Screen title="Dictionary"><Empty title="This entry did not load" /></Screen>;
  return (
    <Screen title={e.data.term} kicker="Easton's Bible Dictionary">
      <div className="dict">{e.data.definitions.map((d, i) => <p key={i}>{d}</p>)}</div>
      <p className="hint">Easton's Bible Dictionary, 1897, public domain.</p>
    </Screen>
  );
}
