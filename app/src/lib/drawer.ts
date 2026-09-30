import { useSyncExternalStore } from "react";

/**
 * Bible Strong's two drawers (AppSwitcherScreen/CompactAppSwitcherScreen): Home comes in from the
 * left and the menu from the right, sliding the whole app aside. One is open at a time.
 */
export type DrawerSide = "home" | "more";
let open: DrawerSide | null = null;
const listeners = new Set<() => void>();
export const setDrawer = (side: DrawerSide | null) => { if (open === side) return; open = side; listeners.forEach((l) => l()); };
export const useDrawer = () => useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => open);
