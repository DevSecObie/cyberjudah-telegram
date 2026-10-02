import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { data } from "@/api/data";
import { referencePath } from "@/screens/Search";
import { RELATION_TYPES, createRelation, deleteRelation, endpointHref, endpointsMatch, isDirectional, parseVerseKey, relationText, updateRelation, useSavedRelations, useEndpointRelations, verseKey, type Endpoint, type Relation, type RelationDirection, type RelationType } from "@/lib/relations";
import { useBackButton, useBottomButtons } from "@/tg/hooks";
import { alert, api, confirm, haptic, openLink } from "@/tg/sdk";
import { store } from "@/tg/store";
import { useModal } from "@/ui/modal";
import { useSheet } from "@/ui/sheet";
import { Empty, Icon, Screen, SearchField, Skeleton } from "@/ui/ui";
import { PreceptsIcon, TargetIcon } from "@/ui/relations";
import { preceptsForVerse, slugOfUrl, useTaughtPrecepts } from "@/lib/taught";
import { fmtDate } from "@/api/data";

/** Parses `?endpoint=` (a verse endpoint as `john-3-16,john-3-17`, or an identity) into an endpoint. */
export function endpointFromParam(p: string | null, books: { slug: string; book: string }[] | undefined): Endpoint | null {
  if (!p) return null;
  if (p.startsWith("note:") && parseVerseKey(p.slice(5))) return { type: "note", verseKey: p.slice(5), label: `Note on ${verseLabel([p.slice(5)], books)}` };
  if (p.startsWith("dictionary:")) return { type: "dictionary", slug: p.slice(11), label: p.slice(11) };
  if (p.startsWith("entry:")) return { type: "entry", url: p.slice(6), kind: "", label: p.slice(6) };
  const keys = p.split(",").filter((k) => parseVerseKey(k));
  if (!keys.length) return null;
  return { type: "verse", verseKeys: keys, label: verseLabel(keys, books) };
}
export function verseLabel(keys: string[], books?: { slug: string; book: string }[]): string {
  const ps = keys.map((k) => parseVerseKey(k)!);
  const name = books?.find((b) => b.slug === ps[0].slug)?.book ?? ps[0].slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const vs = ps.map((p) => p.verse);
  const run = vs.length > 1 && vs[vs.length - 1] - vs[0] === vs.length - 1 ? `${vs[0]}-${vs[vs.length - 1]}` : vs.join(",");
  return `${name} ${ps[0].chapter}:${run}`;
}

/**
 * Relations of one endpoint, as Bible Strong's screen: the endpoint under the title, a "+" to
 * add one, and each relation as a row on a tree line: "<is linked to> [icon] <target>", the
 * target's subtitle, the label. Tapping opens the target; the ··· menu edits (type, direction,
 * label) or deletes.
 */
