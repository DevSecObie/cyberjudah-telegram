import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { data, type Person, type PersonIndexRow } from "@/api/data";
import { Feather, type FeatherName } from "@/bible/icons";
import { haptic } from "@/tg/sdk";
import { avatarKind, EntityAvatar, type AvatarKind } from "@/ui/avatar";

/**
 * Bible Strong's relationship graph (StrongEntityRelationGraph), on our people: the person in the
 * middle, their father, mother, spouses, brothers and sisters and children around them. A tap on
 * one walks the family: they come to the middle with their own family around them, the one you
 * came from left at the opposite side with a way back. More than fit are paged; the footer goes
 * back a step, back to the start, or through the pages; "View profile" opens whoever is in the
 * middle.
 */
type Relation = "father" | "mother" | "partner" | "sibling" | "offspring";
type Rel = { relation: Relation; id: string; name: string };
type Step = { person: Person; via: Rel; position: number; page: number };

const HEIGHT = 410, CENTER_Y = 188, CENTER = 82, NODE = 58, NODE_W = 92;
const PRIORITY: Relation[] = ["father", "mother", "partner", "sibling", "offspring"];
// Where relations go, in order, and the side opposite each place (where the one you came from sits).
const ORDER = [3, 1, 5, 2, 4, 0], OPPOSITE = [5, 4, 3, 2, 1, 0];
const ROOT_PAGE = 6, NESTED_PAGE = 5;
const positionOf = (i: number, w: number) => [
  { x: w / 2, y: 52 }, { x: 54, y: 284 }, { x: w - 54, y: 284 }, { x: 54, y: 92 }, { x: w - 54, y: 92 }, { x: w / 2, y: 324 },
][i] ?? { x: w / 2, y: 324 };
const VISUAL: Record<Relation, { icon: FeatherName; tone: string }> = {
  father: { icon: "arrow-up", tone: "var(--accent)" }, mother: { icon: "arrow-up", tone: "var(--accent)" },
  partner: { icon: "heart", tone: "var(--danger)" }, offspring: { icon: "arrow-down", tone: "var(--success, #34d399)" },
  sibling: { icon: "users", tone: "var(--gold, #f59e0b)" },
};

/** Everyone around a person, in Bible Strong's order, each person once. */
export function relationsOf(p: Person): Rel[] {
  const lists: Record<Relation, Person["father"]> = { father: p.father, mother: p.mother, partner: p.partners, sibling: p.siblings, offspring: p.children };
  const seen = new Set<string>(); const out: Rel[] = [];
  for (const relation of PRIORITY) for (const r of lists[relation]) if (!seen.has(r.id) && r.id !== p.id) { seen.add(r.id); out.push({ relation, id: r.id, name: r.name }); }
  return out;
}

/** What a relation is called, by who they are: a wife or a husband, a brother or a sister, a son or a daughter. */
export function relationLabel(relation: Relation, kind: AvatarKind): string {
  const f = kind === "female", m = kind === "male";
  switch (relation) {
    case "father": return "Father";
    case "mother": return "Mother";
    case "partner": return f ? "Wife" : m ? "Husband" : "Spouse";
    case "sibling": return f ? "Sister" : m ? "Brother" : "Sibling";
    case "offspring": return f ? "Daughter" : m ? "Son" : "Child";
  }
}

