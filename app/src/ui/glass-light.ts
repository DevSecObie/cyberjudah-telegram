// iOS 26's interactive glass lights up from inside under the finger: the light starts at the
// fingertip, follows it while it is down and fades out when it lifts (Apple, "Meet Liquid Glass").
// One light is drawn over the touched glass surface from outside the React tree, clipped to its
// shape, so no component has to carry it. Touch and pen only; a mouse gets the hover states.

/** The glass surfaces that light up: navigation bars, the dock, glass controls, menus and sheets. */
export const GLASS_SURFACES = [
  ".tabs", ".screen > .head", ".srch__bar", ".chat2__bar", ".reader__bar", ".tlh", ".pv__bar",
  ".glass", ".glass--elevated", ".pageaction", ".sheet", ".bs-sheet", ".bs-dropdown", ".bs-picker",
  ".bs-chapterbtn", ".bs-playpill", ".toast",
].join(", ");
/** Inside a lit surface, a glass control lights on its own instead of the whole bar. */
const GLASS_CONTROLS = ":is(.screen > .head, .srch__bar, .chat2__bar, .reader__bar, .tlh, .pv__bar) :is(.icon-btn, .btn)";

let light: HTMLDivElement | null = null;
let target: Element | null = null;
let pointer = -1;
let fade = 0;

function off() {
  return document.documentElement.dataset.transparency === "reduced"
    || matchMedia("(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)").matches;
}

function place(x: number, y: number) {
  if (!light || !target) return;
  const r = target.getBoundingClientRect();
  const s = light.style;
  s.left = `${r.left}px`; s.top = `${r.top}px`; s.width = `${r.width}px`; s.height = `${r.height}px`;
  s.setProperty("--light-x", `${x - r.left}px`); s.setProperty("--light-y", `${y - r.top}px`);
  // A small control is lit across its width; a large surface by a pool around the finger.
  s.setProperty("--light-r", `${Math.max(60, Math.min(160, Math.max(r.width, r.height) * .55))}px`);
}

function down(e: PointerEvent) {
  if (e.pointerType === "mouse" || !e.isPrimary || off()) return;
  const el = e.target instanceof Element ? (e.target.closest(GLASS_CONTROLS) ?? e.target.closest(GLASS_SURFACES)) : null;
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (!light) { light = document.createElement("div"); light.className = "glass-light"; light.setAttribute("aria-hidden", "true"); document.body.append(light); }
  clearTimeout(fade);
  target = el; pointer = e.pointerId;
  light.style.borderRadius = getComputedStyle(el).borderRadius;
  place(e.clientX, e.clientY);
  light.dataset.on = "";
}

function move(e: PointerEvent) { if (e.pointerId === pointer) place(e.clientX, e.clientY); }

function up(e: PointerEvent) {
  if (e.pointerId !== pointer || !light) return;
  pointer = -1;
  delete light.dataset.on;
  fade = window.setTimeout(() => { target = null; }, 400);
}

let installed = false;
export function installGlassLight() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  // Capture: a control that stops propagation still lights. Passive: the light never blocks a scroll.
  const opts = { capture: true, passive: true } as const;
  addEventListener("pointerdown", down, opts);
  addEventListener("pointermove", move, opts);
  addEventListener("pointerup", up, opts);
  addEventListener("pointercancel", up, opts);
}
