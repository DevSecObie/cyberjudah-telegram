export type Point = { x: number; y: number };
export type Motion = {
  id: number;
  kind: "camera" | "pagination";
  direction?: number;
  selectedId?: string;
  selectedPosition?: number;
  departingId?: string;
  progress: number;
  elapsed: number;
  timestamp?: number;
};
export type Layer<S> = {
  id: number; scene: S; carry: Motion[]; entry?: Motion; exit?: Motion;
  visible: boolean; current: boolean; zIndex: number;
};

export function createLayers<S>(scene: S): Layer<S>[] {
  return Array.from({ length: 3 }, (_, id) => ({ id, scene, carry: [], visible: id === 0, current: id === 0, zIndex: id === 0 ? 0 : -1 }));
}

export function transitionLayers<S>(layers: Layer<S>[], scene: S, motion: Motion, zIndex: number): Layer<S>[] {
  const source = layers.find(l => l.current);
  const target = layers.find(l => !l.visible) ?? layers.filter(l => !l.current).sort((a, b) => a.zIndex - b.zIndex)[0];
  if (!source || !target) return createLayers(scene);
  return layers.map(l => l.id === source.id ? { ...l, current: false, exit: motion }
    : l.id === target.id ? { ...l, scene, carry: [...source.carry, ...(source.entry ? [source.entry] : [])], entry: motion, exit: undefined, visible: true, current: true, zIndex }
    : l);
}

export function finishLayers<S>(layers: Layer<S>[], id: number): Layer<S>[] {
  return layers.map(l => l.exit?.id === id
    ? { ...l, carry: [], entry: undefined, exit: undefined, visible: false, current: false, zIndex: -1 }
    : { ...l, carry: l.carry.filter(m => m.id !== id), entry: l.entry?.id === id ? undefined : l.entry });
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ENERGY_THRESHOLD = 6e-9;
// Reanimated4.7.0's duration-based gentle spring: mass4, dampingRatio1, actual duration1.5×400ms.
const SPRING_OMEGA = (() => {
  const fraction = (stiffness: number) => {
    const t = Math.sqrt(stiffness / 4) * .6;
    return Math.exp(-2 * t) * ((1 + t) ** 2 + t ** 2) - ENERGY_THRESHOLD;
  };
  let min = Number.EPSILON, max = 8000, current = (min + max) / 2, remaining = 100;
  while (Math.abs(fraction(current)) > ENERGY_THRESHOLD * 1e-3 && remaining-- > 0) {
    if (fraction(current) > 0) min = current; else max = current;
    current = (min + max) / 2;
  }
  return Math.sqrt(current / 4);
})();

export function springProgress(elapsed: number): number {
  const t = SPRING_OMEGA * Math.max(0, elapsed) / 1000;
  const decay = Math.exp(-t);
  const fraction = decay ** 2 * ((1 + t) ** 2 + t ** 2);
  return fraction <= ENERGY_THRESHOLD ? 1 : 1 - (1 + t) * decay;
}

export function advanceMotion(motion: Motion, now: number): boolean {
  motion.elapsed += motion.timestamp == null ? 0 : Math.min(64, Math.max(0, now - motion.timestamp));
  motion.timestamp = now;
  motion.progress = motion.kind === "pagination" ? clamp(motion.elapsed / 350) : springProgress(motion.elapsed);
  return motion.progress === 1;
}

const entryProgress = (motion?: Motion, positioned = false) => motion?.kind === "pagination" && positioned
  ? clamp((motion.progress * 350 - 200) / 150) : motion?.progress ?? 1;
const exitProgress = (motion?: Motion, positioned = false) => motion?.kind === "pagination" && positioned
  ? clamp(motion.progress * 350 / 150) : motion?.progress ?? 0;

export function layerFrame<S>(layer: Layer<S>, center: Point, position: (index: number) => Point): Point & { opacity: number } {
  let x = 0, y = 0, opacity = 1;
  const offset = (m: Motion) => { const p = m.selectedPosition == null ? center : position(m.selectedPosition); return { x: center.x - p.x, y: center.y - p.y }; };
  if (layer.entry?.kind === "camera") {
    const m = layer.entry, p = offset(m); x -= p.x * (1 - m.progress); y -= p.y * (1 - m.progress); opacity *= m.progress;
  }
  if (layer.exit?.kind === "camera") {
    const m = layer.exit, p = offset(m); x += p.x * m.progress; y += p.y * m.progress; opacity *= 1 - m.progress;
  }
  for (const m of layer.carry) if (m.kind === "camera") { const p = offset(m); x -= p.x * (1 - m.progress); y -= p.y * (1 - m.progress); }
  return { x, y, opacity };
}

export function rotateRadius(radius: Point, degrees: number): Point {
  const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return { x: radius.x * c - radius.y * s, y: radius.x * s + radius.y * c };
}

function paginationFrame(entry: Motion | undefined, exit: Motion | undefined, positioned: boolean) {
  const entering = entry?.kind === "pagination" && positioned, leaving = exit?.kind === "pagination" && positioned;
  const a = entryProgress(entry, positioned), b = exitProgress(exit, positioned);
  return {
    opacity: (entering ? a : 1) * (leaving ? 1 - b : 1),
    degrees: (entering ? (entry?.direction ?? 1) * 10 * (1 - a) : 0) - (leaving ? (exit?.direction ?? 1) * 30 * b : 0),
  };
}

export function nodeFrame(entry: Motion | undefined, exit: Motion | undefined, role: "center" | "previous" | "relation", id: string, at: Point, center: Point) {
  const positioned = role === "relation", pagination = paginationFrame(entry, exit, positioned);
  const a = clamp(entryProgress(entry, positioned)), b = clamp(exitProgress(exit, positioned));
  const entryRole = entry && (role === "center" ? entry.selectedId ? "center" : undefined : id === entry.departingId ? "previous" : role === "relation" ? "relation" : undefined);
  const exitRole = exit && (role === "center" ? exit.selectedId ? "center" : undefined : id === exit.selectedId ? "selected" : role === "relation" ? "relation" : undefined);
  const entryScale = entry?.kind === "pagination" && positioned ? 1 : entryRole === "center" ? .71 + .29 * a : entryRole === "previous" ? 1.42 - .42 * a : entryRole === "relation" ? .3 + .7 * a : 1;
  const exitScale = exit?.kind === "pagination" && positioned ? 1 : exitRole === "center" ? 1 - .29 * b : exitRole === "selected" ? 1 + .42 * b : exitRole === "relation" ? 1 - .7 * b : 1;
  const radius = { x: at.x - center.x, y: at.y - center.y }, rotated = rotateRadius(radius, pagination.degrees);
  return { x: rotated.x - radius.x, y: rotated.y - radius.y, scale: entryScale * exitScale, opacity: pagination.opacity };
}

export function avatarFrame(role: "center" | "selected", progress: number) {
  const value = clamp(progress);
  return role === "selected" ? { primary: value, width: 1 + value } : { primary: 1 - value, width: 2 - value };
}

export function connectionFrame(entry: Motion | undefined, exit: Motion | undefined, at: Point, center: Point) {
  const pagination = paginationFrame(entry, exit, true), radius = rotateRadius({ x: at.x - center.x, y: at.y - center.y }, pagination.degrees);
  return { x2: center.x + radius.x, y2: center.y + radius.y, opacity: pagination.opacity };
}
