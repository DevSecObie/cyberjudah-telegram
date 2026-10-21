import { useEffect, useRef, type ReactNode } from "react";
import { useNavigate, type Location, type NavigationType } from "react-router";

import { Sheet, type SnapPoint } from "@/bible/ui/Sheet";
import { SheetRouteContext, sheetStep } from "./sheetRoute";

/**
 * Bible Strong's route form sheets. On the iPhone a dictionary word, a theme, a tag, a study, a
 * timeline event or a Strong's entry is not a page: it slides up as a sheet over the screen it
 * was opened from (formSheet routes, app/(explore) and app/strong). The page behind stays, and
 * stays the tab's place; closing the sheet returns to it. Opened without a page behind (a link
 * from outside, a reload) it is a page, as before.
 *
 * - (explore): detents 45% and full, the page behind undimmed at 45% (sheetLargestUndimmedDetentIndex 0).
 * - strong: full height, dimmed.
 */
type Kind = { snapPoints: SnapPoint[]; dimFrom: number };
const EXPLORE: Kind = { snapPoints: [0.45, 1], dimFrom: 1 };
const STRONG: Kind = { snapPoints: [1], dimFrom: 0 };
const ROUTES: [RegExp, Kind][] = [
  [/^\/dictionary\/[^/]+$/, EXPLORE],
  [/^\/topics\/[^/]+$/, EXPLORE],
  [/^\/precepts\/[^/]+$/, EXPLORE],
  [/^\/tags\/[^/]+$/, EXPLORE],
  [/^\/studies\/[^/]+$/, EXPLORE],
  [/^\/timeline\/event\/[^/]+$/, EXPLORE],
  [/^\/lexicon\/[^/]+$/, STRONG],
  [/^\/person\/[^/]+$/, STRONG],
  [/^\/place\/[^/]+$/, STRONG],
];
export const sheetKind = (path: string) => ROUTES.find(([re]) => re.test(path))?.[1];

/** A sheet route on screen: the page behind it, and how many sheet screens deep it is. */
export type SheetEntry = { background: Location; depth: number };

/**
 * Which page a sheet route shows over. Each history entry keeps its answer, so Back and Forward
 * find the same page behind; a sheet opened from inside a sheet keeps the first one's page and
 * goes one deeper (Bible Strong's sheet has its own stack).
 */
export function useSheetEntry(location: Location, navType: NavigationType): SheetEntry | null {
  const entries = useRef(new Map<string, SheetEntry | null>());
  const lastPage = useRef<Location | null>(null);
  const lastKey = useRef<string | null>(null);
  const known = entries.current.get(location.key);
  if (known !== undefined) { lastKey.current = location.key; if (!known) lastPage.current = location; return known; }
  let entry: SheetEntry | null = null;
  if (sheetKind(location.pathname) && navType !== "POP" && lastPage.current) {
    const before = lastKey.current ? entries.current.get(lastKey.current) : null;
    // A page replaced by a sheet route has no page left behind it to go back to: it stays a page.
    if (before) entry = { background: before.background, depth: before.depth + (navType === "PUSH" ? 1 : 0) };
    else if (navType === "PUSH") entry = { background: lastPage.current, depth: 1 };
  }
  entries.current.set(location.key, entry);
  lastKey.current = location.key;
  if (!entry) lastPage.current = location;
  return entry;
}

/** The sheet a route screen sits in: page-coloured, as route form sheets are (contentStyle reverse). */
export function RouteSheet({ entry, path, label, children }: { entry: SheetEntry; path: string; label: string; children: ReactNode }) {
  const navigate = useNavigate();
  const kind = sheetKind(path) ?? EXPLORE;
  const close = () => navigate(-entry.depth);
  useEffect(() => {
    if (entry.depth < 2) return;
    const back = () => navigate(-1);
    sheetStep.back = back;
    return () => { if (sheetStep.back === back) sheetStep.back = null; };
  }, [entry.depth, navigate]);
  return (
    <Sheet open onClose={close} snapPoints={kind.snapPoints} dimFrom={kind.dimFrom} background="reverse" label={label} className="route-sheet">
      <SheetRouteContext.Provider value={{ depth: entry.depth, back: () => navigate(-1) }}>{children}</SheetRouteContext.Provider>
    </Sheet>
  );
}
