import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAvailableUpdates, hasUnseenUpdates, markUpdatesSeen, type SeenResourceUpdates } from "./available-updates.mjs";
import { resourceCatalog } from "./client";
import { installedResources } from "./storage";

/** Updates shown to this device's reader, so the menu stops signalling them once seen (Bible Strong's seenResourceUpdatesAtom). */
const KEY = "cj:seen-resource-updates";
const read = (): SeenResourceUpdates => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };
let seen = read();
const listeners = new Set<() => void>();
const setSeen = (next: SeenResourceUpdates) => {
  if (next === seen) return;
  seen = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  listeners.forEach((l) => l());
};
const useSeen = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => seen);

const useAvailableUpdateMap = () => {
  const installed = useQuery({ queryKey: ["resource-installed"], queryFn: installedResources });
  // The catalog is only needed once something is installed.
  const catalog = useQuery({ queryKey: ["resource-catalog"], queryFn: () => resourceCatalog(), enabled: !!installed.data?.length });
  return getAvailableUpdates(installed.data ?? [], catalog.data);
};

export const useAvailableUpdatesIndicator = () => {
  const updates = useAvailableUpdateMap();
  const s = useSeen();
  return { hasUpdates: updates.size > 0, hasUnseenUpdates: hasUnseenUpdates(updates, s) };
};

/** Marks every available update as seen while the downloads screen is mounted. */
export const useMarkAvailableUpdatesSeen = () => {
  const updates = useAvailableUpdateMap();
  const signature = [...updates].map(([id, update]) => `${id}=${update}`).join("|");
  useEffect(() => {
    setSeen(markUpdatesSeen(updates, seen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
};
