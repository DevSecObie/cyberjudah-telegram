/**
 * "Of the day" picks, as Bible Strong's Home makes them (StrongOfTheDay, NaveOfTheDay,
 * WordOfTheDay): one item from a list, the same for everyone all day, a new one tomorrow.
 * The day of the year seeds a small hash so consecutive days do not land on neighbours.
 */
export function dayIndex(date = new Date()): number {
  const start = Date.UTC(date.getFullYear(), 0, 1);
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - start) / 86_400_000);
  return date.getFullYear() * 400 + day;
}
/** A deterministic pick for the day out of `n` items; `salt` separates lists shown side by side. */
export function pickOfDay(n: number, salt = 0, date = new Date()): number {
  if (n <= 0) return 0;
  let h = (dayIndex(date) + 1) * 2654435761 + salt * 40503;
  h = (h ^ (h >>> 15)) * 2246822519;
  h = (h ^ (h >>> 13)) * 3266489917;
  return Math.abs((h ^ (h >>> 16)) >>> 0) % n;
}
/** A random pick, for the "Random" button. */
export const pickRandom = (n: number) => Math.floor(Math.random() * Math.max(1, n));
