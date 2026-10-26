import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { data, type Person, type PersonIndexRow } from "@/api/data";
import { Feather, type FeatherName } from "@/bible/icons";
import { haptic } from "@/tg/sdk";
import { avatarKind, EntityAvatar, type AvatarKind } from "@/ui/avatar";
import { advanceMotion, avatarFrame, connectionFrame, createLayers, finishLayers, layerFrame, nodeFrame, transitionLayers, type Motion } from "./family-graph-motion";

/**
 * Bible Strong's relationship graph (StrongEntityRelationGraph), on our people: the person in the
 * middle, their father, mother, spouses, brothers and sisters and children around them. A tap on
 * one walks the family: they come to the middle with their own family around them, the one you
 * came from left at the opposite side with a way back. More than fit are paged; the footer goes
 * back a step, back to the start, or through the pages; "View profile" opens whoever is in the
 * middle.
 */
type Relation = "father" | "mother" | "partner" | "sibling" | "offspring";
type Rel = { relation: Relation; id: string; name: string; image?: Person["image"] };
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
  for (const relation of PRIORITY) for (const r of lists[relation]) if (!seen.has(r.id) && r.id !== p.id) { seen.add(r.id); out.push({ relation, id: r.id, name: r.name, ...(r.image ? { image: r.image } : {}) }); }
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

