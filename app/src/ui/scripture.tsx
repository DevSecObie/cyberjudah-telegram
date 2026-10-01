import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { data } from "@/api/data";
import { Feather } from "@/bible/icons";
import { haptic } from "@/tg/sdk";

/** A place in the Bible: a verse, or a run of verses in one chapter. */
export type VerseRef = { slug: string; chapter: number; from: number; to: number };

/** "genesis/12/1" (a person's verses) as a place. */
export function refOfPath(path: string): VerseRef | null {
  const [slug, c, v] = path.split("/"); const chapter = +c, from = +v;
  return slug && chapter && from ? { slug, chapter, from, to: from } : null;
}

/** A class's link to a verse ("/bible/genesis/12#v1") and its label ("Genesis 12:1-3") as a place. */
export function refOfLink(url: string, label = ""): VerseRef | null {
  const m = /\/bible\/([a-z0-9-]+)\/(\d+)#v(\d+)/.exec(url); if (!m) return null;
  const from = +m[3]; const range = /:(\d+)\s*[-–]\s*(\d+)\s*$/.exec(label);
  const to = range && +range[1] === from && +range[2] > from ? Math.min(+range[2], from + 12) : from;
  return { slug: m[1], chapter: +m[2], from, to };
}

export const refLabel = (r: VerseRef, bookName: (slug: string) => string) => `${bookName(r.slug)} ${r.chapter}:${r.from}${r.to > r.from ? `–${r.to}` : ""}`;
/** The reader, opened on the passage with its verses picked out. */
export const refHref = (r: VerseRef) => `/read/${r.slug}/${r.chapter}?v=${r.from}${r.to > r.from ? `-${r.to}` : ""}`;

/** The text of a passage, from its chapter (shared with the reader's cache). */
export function usePassage(r: VerseRef | null) {
  const q = useQuery({ queryKey: ["chapter", r?.slug, r?.chapter], queryFn: () => data.chapter(r!.slug, r!.chapter), enabled: !!r, staleTime: Infinity });
  const verses = r ? (q.data?.verses ?? []).filter((v) => v.verse >= r.from && v.verse <= r.to) : [];
  return { ...q, verses };
}

/**
 * A scripture card: the reference, the King James text, and "Go to verse", which opens the passage
 * in the reader with its verses picked out. Whatever else belongs with the verse (what a class
 * taught on it, a link to the class) goes in between.
 */
export function ScriptureCard({ at, label, children, extra, verses, href }: { at: VerseRef; label: string; children?: ReactNode; extra?: ReactNode; verses?: { verse: number; text: string }[]; href?: string }) {
  // The text where the page already has it (a case's scripture), else from its chapter.
  const fetched = usePassage(verses?.length ? null : at);
  const p = verses?.length ? { ...fetched, isPending: false, isError: false, verses } : fetched;
  const many = p.verses.length > 1;
  return (
    <article className="scard" aria-label={label}>
      <header className="scard__head"><h3 className="scard__ref">{label}</h3><span className="scard__ver">KJV</span></header>
      {p.isPending ? (
        <div className="scard__text scard__text--wait" aria-busy="true" aria-label="Loading the verse"><span className="skel" /><span className="skel" /><span className="skel" /></div>
      ) : p.isError || !p.verses.length ? (
        <p className="scard__fail" role="status">This verse did not load. <button type="button" onClick={() => { haptic("select"); void p.refetch(); }}>Try again</button></p>
      ) : (
        <p className="scard__text">{p.verses.map((v) => <span key={v.verse}>{many ? <sup>{v.verse}</sup> : null}{v.text}{" "}</span>)}</p>
      )}
      {children}
      <footer className="scard__foot">
        {extra}
        <Link to={href ?? refHref(at)} className="scard__go" aria-label={`Go to verse: ${label}`} onClick={() => haptic("select")}>Go to verse<Feather name="chevron-right" size={16} color="currentColor" /></Link>
      </footer>
    </article>
  );
}
