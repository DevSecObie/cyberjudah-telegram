import { useCallback, useEffect, useMemo, useState } from "react";

import { toAppPath } from "@shared/links.mjs";
import { useStored } from "@/tg/hooks";
import { json, store } from "@/tg/store";

/**
 * Study relations, as Bible Strong has them ("Liens entre versets"): a relation joins two
 * endpoints, a passage with another passage, a note, a library entry (a class, a study note,
 * a law, a precept, a case), a dictionary entry or a link, with a type (linked to, refers to,
 * explains, contrasts with, mentions), an optional direction for the directional types, and
 * an optional label. Relations show under the verse they touch, as tags, or as a count badge.
 *
 * Storage: CloudStorage, one key per chapter (`rel_<book>_<chapter>`) holding every relation
 * with a passage endpoint in that chapter; a passage-to-passage relation across chapters is
 * written under both, with the same id, so each end shows it.
 */
export type RelationType = "linked" | "references" | "explains" | "contrasts" | "mentions";
export type RelationDirection = "none" | "forward" | "backward";
export type VerseEndpoint = { type: "verse"; verseKeys: string[]; label: string };
export type NoteEndpoint = { type: "note"; verseKey: string; label: string };
export type EntryEndpoint = { type: "entry"; url: string; kind: string; label: string };
export type DictionaryEndpoint = { type: "dictionary"; slug: string; label: string };
export type LinkEndpoint = { type: "link"; url: string; label: string };
export type Endpoint = VerseEndpoint | NoteEndpoint | EntryEndpoint | DictionaryEndpoint | LinkEndpoint;
export type Relation = { id: string; type: RelationType; direction: RelationDirection; endpoints: [Endpoint, Endpoint]; label?: string; createdAt: number; updatedAt: number };

export const RELATION_TYPES: RelationType[] = ["linked", "references", "explains", "contrasts", "mentions"];
const DIRECTIONAL: RelationType[] = ["references", "explains", "mentions"];
export const isDirectional = (t: RelationType) => DIRECTIONAL.includes(t);

/** The wording, exactly as Bible Strong's: the short form on a tag, the sentence form on a row. */
const TYPE_TEXT: Record<string, string> = { linked: "linked to", references: "refers to", explains: "explains", contrasts: "contrasts with", mentions: "mentions", referencedBy: "referenced by", explainedBy: "explained by", mentionedBy: "mentioned by" };
const TITLE_TEXT: Record<string, string> = { linked: "is linked to", references: "refers to", explains: "explains", contrasts: "contrasts with", mentions: "mentions", referencedBy: "is referenced by", explainedBy: "is explained by", mentionedBy: "is mentioned by" };
const PASSIVE: Record<string, string> = { references: "referencedBy", explains: "explainedBy", mentions: "mentionedBy" };
export const ENDPOINT_TYPE_LABEL: Record<Endpoint["type"], string> = { verse: "Scripture", note: "Note", entry: "Library", dictionary: "Dictionary", link: "Link" };

export const verseKey = (slug: string, ch: number, v: number) => `${slug}-${ch}-${v}`;
export const parseVerseKey = (k: string) => { const m = /^(.+)-(\d+)-(\d+)$/.exec(k); return m ? { slug: m[1], chapter: +m[2], verse: +m[3] } : null; };

export function identity(e: Endpoint): string {
  switch (e.type) {
    case "verse": return `verse:${[...e.verseKeys].sort(byKey).join("/")}`;
    case "note": return `note:${e.verseKey}`;
    case "entry": return `entry:${e.url}`;
    case "dictionary": return `dictionary:${e.slug}`;
    case "link": return `link:${e.url}`;
  }
}
const byKey = (a: string, b: string) => { const x = parseVerseKey(a), y = parseVerseKey(b); return !x || !y ? a.localeCompare(b) : x.slug.localeCompare(y.slug) || x.chapter - y.chapter || x.verse - y.verse; };
export const endpointsMatch = (a: Endpoint, b: Endpoint) => identity(a) === identity(b);

