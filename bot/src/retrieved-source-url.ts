import { isApproved } from "./source-policy";

const SITE = "https://cyberjudah.io";
const CORE_HOSTS = ["cyberjudah.io", "youtube.com", "youtu.be"];
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const UNSAFE = /[\u0000-\u0020\u007f\\]/;

/** Only a recorded numeric second; no clock parsing, inferred moment or invalid-number coercion. */
export function recordedMoment(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
}

/** A recorded root-relative path resolves only to our site, without traversal or authority changes. */
function ownPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  const path = value.split(/[?#]/)[0];
  if (path.includes("//")) return false;
  try {
    if (path.split("/").some(part => {
      const decoded = decodeURIComponent(part);
      return decoded === "." || decoded === ".." || /[\/\\\u0000-\u0020\u007f]/.test(decoded);
    })) return false;
  } catch { return false; }
  return true;
}

/** Read-time repair for old vectors. Source text cannot expand the server's reviewed host list. */
export function retrievedSourceUrl(source: { url?: unknown; video?: unknown; t?: unknown }, approvedHosts: string[]): string | null {
  const recorded = typeof source.url === "string" ? source.url.trim() : "";
  if (recorded && !UNSAFE.test(recorded)) {
    try {
      const relative = ownPath(recorded);
      const url = relative ? new URL(recorded, SITE) : new URL(recorded);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.port
        && isApproved(url.hostname, [...CORE_HOSTS, ...approvedHosts])) return relative ? url.href : recorded;
    } catch { /* No usable recorded address; try only the recorded video ID. */ }
  }
  const video = typeof source.video === "string" && VIDEO.test(source.video) ? source.video : null;
  if (!video) return null;
  const t = recordedMoment(source.t);
  return `https://www.youtube.com/watch?v=${video}${t !== undefined ? `&t=${Math.floor(t)}s` : ""}`;
}
