import { createContext, useContext } from "react";

/** Inside a route sheet (ui/routeSheet): how many screens deep it is, and its own back. */
export type SheetRoute = { depth: number; back: () => void };
export const SheetRouteContext = createContext<SheetRoute | null>(null);
export const useSheetRoute = () => useContext(SheetRouteContext);

/** The page under an open route sheet: its Back and actions stand aside until the sheet closes. */
export const UnderSheetContext = createContext(false);

/** A route sheet with a screen before the current one: Telegram's Back steps back to it, as the sheet's ← does. */
export const sheetStep: { back: (() => void) | null } = { back: null };