type Navigation = { active: Person; history: Step[]; page: number };
function buildScene(navigation: Navigation) {
  const { active, history, page } = navigation, prev = history[history.length - 1];
  const previousPosition = prev ? OPPOSITE[prev.position] : undefined;
  const places = ORDER.filter(i => i !== previousPosition), all = relationsOf(active).filter(r => r.id !== prev?.person.id);
  const size = prev ? NESTED_PAGE : ROOT_PAGE, pages = Math.max(1, Math.ceil(all.length / size)), shownPage = Math.min(page, pages - 1);
  const nodes = all.slice(shownPage * size, shownPage * size + size).map((r, i) => ({ r, position: places[i] }));
  return { ...navigation, prev, previousPosition, pages, shownPage, nodes };
}
type Scene = ReturnType<typeof buildScene>;
const motionStyle = (v: ReturnType<typeof nodeFrame>): CSSProperties => ({ opacity: v.opacity, transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})` });
const avatarStyle = (role: "center" | "selected", progress: number): CSSProperties => {
  const frame = avatarFrame(role, progress);
  return { borderWidth: frame.width, borderColor: `color-mix(in srgb, var(--hairline) ${(1 - frame.primary) * 100}%, var(--accent))` };
};

export function FamilyGraph({ person, onOpenProfile }: { person: Person; onOpenProfile: (id: string) => void }) {
  const client = useQueryClient();
  const index = useQuery({ queryKey: ["people-index"], queryFn: data.people, staleTime: Infinity });
  const types = new Map((index.data ?? []).map((r: PersonIndexRow) => [r.id, r.type]));
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
  const [busy, setBusy] = useState<string | null>(null);
  const latestRelationRequestId = useRef(0);
  useEffect(() => () => { latestRelationRequestId.current += 1; }, []);
  const [layers, setLayers] = useState(() => createLayers(buildScene({ active: person, history: [], page: 0 })));
  const [motions, setMotions] = useState<Motion[]>([]);
  const [, frame] = useState(0);
  const [isResetting, setIsResetting] = useState(false);
  const nextMotionId = useRef(0), nextZIndex = useRef(0), resetSequence = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelReset = () => { resetSequence.current++; timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => { resetSequence.current++; timers.current.forEach(clearTimeout); }, []);
  useEffect(() => {
    if (!motions.length) return;
    let id: number;
    const tick = (now: number) => {
      const finished: number[] = [];
      for (const motion of motions) if (advanceMotion(motion, now)) finished.push(motion.id);
      frame(n => n + 1);
      if (finished.length) {
        setMotions(current => current.filter(m => !finished.includes(m.id)));
        setLayers(current => finished.reduce((value, motionId) => finishLayers(value, motionId), current));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [motions]);
  useEffect(() => { if (isResetting && !history.length && !motions.length) setIsResetting(false); }, [isResetting, history.length, motions.length]);
  const [root, setRoot] = useState(person.id);
  useLayoutEffect(() => { resetSequence.current++; timers.current.forEach(clearTimeout); timers.current = []; nextZIndex.current = 0; }, [person.id]);
  if (root !== person.id) {
    latestRelationRequestId.current += 1; setBusy(null);
    setRoot(person.id); setActive(person); setHistory([]); setPage(0);
    setMotions([]); setIsResetting(false); setLayers(createLayers(buildScene({ active: person, history: [], page: 0 })));
  }
  const current = buildScene({ active, history, page });
  const { prev, previousPosition, pages, shownPage } = current;
  const center = { x: width / 2, y: CENTER_Y };
  const hasCamera = motions.some(m => m.kind === "camera");
  const beginTransition = (to: Navigation, spec: { kind: Motion["kind"]; selectedId?: string; selectedPosition?: number; direction?: number }, source: Scene = current) => {
    const target = buildScene(to);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nextZIndex.current = 0; setMotions([]); setLayers(createLayers(target));
    } else {
      const motion: Motion = { ...spec, id: ++nextMotionId.current, departingId: source.active.id, progress: 0, elapsed: 0 };
      const zIndex = ++nextZIndex.current;
      setMotions(value => [...value, motion]);
      setLayers(value => transitionLayers(value, target, motion, zIndex));
    }
    setActive(to.active); setHistory(to.history); setPage(to.page);
  };
  const walk = async (r: Rel, position: number) => {
    const requestId = ++latestRelationRequestId.current;
    cancelReset(); haptic("select"); setBusy(r.id);
    try {
      const next = await client.fetchQuery({ queryKey: ["person", r.id], queryFn: () => data.person(r.id), staleTime: Infinity });
      if (requestId !== latestRelationRequestId.current) return;
      beginTransition({ active: next, history: [...history, { person: active, via: r, position, page: shownPage }], page: 0 }, { kind: "camera", selectedId: next.id, selectedPosition: position });
    } catch { /* the person did not load: stay where we are */ }
    finally { if (requestId === latestRelationRequestId.current) setBusy(null); }
  };
  const back = () => {
    if (!prev) return;
    latestRelationRequestId.current += 1; setBusy(null);
    cancelReset(); haptic("select");
    beginTransition({ active: prev.person, history: history.slice(0, -1), page: prev.page }, { kind: "camera", selectedId: prev.person.id, selectedPosition: previousPosition });
  };
  const reset = () => {
    if (!history.length) return;
    latestRelationRequestId.current += 1; setBusy(null);
    cancelReset(); haptic("select"); setIsResetting(true);
    const sequence = resetSequence.current;
    let source = current;
    [...history].reverse().forEach((previous, index) => {
      const from = source, to = { active: previous.person, history: history.slice(0, history.length - index - 1), page: previous.page };
      timers.current.push(setTimeout(() => {
        if (sequence !== resetSequence.current) return;
        beginTransition(to, { kind: "camera", selectedId: previous.person.id, selectedPosition: from.previousPosition }, from);
      }, index * 350));
      source = buildScene(to);
    });
  };
  const turn = (p: number) => {
    if (p === shownPage) return;
    latestRelationRequestId.current += 1; setBusy(null);
    cancelReset(); haptic("select");
    beginTransition({ active, history, page: p }, { kind: "pagination", direction: p > shownPage ? 1 : -1 });
  };
  const renderCenter = (entity: Person, style?: CSSProperties, interactive = true, exit?: Motion) => {
    const elsewhere = entity.id !== person.id;
    return <div className="fg__center" style={{ left: center.x - CENTER / 2, top: center.y - CENTER / 2, ...style }}>
      <button type="button" className="fg__node fg__node--center" disabled={!elsewhere || !interactive} aria-label={elsewhere ? `View ${entity.name}'s profile` : entity.name} title={elsewhere ? `View ${entity.name}'s profile` : entity.name}
        onClick={() => { haptic("select"); onOpenProfile(entity.id); }}>
        <EntityAvatar id={entity.id} name={entity.name} src={entity.image?.src} kind={avatarKind(entity.type) !== "other" ? avatarKind(entity.type) : kindOf(entity.id)} size={CENTER} style={exit?.kind === "camera" ? avatarStyle("center", exit.progress) : undefined} />
      </button>
      <div className="fg__label fg__label--center"><b>{entity.name}</b>
        {elsewhere ? <button type="button" className="fg__chip fg__chip--profile" disabled={!interactive} onClick={() => { haptic("select"); onOpenProfile(entity.id); }}>View profile<Feather name="chevron-right" size={10} /></button> : null}
      </div>
    </div>;
  };
  if (!relationsOf(person).length) return null;
  return <div className="fg" inert={isResetting}>
    <div ref={box} className="fg__stage" style={{ height: HEIGHT }} aria-label={`The family of ${active.name}`}>
      {layers.filter(l => l.visible).map(layer => {
        const s = layer.scene, { entry, exit } = layer;
        const v = layerFrame(layer, center, i => positionOf(i, width));
        const prevKind: AvatarKind = s.prev ? avatarKind(s.prev.person.type) !== "other" ? avatarKind(s.prev.person.type) : kindOf(s.prev.person.id) : "other";
        const camera = entry?.kind === "camera" || exit?.kind === "camera" || layer.carry.some(m => m.kind === "camera");
        return <div key={layer.id} className="fg__layer" data-current={layer.current ? "" : undefined} data-motion={entry?.kind ?? exit?.kind} aria-hidden={!layer.current} inert={!layer.current}
          style={{ zIndex: layer.zIndex, opacity: v.opacity, transform: `translate(${v.x}px, ${v.y}px)` }}>
          <svg className="fg__lines" width={width} height={HEIGHT} aria-hidden="true">
            {s.nodes.map(({ r, position }) => {
              const p = positionOf(position, width), line = connectionFrame(entry, exit, p, center);
              return <line key={position} x1={center.x} y1={center.y} {...line} />;
            })}
            {s.prev && s.previousPosition != null ? (() => {
              const p = positionOf(s.previousPosition, width), progress = entry?.kind === "camera" ? entry.progress : 1;
              return <line className="fg__line--back" x1={center.x} y1={center.y} x2={p.x} y2={p.y}
                style={{ stroke: `color-mix(in srgb, var(--hairline) ${(1 - progress) * 100}%, var(--accent))`, strokeWidth: progress === 1 ? 1.8 : 1.4 }} />;
            })() : null}
          </svg>
          <div className="fg__scene">
            {camera ? renderCenter(s.active, motionStyle(nodeFrame(entry, exit, "center", s.active.id, center, center)), layer.current, exit) : null}
            {s.prev && s.previousPosition != null ? <Satellite at={positionOf(s.previousPosition, width)} id={s.prev.person.id} name={s.prev.person.name} src={s.prev.person.image?.src} kind={prevKind}
              label={relationLabel(inverse(s.prev.via.relation, prevKind), prevKind)} relation={inverse(s.prev.via.relation, prevKind)} back onPress={back}
              selectedProgress={exit?.kind === "camera" && exit.selectedId === s.prev.person.id ? exit.progress : undefined}
              motionStyle={motionStyle(nodeFrame(entry, exit, "previous", s.prev.person.id, positionOf(s.previousPosition, width), center))} /> : null}
            {s.nodes.map(({ r, position }) => {
              const kind = kindOf(r.id, r.relation, s.active);
              return <Satellite key={position} at={positionOf(position, width)} id={r.id} name={r.name} src={r.image?.src} kind={kind}
                label={relationLabel(r.relation, kind)} relation={r.relation} loading={busy === r.id} onPress={() => void walk(r, position)}
                selectedProgress={exit?.kind === "camera" && exit.selectedId === r.id ? exit.progress : undefined}
                motionStyle={motionStyle(nodeFrame(entry, exit, "relation", r.id, positionOf(position, width), center))} />;
            })}
          </div>
        </div>;
      })}
      {!hasCamera ? <div className="fg__static-center">{renderCenter(active)}</div> : null}
    </div>
    <div className="fg__foot" aria-label={`Page ${shownPage + 1} of ${pages}`}>
      {history.length ? <button type="button" className="fg__hist fg__hist--left" aria-label="Back" title="Back" onClick={back}><Feather name="arrow-left" size={16} /></button> : null}
      <button type="button" className="fg__page" aria-label="Previous page" title="Previous page" disabled={shownPage === 0} onClick={() => turn(shownPage - 1)}><Feather name="chevron-left" size={18} /></button>
      <span>{shownPage + 1} / {pages}</span>
      <button type="button" className="fg__page" aria-label="Next page" title="Next page" disabled={shownPage >= pages - 1} onClick={() => turn(shownPage + 1)}><Feather name="chevron-right" size={18} /></button>
      {history.length || isResetting ? <button type="button" className="fg__hist fg__hist--right" aria-busy={isResetting || undefined} aria-label={`Start again from ${person.name}`} title={`Start again from ${person.name}`} onClick={reset}><Feather name="rotate-ccw" size={16} /></button> : null}
    </div>
  </div>;
}

/** How the one you came from is related to the one in the middle now. */
function inverse(r: Relation, kind: AvatarKind): Relation {
  return r === "father" || r === "mother" ? "offspring" : r === "offspring" ? (kind === "female" ? "mother" : "father") : r;
}

function Satellite({ at, id, name, src, kind, label, relation, back, loading, onPress, motionStyle, selectedProgress }: {
  at: { x: number; y: number }; id?: string; name: string; src?: string; kind: AvatarKind; label: string; relation: Relation; back?: boolean; loading?: boolean; onPress: () => void; motionStyle?: CSSProperties; selectedProgress?: number;
}) {
  const v = VISUAL[relation];
  return (
    <div className="fg__sat" style={{ left: at.x - NODE / 2, top: at.y - NODE / 2, ...motionStyle }}>
      <button type="button" className="fg__node" aria-label={back ? `Back to ${name}` : `${label}, ${name}`} title={back ? `Back to ${name}` : `${label}, ${name}`} aria-busy={loading || undefined} onClick={onPress}>
        <EntityAvatar id={id} name={name} src={src} kind={kind} size={NODE} style={selectedProgress == null ? undefined : avatarStyle("selected", selectedProgress)} />
        {back ? <span className="fg__back" aria-hidden="true"><Feather name="chevron-left" size={14} /></span> : null}
      </button>
      <div className="fg__label" style={{ width: NODE_W, marginLeft: (NODE - NODE_W) / 2 }}>
        <b>{name}</b>
        <span className="fg__chip"><span style={{ color: v.tone, display: "inline-flex" }}><Feather name={v.icon} size={10} /></span>{label}</span>
      </div>
    </div>
  );
}
