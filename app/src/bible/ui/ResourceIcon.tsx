import shapes from "./resource-icon-shapes.json";

/** Bible Strong's resource icons (common/icons/ResourceIcon): a page frame with the resource's mark. */
export type ResourceKind = keyof typeof shapes.symbols;

export function ResourceIcon({ kind, size = 22, color = "currentColor" }: { kind: ResourceKind; size?: number; color?: string }) {
  const symbol: { path: string; transform?: string } = shapes.symbols[kind];
  return (
    <svg width={size} height={size} viewBox={shapes.viewBox} fill="none" aria-hidden="true">
      <rect {...shapes.frame} fill="none" stroke={color} strokeWidth={2} />
      <path d={symbol.path} transform={symbol.transform} fill={color} />
    </svg>
  );
}
