import type { Page } from "@playwright/test";

/** Conservative budget: includes intersecting surfaces even if another panel covers them. */
export async function filteredSurfaces(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("body *")].flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) return [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const s = getComputedStyle(ancestor);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return [];
    }
    return [undefined, "::before", "::after"].flatMap(pseudo => {
      const s = getComputedStyle(element, pseudo);
      const filter = s.backdropFilter || s.getPropertyValue("-webkit-backdrop-filter");
      return filter && filter !== "none" && (!pseudo || !["none", "normal"].includes(s.content)) ? [`${element.className}${pseudo ?? ""}`] : [];
    });
  }));
}

