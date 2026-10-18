// The pressed look (a button's scale, a row's tint), as Bible Strong's Pressable gives it: it
// appears 50 ms after the finger lands, not on every touch that turns into a scroll, and goes
// away as soon as the finger moves 10 px or the page scrolls. The browser's :active shows on
// any touch, scroll starts included; this marks the pressed element and its ancestors with
// data-pressed instead (the same chain :active would match), and the stylesheets use that.
import { stoppingScroll } from "./fling";

const DELAY = 50, SLOP = 10, FLASH = 100;
let marked: Element[] = [];
let timer = 0, flash = 0, pointer = -1, x = 0, y = 0, target: Element | null = null;

function mark(el: Element | null) {
  clear();
  for (let e = el; e; e = e.parentElement) { e.setAttribute("data-pressed", ""); marked.push(e); }
}
function clear() {
  clearTimeout(timer); clearTimeout(flash); timer = 0;
  for (const e of marked) e.removeAttribute("data-pressed");
  marked = [];
}
const disabled = (el: Element) => Boolean(el.closest(":disabled, [aria-disabled='true']"));

function down(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0 || !(e.target instanceof Element)) return;
  clear(); pointer = e.pointerId; x = e.clientX; y = e.clientY; target = null;
  // A finger that stops a gliding page presses nothing (fling.ts).
  if ((e.pointerType === "touch" && stoppingScroll()) || disabled(e.target)) return;
  target = e.target;
  timer = window.setTimeout(() => { timer = 0; mark(target); }, DELAY);
}
function move(e: PointerEvent) {
  if (e.pointerId === pointer && target && Math.hypot(e.clientX - x, e.clientY - y) > SLOP) { target = null; clear(); }
}
function up(e: PointerEvent) {
  if (e.pointerId !== pointer) return;
  pointer = -1;
  // A tap shorter than the delay still shows the press, briefly, as Pressable's press-in/out does.
  if (timer && target && e.type === "pointerup") { mark(target); flash = window.setTimeout(clear, FLASH); } else clear();
  target = null;
}
function cancel() { target = null; pointer = -1; clear(); }

let installed = false;
export function installPress() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const opts = { capture: true, passive: true } as const;
  addEventListener("pointerdown", down, opts);
  addEventListener("pointermove", move, opts);
  addEventListener("pointerup", up, opts);
  addEventListener("pointercancel", cancel, opts);
  // A press that becomes a scroll is not a press.
  addEventListener("scroll", () => { if (target || marked.length) cancel(); }, opts);
  // The keyboard's press (Space or Enter on a control) shows the same look while the key is down.
  addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat && e.target instanceof Element && e.target.matches("button, a, [role=button], [role=tab], input[type=range]")) mark(e.target); }, true);
  addEventListener("keyup", () => { if (marked.length) clear(); }, true);
  addEventListener("blur", clear, true);
}