/** The wording for `relation` seen from `active` (source or target of a directional type). */
export function relationText(r: Relation, active: Endpoint, sentence = false): string {
  const table = sentence ? TITLE_TEXT : TYPE_TEXT;
  if (!isDirectional(r.type)) return table[r.type];
  const activeIsSource = (r.direction !== "backward" && endpointsMatch(active, r.endpoints[0])) || (r.direction === "backward" && endpointsMatch(active, r.endpoints[1]));
  return table[activeIsSource ? r.type : PASSIVE[r.type]];
}
export const otherEnd = (r: Relation, active: Endpoint): Endpoint => (endpointsMatch(r.endpoints[0], active) ? r.endpoints[1] : r.endpoints[0]);

/** Where an endpoint opens: a route in the app, or a URL for links. */
export function endpointHref(e: Endpoint): string {
  switch (e.type) {
    case "verse": { const p = parseVerseKey(e.verseKeys[0])!; const vs = e.verseKeys.map((k) => parseVerseKey(k)!.verse); return `/read/${p.slug}/${p.chapter}?v=${vs.join(",")}`; }
    case "note": { const p = parseVerseKey(e.verseKey)!; return `/read/${p.slug}/${p.chapter}?v=${p.verse}`; }
    case "entry": return toAppPath(e.url) ?? e.url;
    case "dictionary": return `/dictionary/${e.slug}`;
    case "link": return e.url;
  }
}

const chapterKeyOf = (k: string) => { const p = parseVerseKey(k)!; return `rel_${p.slug}_${p.chapter}`; };
/** The chapter keys a relation lives under: every chapter one of its passage endpoints touches. */
function chapterKeys(r: Relation): string[] {
  const keys = new Set<string>();
  for (const e of r.endpoints) { if (e.type === "verse") for (const k of e.verseKeys) keys.add(chapterKeyOf(k)); if (e.type === "note") keys.add(chapterKeyOf(e.verseKey)); }
  return [...keys];
}

async function readChapter(key: string): Promise<Relation[]> { return json.get<Relation[]>(key, []); }
function writeChapter(key: string, list: Relation[]) { if (list.length) json.set(key, list); else store.set(key, null); }

