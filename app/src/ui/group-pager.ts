/**
 * Bible Strong's group pager (AppSwitcherProvider's groupPager.navigateToPage), reached from the
 * switcher bar's sheets: a page index (a group, or the create page after the last group) that the
 * switcher slides to.
 */
type Listener = (page: number) => void;
const listeners = new Set<Listener>();
export const groupPager = {
  navigateToPage(page: number) { listeners.forEach((l) => l(page)); },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
};
