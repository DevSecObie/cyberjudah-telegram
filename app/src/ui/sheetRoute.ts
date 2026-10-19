import { createContext, useContext } from "react";

/** Inside a route sheet (ui/routeSheet): how many screens deep it is, and its own back. */
export type SheetRoute = { depth: number; back: () => void };
export const SheetRouteContext = createContext<SheetRoute | null>(null);
export const useSheetRoute = () => useContext(SheetRouteContext);
