import { Fragment, useMemo } from "react";
import { createPortal } from "react-dom";

/**
 * Liquid Glass refraction for the dock's lens. An SVG displacement map, drawn for the lens's
 * size, bends what lies behind it as a drop of glass would: the middle magnified, the rim pulling
 * in what lies just beyond it, and each colour bent a little differently so the rim splits light
 * into a fringe. Chromium (Telegram on Android and desktop) can apply an SVG filter to what is
 * behind an element; Safari cannot, so the lens there keeps its tint, rim and swelling icons.
 */
export const refracts = typeof navigator !== "undefined" && /Chrome\/|Chromium\//.test(navigator.userAgent);

/** The map: red and green carry the horizontal and vertical pull, 128 being none. */
function lensMap(w: number, h: number): { url: string; max: number } {
  const W = Math.max(2, Math.round(w)), H = Math.max(2, Math.round(h));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"); if (!g) return { url: "", max: 1 };
  const img = g.createImageData(W, H), px = img.data;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2, hx = W / 2 - r, hy = H / 2 - r;
  const bezel = r * .62, rim = r * .55, mag = .16;
  const max = rim + mag * Math.max(cx, cy);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, dx = x + .5 - cx, dy = y + .5 - cy;
    // Distance inside the rounded shape, and the way out of it.
    const qx = Math.abs(dx) - hx, qy = Math.abs(dy) - hy;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), out = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
    let nx = 0, ny = 0;
    if (ox > 0 || oy > 0) { const l = Math.hypot(ox, oy) || 1; nx = Math.sign(dx) * ox / l; ny = Math.sign(dy) * oy / l; } else if (qx > qy) nx = Math.sign(dx); else ny = Math.sign(dy);
    let vx = 0, vy = 0;
    if (out < 0) {
      const t = Math.min(1, Math.max(0, 1 + out / bezel)); // 0 inside, 1 at the edge
      const pull = rim * t * t * t;                         // steepest at the rim, as on a lens
      vx = nx * pull - dx * mag; vy = ny * pull - dy * mag;
    }
    px[i] = 128 + Math.round((vx / max) * 127); px[i + 1] = 128 + Math.round((vy / max) * 127); px[i + 2] = 128; px[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { url: c.toDataURL(), max };
}

const CHANNEL = { r: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", g: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", b: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" };

function Lens({ id, w, h, url, scale }: { id: string; w: number; h: number; url: string; scale: number }) {
  return (
    <filter id={id} primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
      <feImage href={url} x="0" y="0" width={w} height={h} preserveAspectRatio="none" result="map" />
      {(["r", "g", "b"] as const).map((k, i) => (
        <Fragment key={k}>
          <feDisplacementMap in="SourceGraphic" in2="map" scale={scale * (1 - i * .07)} xChannelSelector="R" yChannelSelector="G" result={`d${k}`} />
          <feColorMatrix in={`d${k}`} type="matrix" values={CHANNEL[k]} result={k} />
        </Fragment>
      ))}
      <feBlend in="r" in2="g" mode="screen" result="rg" />
      <feBlend in="rg" in2="b" mode="screen" />
    </filter>
  );
}

/** The two lenses: resting under the current section, and lifted under the finger. */
export function LensFilters({ w, h }: { w: number; h: number }) {
  const map = useMemo(() => (refracts && w > 0 && h > 0 ? lensMap(w, h) : null), [w, h]);
  if (!map?.url) return null;
  // In the page's body, outside the bar: the filters are referenced by id from its CSS.
  return createPortal(
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <Lens id="lens-rest" w={w} h={h} url={map.url} scale={map.max * 2 * .55} />
      <Lens id="lens-lift" w={w} h={h} url={map.url} scale={map.max * 2} />
    </svg>,
    document.body,
  );
}
