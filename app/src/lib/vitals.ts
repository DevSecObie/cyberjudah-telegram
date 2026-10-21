import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { area, type VitalName, type VitalsReport } from "@shared/vitals.mjs";
import { apiURL, native, nativePlatform } from "../native/platform";
import { inTelegram } from "../tg/sdk";

/**
 * How fast this visit felt on the reader's own device (Core Web Vitals), sent once, without
 * launch data or any ID, when the page is hidden. docs/PRIVACY.md, "Speed measurements".
 */
export function reportVitals() {
  const metrics: VitalsReport["metrics"] = {};
  const sent = new Set<string>();
  let nav: Metric["navigationType"] = "navigate";
  const where = area(location.pathname);
  const platform = native ? (nativePlatform === "ios" ? "ios" : "android") : inTelegram ? "telegram" : "web";
  const keep = (m: Metric) => {
    if (sent.has(m.name)) return;
    metrics[m.name as VitalName] = m.name === "CLS" ? Math.round(m.value * 1000) / 1000 : Math.round(m.value);
    nav = m.navigationType;
  };
  for (const on of [onTTFB, onFCP, onLCP, onINP, onCLS]) on(keep);
  const flush = () => {
    if (document.visibilityState !== "hidden" || Object.keys(metrics).length === 0) return;
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
    const report: VitalsReport = { area: where, platform, nav, ...(conn && conn !== "unknown" ? { conn } : {}), metrics: { ...metrics } };
    // text/plain keeps the beacon a simple request, so the native apps' cross-origin send needs no preflight.
    if (navigator.sendBeacon?.(apiURL("/api/vitals"), new Blob([JSON.stringify(report)], { type: "text/plain" }))) {
      for (const name of Object.keys(metrics)) { sent.add(name); delete metrics[name as VitalName]; }
    }
  };
  document.addEventListener("visibilitychange", flush);
  addEventListener("pagehide", flush);
}