export function Relations() {
  useBackButton(false);
  const [params] = useSearchParams();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const saved = useSavedRelations();
  const endpoint = useMemo(() => endpointFromParam(params.get("endpoint"), books.data), [params, books.data]);
  const { sections, reload, count } = useEndpointRelations(endpoint);
  // The library's own relations for a verse: the precepts the classes lined up with it.
  const first = endpoint?.type === "verse" ? parseVerseKey(endpoint.verseKeys[0]) : null;
  const taught = useTaughtPrecepts(first?.slug ?? "", first?.chapter ?? 0);
  const precepts = first ? preceptsForVerse(taught.data, first.verse) : [];
  const [picking, setPicking] = useState(false);
  const navigate = useNavigate();
  const sheet = useSheet();
  useBottomButtons(endpoint ? { text: "Add relation", onClick: () => setPicking(true) } : null);

  const open = (e: Endpoint) => { const href = endpointHref(e); if (e.type === "link") openLink(href); else navigate(href); };
  const edit = async (r: Relation, active: Endpoint) => {
    const a = await sheet.open({ title: "Precept", items: [{ id: "edit", text: "Edit", icon: <Icon name="note" size={16} /> }, { id: "delete", text: "Remove", destructive: true }] });
    if (a?.id === "delete") { if (await confirm("Do you want to delete this relation?")) { await deleteRelation(r); haptic("warning"); reload(); } }
    if (a?.id === "edit") {
      // Type cycles through the five kinds; a directional kind can be swapped; a short label.
      const t = await sheet.open({ title: "Edit relation", items: RELATION_TYPES.map((type) => ({ id: type, text: relationText({ ...r, type, direction: "forward" }, active, true), hint: type === r.type ? "current" : undefined })) });
      if (!t) return;
      let direction: RelationDirection = r.direction;
      if (isDirectional(t.id as RelationType)) {
        const d = await sheet.open({ title: "Direction", items: [{ id: "forward", text: `${active.label} ${relationText({ ...r, type: t.id as RelationType, direction: "forward" }, active)} …`, hint: r.direction !== "backward" ? "current" : undefined }, { id: "backward", text: `${active.label} ${relationText({ ...r, type: t.id as RelationType, direction: "backward" }, active)} …`, hint: r.direction === "backward" ? "current" : undefined }] });
        if (!d) return; direction = d.id as RelationDirection;
      }
      const l = await sheet.open({ title: "Label", text: { label: "Short label", value: r.label ?? "", placeholder: "Add a label", submit: "Save" } });
      if (!l) return;
      await updateRelation(r, { type: t.id as RelationType, direction, label: l.value?.slice(0, 80) || undefined });
      haptic("success"); reload();
    }
  };

  if (!endpoint) return <Screen title="Your precepts">{saved.length ? <div className="nt-list">{saved.map((r) => <button type="button" className="nt-item" key={r.id} onClick={() => {
    const e = r.endpoints.find((x) => x.type === "verse" || x.type === "note");
    const key = e?.type === "verse" ? e.verseKeys.join(",") : e?.type === "note" ? `note:${e.verseKey}` : "";
    if (key) navigate(`/relations?endpoint=${encodeURIComponent(key)}`);
  }}><Icon name="precepts" /><span className="nt-item__body"><b>{r.endpoints[0].label}</b><small>{relationText(r, r.endpoints[0])} {r.endpoints[1].label}</small></span><Icon name="chevron" size={18} /></button>)}</div> : <Empty title="No precepts yet" action={{ label: "Open the Bible", href: "/bible" }}>Precept upon precept, line upon line (Isaiah 28:10): join a verse to another passage, a class, a note, a dictionary entry or a link, so they show together when you read. Select a verse and tap Relation to make one. In Telegram they follow your account to every device; in a browser they stay on this device.</Empty>}</Screen>;
  return (
    <Screen title="Precepts" kicker={endpoint.label} action={<button type="button" className="icon-btn" aria-label="Add a precept" onClick={() => setPicking(true)}>+</button>}>
      {!count && !precepts.length ? <div className="rel-empty"><PreceptsIcon size={64} /><p>No precepts yet</p><small>Tap + to join this passage to another passage, a class, a note, a dictionary entry or a link.</small></div> : null}
      {precepts.length ? (
        <div className="rel-section">
          <p className="rel-section__title"><TargetIcon type="entry" /> Taught in class</p>
          {precepts.map((r, i) => { const m = slugOfUrl(r.ref.url); return (
            <div key={i} className="rel-row" data-last={i === precepts.length - 1 ? "" : undefined}>
              <button type="button" className="rel-row__body" onClick={() => (m ? navigate(`/read/${m[1]}/${m[2]}${r.ref.verses ? `?v=${r.ref.verses}` : ""}`) : undefined)}>
                <span className="rel-row__title"><b>{r.kind === "precept" ? "precept" : "opened at"}</b> <TargetIcon type="verse" /> <b>{r.ref.label}</b></span>
                {r.text ? <small>{r.text}</small> : null}
                <small>{r.note.label}{r.note.date ? ` · ${fmtDate(r.note.date)}` : ""}</small>
              </button>
            </div>
          ); })}
        </div>
      ) : null}
      {count ? sections.map((s) => (
        <div key={s.id} className="rel-section">
          {s.title ? <p className="rel-section__title"><TargetIcon type="verse" /> {s.title}</p> : null}
          {s.data.map(({ relation: r, active, target }, i) => (
            <div key={r.id} className="rel-row" data-last={i === s.data.length - 1 ? "" : undefined}>
              <button type="button" className="rel-row__body" onClick={() => open(target)}>
                <span className="rel-row__title"><b>{relationText(r, active, true)}</b> <TargetIcon type={target.type} /> <b>{target.type === "note" ? "a note" : target.label}</b></span>
                {target.type === "note" || target.type === "entry" ? <small>{target.label}</small> : null}
                {r.label ? <small>{r.label}</small> : null}
              </button>
              <button type="button" className="icon-btn" aria-label="Options" onClick={() => void edit(r, active)}>···</button>
            </div>
          ))}
        </div>
      )) : null}
      {picking ? <RelationTargetPicker source={endpoint} onClose={() => setPicking(false)} onCreated={() => { setPicking(false); reload(); }} /> : null}
    </Screen>
  );
}

