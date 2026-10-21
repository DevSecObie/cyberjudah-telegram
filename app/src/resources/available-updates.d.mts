export type SeenResourceUpdates = Readonly<Record<string, string>>;
export function getAvailableUpdates(installed: readonly { id: string; manifest: { release: string } }[], catalog: { resources: readonly { id: string; release: string }[] } | null | undefined): Map<string, string>;
export function hasUnseenUpdates(updates: ReadonlyMap<string, string>, seen: SeenResourceUpdates): boolean;
export function markUpdatesSeen(updates: ReadonlyMap<string, string>, seen: SeenResourceUpdates): SeenResourceUpdates;
