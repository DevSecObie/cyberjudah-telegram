/**
 * Bible Strong's timeline, its layout maths ported as they are
 * (strong/apps/expo/src/features/timeline: constants.ts, timeline.hooks.ts): a period is a
 * canvas whose width is its span of years at `100 / interval` pixels a year, each event a bar
 * at its start year on one of 24 rows, and the year under a fixed line at 40% of the screen.
 * The data is app/src/data/timeline.json (app/scripts/timeline-data.mjs): their history with
 * our case studies attached.
 */

export const offsetTop = 50;
export const rows = 24;
export const rowHeight = 30;
export const rowGap = 10;
export const scrollViewHeight = offsetTop + rows * (rowHeight + rowGap);
export const rowToPx = (row) => offsetTop + row * (rowHeight + rowGap);
/** wp(40): the line stands at 40% of the viewport's width. */
export const lineOffset = (viewportWidth) => Math.round(viewportWidth * 0.4);

export const mapRange = (current, [fromMin, fromMax], [toMin, toMax]) => toMin + ((toMax - toMin) * (current - fromMin)) / (fromMax - fromMin);

/** An event's date as Bible Strong writes it (calculateLabel, English). */
export function calculateLabel(start, end) {
  const absStart = Math.abs(start), absEnd = Math.abs(end), range = Math.abs(start - end);
  if (start >= 3000 && end >= 3000) return "After the millennium";
  if (start >= 2010 && end >= 2010) return "Future";
  if (end === 2020) return `${absStart}-Future`;
  if (end === 1844) return "457 BC to 1844";
  if (start === end) return `${absStart}${start < 0 ? " BC" : ""}`;
  if (start < 0 && end < 0) return `${absStart}-${absEnd} BC${range > 50 ? ` (${range})` : ""}`;
  if (start > 0 && end > 0) return `${absStart}-${absEnd}${range > 50 ? ` (${range})` : ""}`;
  if (start < 0 && end > 0) return `${absStart} BC to ${end}${range > 50 ? ` (${range})` : ""}`;
  return String(start);
}

/** A period's canvas (useTimeline): its size, years to pixels and back, an event's width, and the year at the line. */
export function geometry({ startYear, endYear, interval }, viewportWidth, yearNow = new Date().getFullYear()) {
  const ratio = 100 / interval;
  const scrollViewWidth = Math.abs(startYear - endYear) * ratio;
  const width = scrollViewWidth + viewportWidth;
  const height = scrollViewHeight + 200;
  const yearRange = [startYear, endYear], timelineWidth = [0, scrollViewWidth];
  const yearsToPx = (years) => Math.round(mapRange(years, yearRange, timelineWidth));
  const pxToYears = (px) => Math.round(mapRange(px, timelineWidth, yearRange));
  const eventWidth = (start, end, isFixed) => {
    const years = Math.abs(start - end);
    return isFixed || yearsToPx(yearRange[0] + years) < 200 ? 200 : yearsToPx(yearRange[0] + years);
  };
  const offset = lineOffset(viewportWidth);
  /** The year under the line when the canvas is scrolled `scrollLeft` pixels. */
  const yearAt = (scrollLeft) => {
    const n = Math.round(Math.min(Math.max(mapRange(offset + scrollLeft, timelineWidth, yearRange), Math.min(startYear, endYear)), Math.max(startYear, endYear)));
    if (n >= yearNow) return "Future";
    return `${Math.abs(n)} ${n >= 0 ? "" : "BC"}`.trim();
  };
  /** How far through the period, 0-100 (the bar under the year). */
  const progress = (scrollLeft) => Math.round(Math.min(100, Math.max(0, (scrollLeft / Math.max(1, width - viewportWidth)) * 100)));
  return { ratio, scrollViewWidth, width, height, offset, yearsToPx, pxToYears, eventWidth, yearAt, progress };
}

/** The year marks of the date bar: every `interval` years from the start. */
export function dateMarks({ startYear, endYear, interval }) {
  const out = [];
  for (let year = startYear; year < endYear; year += interval) out.push(year);
  return out;
}

/** Every event once, with the index of the first period it appears in (Bible Strong repeats some across periods). */
export function flatten(sections) {
  const seen = new Map();
  sections.forEach((s, sectionIndex) => s.events.forEach((e) => { if (!seen.has(e.slug)) seen.set(e.slug, { ...e, sectionIndex }); }));
  return [...seen.values()];
}

/** An event opens when it has our content: case studies, a reign from Who's Who, or a Final Captivity account (Bible Strong opens only events with details). */
export const hasDetails = (e) => !!(e.cases?.length || e.reign || e.fc);

/** Events whose title or date contain every word of the query, in timeline order (their search lists events with details). */
export function searchEvents(sections, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return flatten(sections).filter((e) => hasDetails(e) && words.every((w) => `${e.title} ${calculateLabel(e.start, e.end)}`.toLowerCase().includes(w)));
}

/** Linked events: other events that share one of this event's case studies. */
export function linkedEvents(sections, slug) {
  const all = flatten(sections);
  const self = all.find((e) => e.slug === slug);
  if (!self?.cases?.length) return [];
  const mine = new Set(self.cases.map((c) => c.slug));
  return all.filter((e) => e.slug !== slug && e.cases?.some((c) => mine.has(c.slug)));
}
