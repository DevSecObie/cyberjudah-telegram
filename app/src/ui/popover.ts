import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

let pressed: { element: HTMLElement; at: number } | undefined;
document.addEventListener("pointerdown", e => {
  const element = (e.target as Element).closest<HTMLElement>("button, [role=button]");
  if (element) pressed = { element, at: performance.now() };
}, true);

/** Keep a controlled popover mounted for its exit, including Escape and outside dismissal. */
export function usePopover(open: boolean, ref: RefObject<HTMLElement | null>) {
  const [present, setPresent] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open && !ref.current) return;
    let canceled = false;
    let animation: Animation | undefined;
    let transition: ViewTransition | undefined;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (open) {
      trigger.current = pressed && performance.now() - pressed.at < 300 ? pressed.element : document.activeElement?.closest<HTMLElement>("button, [role=button]") ?? null;
      trigger.current?.focus({ preventScroll: true });
    }
    const source = trigger.current;
    const origin = () => {
      const box = ref.current, from = source?.getBoundingClientRect();
      if (!box || !from) return;
      const to = box.getBoundingClientRect();
      box.style.transformOrigin = `${from.x + from.width / 2 - to.x}px ${from.y + from.height / 2 - to.y}px`;
    };
    const clear = () => {
      source?.style.removeProperty("view-transition-name");
      ref.current?.style.removeProperty("view-transition-name");
      ref.current?.style.removeProperty("will-change");
      document.documentElement.style.removeProperty("--popover-from");
      document.documentElement.style.removeProperty("--popover-to");
    };
    // Run outside React's commit so the snapshot contains the committed control or popover.
    queueMicrotask(() => {
      if (canceled) return;
      if (document.startViewTransition && !reduced && source?.isConnected) {
        const old = open ? source : ref.current;
        const from = old?.getBoundingClientRect();
        if (old) old.style.viewTransitionName = "action-popover";
        transition = document.startViewTransition(() => {
          if (canceled) return;
          old?.style.removeProperty("view-transition-name");
          flushSync(() => setPresent(open));
          const next = open ? ref.current : source;
          if (next?.isConnected) next.style.viewTransitionName = "action-popover";
          const to = next?.getBoundingClientRect();
          if (from && to?.width && to.height) {
            const style = document.documentElement.style;
            style.setProperty("--popover-from", `translate(${from.x}px, ${from.y}px) scale(${from.width / to.width}, ${from.height / to.height})`);
            style.setProperty("--popover-to", `translate(${to.x}px, ${to.y}px)`);
          }
          origin();
        });
        void transition.finished.finally(() => { if (!canceled) clear(); }).catch(() => {});
      } else {
        if (open) flushSync(() => setPresent(true));
        const box = ref.current;
        if (!box) return;
        origin();
        box.style.willChange = "transform, opacity";
        const frames = [{ opacity: 0, transform: reduced ? "none" : "scale(.92)" }, { opacity: 1, transform: "none" }];
        animation = box.animate(open ? frames : [...frames].reverse(), { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
        void animation.finished.then(() => { if (!canceled && !open) setPresent(false); }).catch(() => {}).finally(() => { if (!canceled) clear(); });
      }
    });
    return () => { canceled = true; animation?.cancel(); transition?.skipTransition(); clear(); };
  }, [open, ref]);
  return present;
}
