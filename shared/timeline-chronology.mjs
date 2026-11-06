// Relative ages come from the KJV; BC positions remain the inherited chart's chronology.
// Four independent existing anchors agree on Abraham's start:
// - death -1771 minus 175 years (Genesis 25:7)
// - Ishmael's birth -1860 minus 86 years (Genesis 16:16)
// - departure from Haran -1871 minus 75 years (Genesis 12:4)
// - Sarah's birth -1936 minus their ten-year age difference (Genesis 17:17).
// This does not resolve Isaac's separate five-year conflict or move his descendants.
export function applyTimelineChronology(sections) {
  for (const section of sections) for (const event of section.events) {
    if (event.id === 640 && event.slug === 'abraham') event.start = -1946;
  }
  return sections;
}
