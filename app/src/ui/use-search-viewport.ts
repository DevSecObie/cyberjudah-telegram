import { useLayoutEffect, useRef } from "react";
import { app } from "@/tg/sdk";

/** Follow the live visible viewport, including Telegram clients that resize only their SDK viewport. */
export function useSearchViewport(enabled: boolean) {
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!enabled || !element) return;
    const viewport = window.visualViewport, phone = matchMedia("(max-width: 899px)");
    let frame = 0, baseline = innerHeight, activated = false;
    const update = () => {
      frame = 0;
      const focused = element.contains(document.activeElement);
      activated ||= focused;
      baseline = Math.max(baseline, innerHeight);
      // Pinch zoom is a reading action, not evidence of a keyboard.
      const unzoomed = !viewport || Math.abs(viewport.scale - 1) < .05;
      const visibleBottom = Math.min(innerHeight, viewport ? viewport.offsetTop + viewport.height : innerHeight, app?.viewportHeight || innerHeight);
      const keyboard = phone.matches && activated && unzoomed && baseline - visibleBottom > 100;
      const lift = keyboard ? Math.max(0, innerHeight - visibleBottom) : 0;
      element.style.setProperty("--search-lift", `${-lift}px`);
      element.toggleAttribute("data-keyboard", keyboard);
      document.documentElement.toggleAttribute("data-search-keyboard", keyboard);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(() => {
      element.parentElement?.style.setProperty("--search-bar-height", `${element.offsetHeight}px`);
    });
    observer.observe(element);
    viewport?.addEventListener("resize", schedule); viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule); phone.addEventListener("change", schedule);
    element.addEventListener("focusin", schedule); element.addEventListener("focusout", schedule);
    app?.onEvent("viewportChanged", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      viewport?.removeEventListener("resize", schedule); viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule); phone.removeEventListener("change", schedule);
      element.removeEventListener("focusin", schedule); element.removeEventListener("focusout", schedule);
      app?.offEvent("viewportChanged", schedule);
      delete document.documentElement.dataset.searchKeyboard;
    };
  }, [enabled]);
  return bar;
}
