// What Ask reads from a person's entry (/api/people/<id>.json), as one paragraph. Each link keeps
// how it is known (its evidence label, verses, note and sources), so Ask never turns a priestly
// course or an uncertain identity into a family claim.
type Evidence = { evidence?: string; evidenceLabel?: string; verses?: string[]; note?: string; sources?: { title: string; url: string }[] };
type PersonRef = Evidence & { id: string; name: string };
export type PersonFull = {
  id: string; name: string; names?: string[]; description?: string; type?: string; tribe?: string;
  first?: string; verses?: number | string[]; summary?: string; classes?: unknown[];
  father?: PersonRef[]; mother?: PersonRef[]; siblings?: PersonRef[]; partners?: PersonRef[]; children?: PersonRef[];
  line?: PersonRef[]; descendants?: PersonRef[]; same?: PersonRef[]; alsoNamed?: PersonRef[]; priestly?: PersonRef[]; course?: PersonRef[];
  titles?: (Evidence & { title: string })[]; variants?: { reading: string; note?: string }[];
};

const evidence = (e: Evidence) => [
  e.evidenceLabel || e.evidence || "Evidence not labelled",
  e.verses?.length ? `Verses: ${e.verses.map((v) => v.replace(/\//g, " ")).join(", ")}` : "",
  e.note,
  e.sources?.length ? `Sources: ${e.sources.map((s) => `${s.title} <${s.url}>`).join("; ")}` : "",
].filter(Boolean).join(". ");

export function personDetails(p: PersonFull): string {
  const fam = (label: string, list?: PersonRef[]) => (list?.length ? `${label}: ${list.map((x) => x.name).join(", ")}.` : "");
  const links = (label: string, list?: PersonRef[]) => (list?.length ? `${label}: ${list.map((x) => `${x.name} (id ${x.id}; ${evidence(x)})`).join("; ")}.` : "");
  // The index gives a count; a person's own entry gives the list of verses.
  const count = Array.isArray(p.verses) ? p.verses.length : p.verses;
  const first = p.first || (Array.isArray(p.verses) ? p.verses[0] : undefined);
  return [
    p.description ? `${p.description}.` : "", p.names && p.names.length > 1 ? `Also called: ${p.names.join(", ")}.` : "", p.tribe ? `Tribe or people: ${p.tribe}.` : "",
    fam("Father", p.father), fam("Mother", p.mother), fam("Brothers and sisters", p.siblings), fam("Husbands and wives", p.partners), fam("Children", p.children),
    links("Forefathers named without the generations between", p.line), links("Descendants named without the generations between", p.descendants),
    links("Priestly course (not a direct-parent claim)", p.priestly), links("Members of this priestly course", p.course),
    links("Identity links; preserve each evidence qualification", p.same), links("Other entries linked to this person; preserve each evidence qualification", p.alsoNamed),
    ...(p.titles ?? []).map((t) => `Title: ${t.title} (${evidence(t)}).`),
    ...(p.variants ?? []).map((v) => `Textual variant: ${v.reading}${v.note ? `. ${v.note}` : ""}.`),
    first ? `First named at ${first.replace(/\//g, " ")}.` : "", count ? `Named in ${count} verses.` : "", p.summary ?? "",
  ].filter(Boolean).join(" ");
}
