type Evidence = { evidence?: string; evidenceLabel?: string; verses?: string[]; note?: string; sources?: { id: string; locator: string }[] };
type PersonRef = Evidence & { id: string; name: string };
export type PersonFull = {
  id: string; name: string; names?: string[]; description?: string; tribe?: string;
  first?: string; verses?: number | string[]; summary?: string;
  father?: PersonRef[]; mother?: PersonRef[]; siblings?: PersonRef[]; partners?: PersonRef[]; children?: PersonRef[];
  line?: PersonRef[]; descendants?: PersonRef[]; same?: PersonRef[]; alsoNamed?: PersonRef[]; priestly?: PersonRef[]; course?: PersonRef[];
  titles?: (Evidence & { title: string })[]; variants?: { reading: string; note?: string }[];
};

const evidence = (e: Evidence) => [e.evidenceLabel || e.evidence || "Evidence not labelled", e.verses?.length ? `Verses: ${e.verses.join(", ")}` : "", e.note, e.sources?.length ? `Sources: ${e.sources.map(s => `${s.id}, ${s.locator}`).join("; ")}` : ""].filter(Boolean).join(". ");

/** Preserve the catalog's distinctions instead of turning a course or uncertain identity into ancestry. */
export function personDetails(p: PersonFull): string {
  const fam = (label: string, list?: PersonRef[]) => list?.length ? `${label}: ${list.map(x => x.name).join(", ")}.` : "";
  const links = (label: string, list?: PersonRef[]) => list?.length ? `${label}: ${list.map(x => `${x.name} (id ${x.id}; ${evidence(x)})`).join("; ")}.` : "";
  const count = Array.isArray(p.verses) ? p.verses.length : p.verses;
  const first = p.first || (Array.isArray(p.verses) ? p.verses[0] : undefined);
  return [
    p.description, p.names && p.names.length > 1 ? `Also called: ${p.names.join(", ")}.` : "", p.tribe ? `Tribe or people: ${p.tribe}.` : "",
    fam("Father", p.father), fam("Mother", p.mother), fam("Brothers and sisters", p.siblings), fam("Husbands and wives", p.partners), fam("Children", p.children),
    links("Forefathers named without the generations between", p.line), links("Descendants named without the generations between", p.descendants),
    links("Priestly course (not a direct-parent claim)", p.priestly), links("Members of this priestly course", p.course),
    links("Identity links; preserve each evidence qualification", p.same), links("Other entries linked to this person; preserve each evidence qualification", p.alsoNamed),
    ...(p.titles ?? []).map(t => `Title: ${t.title} (${evidence(t)}).`),
    ...(p.variants ?? []).map(v => `Textual variant: ${v.reading}${v.note ? `. ${v.note}` : ""}.`),
    first ? `First named at ${first.replace(/\//g, " ")}.` : "", count ? `Named in ${count} verses.` : "", p.summary,
  ].filter(Boolean).join(" ");
}