type Target = { id: string; type: Endpoint["type"]; title: string; subtitle?: string; description?: string; endpoint: Endpoint };
const PREVIEW = 5;

/**
 * Bible Strong's target search sheet: one box ("Passage, note, class, dictionary, link…"),
 * results in sections (Passages, Notes, Library, Dictionary, Links) of five with "See more".
 * A typed reference becomes a passage; a URL becomes a link. Picking a target creates a
 * "linked to" relation with the source and closes.
 */
export function RelationTargetPicker({ source, onClose, onCreated }: { source: Endpoint; onClose: () => void; onCreated: (r: Relation) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [more, setMore] = useState<Record<string, number>>({});
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  // Passages: a reference typed in the box, with the verse text as the description.
  const ref = referencePath(debounced);
  const refKeys = useMemo(() => {
    const m = ref && /^\/bible\/([a-z0-9-]+)\/(\d+)(?:\?v=(\d+)(?:-(\d+))?)?/.exec(ref);
    if (!m) return null;
    const a = m[3] ? +m[3] : 1, b = m[4] ? +m[4] : a;
    return Array.from({ length: Math.max(1, Math.min(b - a + 1, 30)) }, (_, i) => verseKey(m[1], +m[2], a + i));
  }, [ref]);
  const refText = useQuery({ queryKey: ["chapter", refKeys?.[0] && parseVerseKey(refKeys[0])!.slug, refKeys?.[0] && parseVerseKey(refKeys[0])!.chapter], enabled: !!refKeys, queryFn: () => { const p = parseVerseKey(refKeys![0])!; return data.chapter(p.slug, p.chapter); } });
  const library = useQuery({ queryKey: ["search", debounced, ""], enabled: debounced.length >= 2 && !refKeys, queryFn: () => api<{ ok: boolean; hits: { kind: string; title: string; url: string; sub: string; snippet: string }[] }>(`/api/search?q=${encodeURIComponent(debounced)}&limit=8`) });
  const dict = useQuery({ queryKey: ["dict", debounced, ""], enabled: debounced.length >= 2, queryFn: () => fetch(`/api/dictionary?q=${encodeURIComponent(debounced)}`).then((r) => r.json() as Promise<{ rows: { slug: string; term: string }[] }>) });
  const [notes, setNotes] = useState<Target[]>([]);
  useEffect(() => { void store.keys().then(async (keys) => { const out: Target[] = []; for (const k of keys.filter((x) => x.startsWith("nt_"))) { const [, slug, ch] = k.split("_"); try { const v = JSON.parse((await store.get(k)) ?? "{}") as Record<string, string>; for (const [verse, text] of Object.entries(v)) { const key = verseKey(slug, +ch, +verse); out.push({ id: `note:${key}`, type: "note", title: text, subtitle: "Note", description: verseLabel([key], books.data), endpoint: { type: "note", verseKey: key, label: text.slice(0, 60) } }); } } catch { /* ignore */ } } setNotes(out); }); }, [books.data]);

  const sections = useMemo(() => {
    const out: { id: string; title: string; items: Target[] }[] = [];
    if (refKeys) { const verses = refText.data?.verses.filter((v) => refKeys.some((k) => parseVerseKey(k)!.verse === v.verse)); const label = verseLabel(refKeys, books.data); out.push({ id: "passages", title: "Scriptures", items: [{ id: `verse:${refKeys.join(",")}`, type: "verse", title: label, description: verses?.map((v) => v.text).join(" "), endpoint: { type: "verse", verseKeys: refKeys, label } }] }); }
    const lc = debounced.toLowerCase();
    const n = lc ? notes.filter((x) => `${x.title} ${x.description}`.toLowerCase().includes(lc)) : notes;
    if (n.length) out.push({ id: "notes", title: "Notes", items: n });
    const KIND: Record<string, string> = { class: "Sabbath class", captains: "15 Min w/ Captains", history: "Our Hidden History", study: "Study note", encyclopedia: "Encyclopedia", law: "Law", precept: "Precept", case: "Case study", verse: "Scripture" };
    const lib = (library.data?.hits ?? []).filter((h) => h.kind !== "verse").map<Target>((h) => ({ id: `entry:${h.url}`, type: "entry", title: h.title, subtitle: KIND[h.kind] ?? h.kind, description: h.snippet, endpoint: { type: "entry", url: h.url, kind: h.kind, label: h.title } }));
    const versesHits = (library.data?.hits ?? []).filter((h) => h.kind === "verse").map<Target>((h) => { const m = /^\/bible\/([a-z0-9-]+)\/(\d+)#v(\d+)/.exec(h.url); const key = m ? verseKey(m[1], +m[2], +m[3]) : ""; return { id: `verse:${key}`, type: "verse", title: h.title, description: h.snippet, endpoint: { type: "verse", verseKeys: [key], label: h.title } }; }).filter((t) => t.endpoint.type === "verse" && t.endpoint.verseKeys[0]);
    if (versesHits.length && !refKeys) out.push({ id: "passages", title: "Scriptures", items: versesHits });
    if (lib.length) out.push({ id: "library", title: "Library", items: lib });
    const d = (dict.data?.rows ?? []).map<Target>((r) => ({ id: `dictionary:${r.slug}`, type: "dictionary", title: r.term, subtitle: "Dictionary", endpoint: { type: "dictionary", slug: r.slug, label: r.term } }));
    if (d.length) out.push({ id: "dictionary", title: "Dictionary", items: d });
    if (/^https?:\/\/\S+$/i.test(debounced)) { let host = debounced; try { host = new URL(debounced).hostname.replace(/^www\./, ""); } catch { /* keep */ } out.push({ id: "links", title: "Links", items: [{ id: `link:${debounced}`, type: "link", title: host, subtitle: "Link", description: debounced, endpoint: { type: "link", url: debounced, label: host } }] }); }
    return out;
  }, [refKeys, refText.data, books.data, debounced, notes, library.data, dict.data]);

  const pick = async (t: Target) => {
    if (endpointsMatch(source, t.endpoint)) { void alert("A Scripture cannot relate to itself."); return; }
    const r = await createRelation([source, t.endpoint]);
    if (!r) { void alert("This relation already exists."); return; }
    haptic("success"); onCreated(r);
  };
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true, onClose);
  const loading = (refKeys && refText.isPending) || (library.isFetching && !library.data) || (dict.isFetching && !dict.data);
  return (
    <div className="sheet__scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="sheet sheet--tall" role="dialog" aria-modal="true" aria-label="Add relation" data-sheet-open="">
        <div className="sheet__grip" aria-hidden="true" />
        <p className="sheet__title">Add relation<small>{source.label}</small></p>
        <SearchField id="rel-q" value={q} onChange={setQ} placeholder="Scripture, note, class, dictionary, link..." autoFocus />
        <div className="rel-results">
          {!sections.length ? (loading ? <Skeleton rows={3} /> : <div className="rel-empty rel-empty--small"><Icon name="search" size={40} /><p>{debounced ? "No target found" : "Search for a Scripture, a note, a class, a dictionary entry or a link"}</p></div>) : sections.map((s) => {
            const shown = more[s.id] ?? PREVIEW;
            return (
              <section key={s.id} className="rel-section">
                <p className="rel-section__title"><TargetIcon type={s.items[0].type} /> {s.title} <i className="pill">{s.items.length}</i></p>
                {s.items.slice(0, shown).map((t) => (
                  <button key={t.id} type="button" className="rel-result" style={{ borderLeftColor: `var(--rel-${t.type})` }} onClick={() => void pick(t)}>
                    <span className="rel-result__title">{t.title}{t.subtitle && t.type !== "verse" ? <i className="pill">{t.subtitle}</i> : null}</span>
                    {t.description ? <span className="rel-result__desc">{t.description}</span> : null}
                  </button>
                ))}
                {s.items.length > shown ? <button type="button" className="rel-seemore" onClick={() => setMore({ ...more, [s.id]: shown + 10 })}>See more</button> : null}
              </section>
            );
          })}
        </div>
        <button type="button" className="sheet__cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
