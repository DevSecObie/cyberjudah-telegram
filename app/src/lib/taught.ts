import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { data, verseNumbers, type TaughtPrecept } from "@/api/data";
import { verseKey, type Relation, type VerseEndpoint, type VerseRelationItem } from "./relations";

/**
 * The precepts the classes lined up with a scripture, read from the chapter's concordance
 * and shown as relations under the verse, beside the ones the reader made. They are the
 * library's, not the reader's: no id in CloudStorage, nothing to edit, and the same for
 * everyone. A "precept" row is one taught under this verse; an "opened" row says this verse
 * was the precept when another scripture was opened.
 */
export const slugOfUrl = (url: string) => /^\/bible\/([a-z0-9-]+)\/(\d+)/.exec(url);

export function useTaughtPrecepts(slug: string, ch: number) {
  return useQuery({ queryKey: ["taught", slug, ch], enabled: !!slug && ch > 0, staleTime: 3_600_000, queryFn: () => data.concordance(slug, ch).then((c) => c.precepts ?? []).catch(() => [] as TaughtPrecept[]) });
}

/** The precepts for one verse, deduplicated by the scripture they point to. */
export function preceptsForVerse(rows: TaughtPrecept[] | undefined, verse: number): TaughtPrecept[] {
  const out: TaughtPrecept[] = []; const seen = new Set<string>();
  for (const r of rows ?? []) {
    if (r.verses && !verseNumbers(r.verses).includes(verse)) continue;
    const k = `${r.kind}|${r.ref.url}|${r.note.url}`;
    if (seen.has(k)) continue; seen.add(k); out.push(r);
  }
  return out;
}

/** The precepts as relation items keyed by verse, in the shape the reader draws under a verse. */
export function useTaughtRelations(slug: string, ch: number, display: "inline" | "block"): Record<number, VerseRelationItem[]> {
  const q = useTaughtPrecepts(slug, ch);
  return useMemo(() => {
    const out: Record<number, VerseRelationItem[]> = {};
    const seen = new Set<string>();
    for (const r of q.data ?? []) {
      const m = slugOfUrl(r.ref.url); if (!m) continue;
      const vs = r.verses ? verseNumbers(r.verses) : [];
      if (!vs.length) continue;
      const anchor = display === "inline" ? vs[vs.length - 1] : vs[0];
      const k = `${anchor}|${r.ref.url}`; if (seen.has(k)) continue; seen.add(k);
      const tvs = r.ref.verses ? verseNumbers(r.ref.verses) : [];
      const active: VerseEndpoint = { type: "verse", verseKeys: vs.map((v) => verseKey(slug, ch, v)), label: `${r.ref.book} ${ch}:${r.verses}` };
      const target: VerseEndpoint = { type: "verse", verseKeys: (tvs.length ? tvs : [1]).map((v) => verseKey(m[1], +m[2], v)), label: r.ref.label };
      const relation: Relation = { id: `taught:${slug}-${ch}-${anchor}:${r.ref.url}`, type: "references", direction: r.kind === "precept" ? "forward" : "backward", endpoints: [active, target], label: r.note.label, createdAt: 0, updatedAt: 0 };
      (out[anchor] ??= []).push({ key: relation.id, relation, active, target, label: r.ref.label, updatedAt: 0 });
    }
    return out;
  }, [q.data, slug, ch, display]);
}

/** A relation the library made, as opposed to one the reader made. */
export const isTaught = (r: Relation) => r.id.startsWith("taught:");
