/**
 * Sunset, from the NOAA solar equations, for the Sabbath countdown: the Sabbath begins at
 * sunset on the sixth day and ends at sunset on the seventh. Accurate to a minute or two,
 * which is what a countdown needs. Returns null above the polar circles when the sun does
 * not set.
 */
const rad = Math.PI / 180;

function sunsetUtc(date: Date, lat: number, lng: number): Date | null {
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const jd = day + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * rad) * 0.000289;
  const trueLng = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLng - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) / rad;
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)) / rad;
  const cosHa = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl * rad))) - Math.tan(lat * rad) * Math.tan(decl * rad);
  if (cosHa < -1 || cosHa > 1) return null;
  const ha = Math.acos(cosHa) / rad;
  const minutes = 720 - 4 * (lng + ha) - eqTime;
  return new Date((day * 1440 + minutes) * 60000);
}

export type SabbathState = { sabbath: boolean; next: Date; label: string; sunsetToday: Date | null };

/** Whether it is the Sabbath at `now` here, and when it next begins or ends. */
export function sabbath(now: Date, lat: number, lng: number): SabbathState | null {
  // Local day of week follows the sun, so decide by the last sunset before `now`.
  const today = sunsetUtc(now, lat, lng);
  if (!today) return null;
  const local = new Date(now.getTime() + lng * 240000); // 4 min per degree, for the weekday
  let dow = local.getUTCDay();
  // After sunset the biblical day has already turned.
  if (now >= today) dow = (dow + 1) % 7;
  const isSabbath = dow === 6;
  // Find the next sunset that matters: the start (Friday sunset) or the end (Saturday sunset).
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const s = sunsetUtc(d, lat, lng);
    if (!s || s <= now) continue;
    const ld = new Date(s.getTime() + lng * 240000 - 60000).getUTCDay();
    if (isSabbath && ld === 6) return { sabbath: true, next: s, label: "Sabbath ends at sunset", sunsetToday: today };
    if (!isSabbath && ld === 5) return { sabbath: false, next: s, label: "Sabbath begins at sunset", sunsetToday: today };
  }
  return null;
}

export function countdown(to: Date, now: Date): string {
  const ms = Math.max(0, to.getTime() - now.getTime());
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.round(h / 24)} days`;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m} min`;
}
