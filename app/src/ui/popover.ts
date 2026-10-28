import { useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

let pressed: { element: HTMLElement; at: number } | undefined;
document.addEventListener("pointerdown", e => {
  const element = (e.target as Element).closest<HTMLElement>("button, [role=button]");
  if (element) pressed = { element, at: performance.now() };
}, true);

export function popoverTrigger() {
  return pressed && performance.now() - pressed.at < 300 ? pressed.element : document.activeElement?.closest<HTMLElement>("button, [role=button]") ?? null;
}

/**
 * Mount and unmount a controlled popover the way Bible Strong's web menus do (common/ui/MenuView.web.css,
 * bs-menu-enter): it fades in over 120 ms while settling 4 px down, not at all under reduced motion,
 * and it closes at once. Escape and outside dismissal close it the same way.
 */
export function usePopover(open: boolean, ref: RefObject<HTMLElement | null>) {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (!open) { setPresent(false); return; }
    let canceled = false;
    let animation: Animation | undefined;
    popoverTrigger()?.focus({ preventScroll: true });
    // Run outside React's commit so the popover is mounted before it animates.
    queueMicrotask(() => {
      if (canceled) return;
      flushSync(() => setPresent(true));
      const box = ref.current;
      if (!box || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      animation = box.animate([{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }], { duration: 120, easing: "ease-out" });
    });
    return () => { canceled = true; animation?.cancel(); };
  }, [open, ref]);
  return present;
}