export function FamilyGraph({ person, onOpenProfile }: { person: Person; onOpenProfile: (id: string) => void }) {
  const client = useQueryClient();
  const index = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  const types = new Map((index.data ?? []).map((r: PersonIndexRow) => [r.id, r.type]));
  // Who someone is, from the index; where it doesn't say, what their place in the family tells
  // (a father is a man, a man's spouse a woman).
  const kindOf = (id: string, relation?: Relation, of?: Person): AvatarKind => {
    const k = avatarKind(types.get(id));
    if (k !== "other") return k;
    if (relation === "father") return "male";
    if (relation === "mother") return "female";
    if (relation === "partner" && of) { const o = avatarKind(of.type); return o === "male" ? "female" : o === "female" ? "male" : k; }
    return k;
  };

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(330);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => setWidth(el.clientWidth || 330);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [active, setActive] = useState<Person>(person);
  const [history, setHistory] = useState<Step[]>([]);
  const [page, setPage] = useState(0);
  const [scene, setScene] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // A new person on the page (a profile opened from the graph) starts the graph again.
  const [root, setRoot] = useState(person.id);
  if (root !== person.id) { setRoot(person.id); setActive(person); setHistory([]); setPage(0); setScene((n) => n + 1); }

  const prev = history[history.length - 1];
  const previousPosition = prev ? OPPOSITE[prev.position] : undefined;
  const places = ORDER.filter((i) => i !== previousPosition);
  const all = relationsOf(active).filter((r) => r.id !== prev?.person.id);
  const size = prev ? NESTED_PAGE : ROOT_PAGE;
  const pages = Math.max(1, Math.ceil(all.length / size));
  const shownPage = Math.min(page, pages - 1);
  const nodes = all.slice(shownPage * size, shownPage * size + size).map((r, i) => ({ r, position: places[i] }));
  const center = { x: width / 2, y: CENTER_Y };
  if (!relationsOf(person).length) return null;

  const walk = async (r: Rel, position: number) => {
    if (busy) return;
    haptic("select"); setBusy(r.id);
    try {
      const next = await client.fetchQuery({ queryKey: ["person", r.id], queryFn: () => data.person(r.id), staleTime: Infinity });
      setHistory((h) => [...h, { person: active, via: r, position, page: shownPage }]);
      setActive(next); setPage(0); setScene((n) => n + 1);
    } catch { /* the person did not load: stay where we are */ }
    finally { setBusy(null); }
  };
  const back = () => {
    if (!prev) return;
    haptic("select");
    setHistory((h) => h.slice(0, -1)); setActive(prev.person); setPage(prev.page); setScene((n) => n + 1);
  };
  const reset = () => { haptic("select"); setHistory([]); setActive(person); setPage(0); setScene((n) => n + 1); };
  const turn = (p: number) => { haptic("select"); setPage(p); setScene((n) => n + 1); };
  const elsewhere = active.id !== person.id;
  const prevKind: AvatarKind = prev ? (avatarKind(prev.person.type) !== "other" ? avatarKind(prev.person.type) : kindOf(prev.person.id)) : "other";

  return (
    <div className="fg">
      <div ref={box} className="fg__stage" style={{ height: HEIGHT }} aria-label={`The family of ${active.name}`}>
        <svg className="fg__lines" width={width} height={HEIGHT} aria-hidden="true" key={`l${scene}`}>
          {nodes.map(({ r, position }) => { const p = positionOf(position, width); return <line key={r.id} x1={center.x} y1={center.y} x2={p.x} y2={p.y} />; })}
          {prev && previousPosition != null ? (() => { const p = positionOf(previousPosition, width); return <line className="fg__line--back" x1={center.x} y1={center.y} x2={p.x} y2={p.y} />; })() : null}
        </svg>
        <div className="fg__scene" key={scene}>
          {prev && previousPosition != null ? (
            <Satellite at={positionOf(previousPosition, width)} center={center} order={0} id={prev.person.id} name={prev.person.name} kind={prevKind}
              label={relationLabel(inverse(prev.via.relation, prevKind), prevKind)} relation={inverse(prev.via.relation, prevKind)} back onPress={back} />
          ) : null}
          {nodes.map(({ r, position }, i) => {
            const kind = kindOf(r.id, r.relation, active);
            return <Satellite key={r.id} at={positionOf(position, width)} center={center} order={i + 1} id={r.id} name={r.name} kind={kind}
              label={relationLabel(r.relation, kind)} relation={r.relation} loading={busy === r.id} onPress={() => void walk(r, position)} />;
          })}
          <div className="fg__center" style={{ left: center.x - CENTER / 2, top: center.y - CENTER / 2 }}>
            <button type="button" className="fg__node fg__node--center" disabled={!elsewhere} aria-label={elsewhere ? `View ${active.name}'s profile` : active.name}
              onClick={() => { haptic("select"); onOpenProfile(active.id); }}>
              <EntityAvatar id={active.id} name={active.name} kind={avatarKind(active.type) !== "other" ? avatarKind(active.type) : kindOf(active.id)} size={CENTER} />
            </button>
            <div className="fg__label fg__label--center">
              <b>{active.name}</b>
              {elsewhere ? <button type="button" className="fg__chip fg__chip--profile" onClick={() => { haptic("select"); onOpenProfile(active.id); }}>View profile<Feather name="chevron-right" size={10} /></button> : null}
            </div>
          </div>
        </div>
      </div>
      <div className="fg__foot" aria-label={`Page ${shownPage + 1} of ${pages}`}>
        {history.length ? <button type="button" className="fg__hist fg__hist--left" aria-label="Back" onClick={back}><Feather name="arrow-left" size={16} /></button> : null}
        <button type="button" className="fg__page" aria-label="Previous page" disabled={shownPage === 0} onClick={() => turn(shownPage - 1)}><Feather name="chevron-left" size={18} /></button>
        <span>{shownPage + 1} / {pages}</span>
        <button type="button" className="fg__page" aria-label="Next page" disabled={shownPage >= pages - 1} onClick={() => turn(shownPage + 1)}><Feather name="chevron-right" size={18} /></button>
        {history.length ? <button type="button" className="fg__hist fg__hist--right" aria-label={`Start again from ${person.name}`} onClick={reset}><Feather name="rotate-ccw" size={16} /></button> : null}
      </div>
    </div>
  );
}

/** How the one you came from is related to the one in the middle now. */
function inverse(r: Relation, kind: AvatarKind): Relation {
  return r === "father" || r === "mother" ? "offspring" : r === "offspring" ? (kind === "female" ? "mother" : "father") : r;
}

function Satellite({ at, center, order, id, name, kind, label, relation, back, loading, onPress }: {
  at: { x: number; y: number }; center: { x: number; y: number }; order: number; id: string; name: string; kind: AvatarKind; label: string; relation: Relation; back?: boolean; loading?: boolean; onPress: () => void;
}) {
  const v = VISUAL[relation];
  return (
    <div className="fg__sat" style={{ left: at.x - NODE / 2, top: at.y - NODE / 2, ["--fg-dx" as string]: `${center.x - at.x}px`, ["--fg-dy" as string]: `${center.y - at.y}px`, animationDelay: `${order * 35}ms` }}>
      <button type="button" className="fg__node" aria-label={back ? `Back to ${name}` : `${label}, ${name}`} aria-busy={loading || undefined} onClick={onPress}>
        <EntityAvatar id={id} name={name} kind={kind} size={NODE} />
        {back ? <span className="fg__back" aria-hidden="true"><Feather name="chevron-left" size={14} /></span> : null}
      </button>
      <div className="fg__label" style={{ width: NODE_W, marginLeft: (NODE - NODE_W) / 2 }}>
        <b>{name}</b>
        <span className="fg__chip"><span style={{ color: v.tone, display: "inline-flex" }}><Feather name={v.icon} size={10} /></span>{label}</span>
      </div>
    </div>
  );
}
