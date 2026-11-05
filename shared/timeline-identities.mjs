// Explicit identity corrections backed by CyberJudah's published Bible and case data.
// A matching display name alone does not establish that two records are the same person.
export const lamechFatherOfNoah = {
  personId: 'lamech-gen-5-25',
  text: 'Lamech, the son of Methuselah and father of Noah, lived 777 years (Genesis 5:25–31). He is distinct from Lamech of Cain’s line in Genesis 4:18–24.',
  reference: { book: 'Genesis', chapter: 5, verses: '25-31', label: 'Genesis 5:25–31', url: '/bible/genesis/5#v25' },
  namesake: { name: 'Lamech of Cain’s line', url: '/cases/01-primeval/lamech' },
};

export function applyTimelineIdentities(sections) {
  for (const section of sections) for (const event of section.events) {
    if (event.slug !== 'lamech' || event.id !== 673) continue;
    event.title = 'Lamech, father of Noah';
    event.identityNote = structuredClone(lamechFatherOfNoah);
    event.cases = (event.cases ?? []).filter(item => item.slug !== 'lamech');
  }
  return sections;
}
