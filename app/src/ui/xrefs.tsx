import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { data, type Book } from "@/api/data";
import { haptic } from "@/tg/sdk";
import { Icon } from "./ui";

/**
 * A verse's cross references, under the verse: chips for each related passage, and a tap
 * unfolds that verse's text right there, so the connection reads without leaving the
 * chapter. Chapters are fetched once and shared with the reader's own cache.
 */
export function Xrefs({ refs, books }: { refs: [string, number, number][]; books: Book[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const name = (s: string) => books.find((b) => b.slug === s)?.book ?? s;
  const shown = all ? refs : refs.slice(0, 6);
  return (
    <span className="xrefs">
      {shown.map(([s, c, v]) => {
        const id = `${s}/${c}/${v}`;
        return (
          <span key={id} className="xref" data-open={open === id ? "" : undefined}>
            <button type="button" className="xref__chip" aria-expanded={open === id} onClick={() => { haptic("select"); setOpen(open === id ? null : id); }}>{name(s)} {c}:{v}</button>
            {open === id ? <XrefText slug={s} chapter={c} verse={v} label={`${name(s)} ${c}:${v}`} /> : null}
          </span>
        );
      })}
      {refs.length > 6 && !all ? <button type="button" className="xref__chip xref__chip--more" onClick={() => setAll(true)}>+{refs.length - 6} more</button> : null}
    </span>
  );
}

function XrefText({ slug, chapter, verse, label }: { slug: string; chapter: number; verse: number; label: string }) {
  const q = useQuery({ queryKey: ["chapter", slug, chapter], queryFn: () => data.chapter(slug, chapter), staleTime: Infinity });
  const row = q.data?.verses.find((x) => x.verse === verse);
  return (
    <span className="xref__text">
      {q.isPending ? <span className="skel" style={{ width: "70%" }} /> : row ? <><sup>{verse}</sup>{row.text}</> : <em>Not found.</em>}
      <Link to={`/read/${slug}/${chapter}?v=${verse}`} className="xref__go" aria-label={`Open ${label}`}>Open <Icon name="chevron" size={12} /></Link>
    </span>
  );
}