export const newId = () => `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export async function createRelation(endpoints: [Endpoint, Endpoint], type: RelationType = "linked", direction: RelationDirection = "none", label?: string): Promise<Relation | null> {
  if (endpointsMatch(endpoints[0], endpoints[1])) return null;
  const now = Date.now();
  const r: Relation = { id: newId(), type, direction: isDirectional(type) ? (direction === "none" ? "forward" : direction) : "none", endpoints, label: label || undefined, createdAt: now, updatedAt: now };
  for (const key of chapterKeys(r)) {
    const list = await readChapter(key);
    // No duplicate of the same pair and type, as Bible Strong's duplicateKey guards.
    if (list.some((x) => x.type === r.type && pairKey(x) === pairKey(r))) return null;
    writeChapter(key, [...list, r]);
  }
  return r;
}
const pairKey = (r: Relation) => r.endpoints.map(identity).sort().join("|");

export async function updateRelation(r: Relation, changes: Partial<Pick<Relation, "type" | "direction" | "label">>) {
  const next: Relation = { ...r, ...changes, updatedAt: Date.now() };
  next.direction = isDirectional(next.type) ? (next.direction === "none" ? "forward" : next.direction) : "none";
  for (const key of chapterKeys(r)) writeChapter(key, (await readChapter(key)).map((x) => (x.id === r.id ? next : x)));
  return next;
}
export async function deleteRelation(r: Relation) {
  for (const key of chapterKeys(r)) writeChapter(key, (await readChapter(key)).filter((x) => x.id !== r.id));
}

/** A relation as it appears under one verse. */
export type VerseRelationItem = { key: string; relation: Relation; active: VerseEndpoint; target: Endpoint; label: string; updatedAt: number };
const TARGET_ORDER: Record<Endpoint["type"], number> = { note: 0, link: 1, entry: 2, verse: 3, dictionary: 6 };

/** Every relation touching this chapter, and the items to show under each verse. Inline mode anchors a range at its last verse, badge mode at its first (as Bible Strong does). */
export function useChapterRelations(slug: string, ch: number, display: "inline" | "block") {
  const key = `rel_${slug}_${ch}`;
  const [list, , loaded] = useStored<Relation[]>(key, []);
  const items = useMemo(() => {
    const out: Record<number, VerseRelationItem[]> = {};
    for (const r of list) for (const e of r.endpoints) {
      if (e.type !== "verse") continue;
      const anchor = parseVerseKey(display === "inline" ? e.verseKeys[e.verseKeys.length - 1] : e.verseKeys[0]);
      if (!anchor || anchor.slug !== slug || anchor.chapter !== ch) continue;
      const target = otherEnd(r, e);
      (out[anchor.verse] ??= []).push({ key: `${r.id}:${identity(e)}`, relation: r, active: e, target, label: target.label, updatedAt: r.updatedAt });
    }
    for (const v of Object.values(out)) v.sort((a, b) => (TARGET_ORDER[a.target.type] - TARGET_ORDER[b.target.type]) || b.updatedAt - a.updatedAt);
    return out;
  }, [list, slug, ch, display]);
  return { list, items, loaded };
}

/** The relations of one endpoint (exact), plus, for a single verse, those of ranges starting there, in sections. */
export function useEndpointRelations(endpoint: Endpoint | null) {
  const [tick, setTick] = useState(0);
  const [sections, setSections] = useState<{ id: string; title: string; data: { relation: Relation; active: Endpoint; target: Endpoint }[] }[]>([]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!endpoint) return;
    let live = true;
    (async () => {
      const keys = new Set<string>();
      if (endpoint.type === "verse") for (const k of endpoint.verseKeys) keys.add(chapterKeyOf(k));
      else if (endpoint.type === "note") keys.add(chapterKeyOf(endpoint.verseKey));
      else for (const k of await store.keys()) if (k.startsWith("rel_")) keys.add(k);
      const seen = new Set<string>();
      const exact: { relation: Relation; active: Endpoint; target: Endpoint }[] = [];
      const starting = new Map<string, { title: string; data: typeof exact }>();
      for (const key of keys) for (const r of await readChapter(key)) {
        if (seen.has(r.id)) continue; seen.add(r.id);
        const active = r.endpoints.find((e) => endpointsMatch(e, endpoint));
        if (active) { exact.push({ relation: r, active, target: otherEnd(r, active) }); continue; }
        if (endpoint.type === "verse" && endpoint.verseKeys.length === 1) {
          const e = r.endpoints.find((x): x is VerseEndpoint => x.type === "verse" && x.verseKeys[0] === endpoint.verseKeys[0]);
          if (e) { const s = starting.get(identity(e)) ?? { title: e.label, data: [] }; s.data.push({ relation: r, active: e, target: otherEnd(r, e) }); starting.set(identity(e), s); }
        }
      }
      if (!live) return;
      setSections([{ id: "exact", title: "", data: exact.sort((a, b) => b.relation.updatedAt - a.relation.updatedAt) }, ...[...starting.entries()].map(([id, s]) => ({ id, ...s }))].filter((s) => s.data.length || s.id === "exact"));
    })();
    return () => { live = false; };
  }, [endpoint ? identity(endpoint) : "", tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { sections, reload, count: sections.reduce((n, s) => n + s.data.length, 0) };
}

export const useRelationsDisplay = () => useStored<"inline" | "block">("relations-display", "inline");

/** Bible Strong's truncate: whole words up to `max`, then an ellipsis. */
export function truncate(str: string, max: number): string {
  if (!str || str.length <= max) return str;
  const clean = str.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = max; while (cut > 0 && clean[cut] && clean[cut] !== " ") cut--;
  return (cut === 0 ? clean.slice(0, max) : clean.slice(0, cut)) + "...";
}

/** Relations are stored at both ends; count and list each saved link only once. */
export function useSavedRelations() {
  const [rows, setRows] = useState<Relation[]>([]);
  useEffect(() => {
    let live = true;
    const off: (() => void)[] = [];
    const chapters = new Map<string, Relation[]>();
    const update = (key: string, raw: string | null) => {
      if (!live) return;
      try { chapters.set(key, JSON.parse(raw ?? "[]") as Relation[]); } catch { chapters.set(key, []); }
      const unique = new Map<string, Relation>();
      for (const list of chapters.values()) for (const row of list) unique.set(row.id, row);
      setRows([...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt));
    };
    void store.keys().then(async (keys) => {
      for (const key of keys.filter((k) => k.startsWith("rel_"))) {
        if (!live) return;
        let fresh = false;
        off.push(store.subscribe(key, (raw) => { fresh = true; update(key, raw); }));
        const raw = await store.get(key);
        if (!fresh) update(key, raw);
      }
    }).catch(() => { if (live) setRows([]); });
    return () => { live = false; off.forEach((stop) => stop()); };
  }, []);
  return rows;
}
