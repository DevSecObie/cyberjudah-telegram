// Relative ages and sequence: Genesis 17–50. See docs/TIMELINE-CHRONOLOGY.md.
// BC positions retain Abraham's inherited 1946 BC anchor, not a scripture-established
// absolute calendar. Unstated ages/durations retain the imported relative estimates.
// Set absolute values rather than adding offsets, so repeated builds are idempotent.
const DATES = {
  'abram-becomes-abraham-covenant-of-circumcision': [-1847, -1847],
  'isaac': [-1846, -1666],
  'lot-and-daughters-dwell-in-a-cave': [-1847, -1847],
  'sodom-destroyed': [-1847, -1847],
  'ishmael-mocks-isaac': [-1843, -1843],
  'abrahams-call-to-sacrifice-isaac': [-1826, -1826],
  'isaac-rebekah-married': [-1806, -1806],
  'jacob': [-1786, -1639],
  'esau': [-1786, -1650],
  'esau-sells-birthright-to-jacob': [-1755, -1755],
  'famine-in-the-land-isaac': [-1748, -1748],
  'esau-marries-two-wives': [-1746, -1746],
  'leah': [-1726, -1660],
  'rachel': [-1724, -1680],
  'zilpah': [-1722, -1665],
  'bilhah': [-1719, -1659],
  'jacob-fled-canaan-jacobs-ladder': [-1709, -1709],
  'esau-marries-third-wife': [-1709, -1709],
  'jacob-finishes-first-7-years-for-laban': [-1702, -1702],
  'jacob-marries-leah-and-rachel': [-1702, -1702],
  'reuben': [-1701, -1611],
  'simeon': [-1700, -1610],
  'levi': [-1699, -1562],
  'dan': [-1699, -1599],
  'gad': [-1699, -1595],
  'judah': [-1698, -1598],
  'naphtali': [-1698, -1600],
  'asher': [-1698, -1596],
  'issachar': [-1697, -1594],
  'zebulun': [-1696, -1597],
  'jacob-finishes-next-7-years-for-laban': [-1695, -1695],
  'dinah': [-1695, -1585],
  'joseph': [-1695, -1585],
  'jacob-leaves-haran': [-1689, -1689],
  'jacob-wrestles-angel': [-1689, -1689],
  'the-dinah-incident': [-1680, -1680],
  'benjamin': [-1680, -1680],
  'reuben-lays-with-bilhah': [-1680, -1680],
  'jacob-comes-to-hebron': [-1679, -1679],
  'josephs-dreams': [-1678, -1678],
  'joseph-taken-to-egypt': [-1678, -1678],
  'judah-leaves-marries-a-canaanite': [-1678, -1677],
  'potiphars-wife-incident': [-1668, -1668],
  'joseph-cast-into-prison': [-1668, -1665],
  'joseph-butler-and-baker-cast-into-prison': [-1667, -1667],
  'joseph-freed-pharaohs-dream-7-years-of-plenty': [-1665, -1665],
  'manasseh': [-1663, -1573],
  'ephraim': [-1660, -1570],
  'judah-impregnates-tamar': [-1659, -1659],
  'pharez-or-perez': [-1658, -1568],
  '7-year-drought-josephs-brothers-come-to-egypt': [-1658, -1651],
  'jacob-and-family-come-to-egypt': [-1656, -1656],
  'abraham': [-1946, -1771],
  'joseph-and-end-of-7-year-drought': [-1651, -1651]
};

export function applyTimelineChronology(sections) {
  for (const section of sections) for (const event of section.events) {
    const dates = DATES[event.slug];
    if (dates) [event.start, event.end] = dates;
  }
  return sections;
}
