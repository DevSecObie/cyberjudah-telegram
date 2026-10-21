import shapes from "./resource-icon-shapes.json";

/** Our resource icons, where Bible Strong has its ResourceIcon: a rounded frame with the resource's mark, in strokes. */
export type ResourceKind = keyof typeof shapes.symbols;

export function ResourceIcon({ kind, size = 22, color = "currentColor" }: { kind: ResourceKind; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox={shapes.viewBox} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect {...shapes.frame} />
      <path d={shapes.symbols[kind].path} />
    </svg>
  );
}
