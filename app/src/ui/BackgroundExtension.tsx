import { createPortal } from "react-dom";

/** Repeat only approved hero artwork in the reserved sidebar background. */
export function BackgroundExtension({ src }: { src?: string }) {
  if (!src) return null;
  return createPortal(<div className="rail-background" aria-hidden="true"><img src={src} alt="" draggable={false} /></div>, document.getElementById("shell") ?? document.body);
}
