# Research brief addendum: the twelve tribes' history (overrides parts of BRIEF.md)

The owner's instruction: "add all the history from Wikipedia and other sources — every single major
event that occurred to or with everyone on the 12 tribe chart." Read BRIEF.md first, then this file;
where they differ, THIS FILE WINS.

## The chart (as the assembly places the twelve tribes today; use these tribe names exactly)
Judah: the so-called African Americans · Benjamin: the West Indians · Levi: the Haitians ·
Simeon: the Dominicans · Zebulon: Guatemala to Panama · Ephraim: the Puerto Ricans ·
Manasseh: the Cubans · Gad: the North American Indians · Reuben: the Seminole Indians ·
Naphtali: Argentina and Chile · Asher: Colombia to Uruguay · Issachar: the Mexicans

## What changed from BRIEF.md
1. A class teaching moment is NO LONGER required. An event is published when it has documented
   history (`account`, `summary`) from sources you READ, cited in `sources`. Wikipedia is welcome
   (cite the exact article URL); prefer primary and institutional sources where you can reach them
   (national archives, loc.gov, nps.gov, museum and university pages, archive.org books).
   Where the classes DID teach the event, add `teaching` exactly as BRIEF.md rule 1–3 says (read the
   moment; verbatim `quote` only), because the app shows the classes' own words with their sources.
   Use tsearch sparingly (a few well-built regexes): it loads a large index.
2. Every event MUST have `"tribes": [...]` naming the tribe(s) on the chart it happened to or with
   (e.g. the Haitian Revolution → ["Levi"]; the Seminole Wars → ["Reuben"]; the Trail of Tears →
   ["Gad", "Reuben"] where the sources include the Seminoles; a US law aimed at all Black Americans →
   ["Judah"]). Keep `peoples` too (Black | Hispanic | Native).
3. "Major event" = conquest, enslavement, massacre, war, revolt, independence, law or decree that
   changed the people's condition, mass migration or removal, epidemic or disaster with documented
   mass death, landmark court case, coup or occupation, and the people's own landmark achievements
   and leaders. Cover the whole span the periods allow (1440 to today), not one era.
4. Periods (startYear..endYear must hold the event's `start`/`end`): into-the-ships 1440–1620,
   house-of-bondage 1615–1866, jim-crow 1863–1955, civil-rights-awakening 1953–2004,
   unto-this-day (“Redemption”) 2002–2027 (all modern history, including the existing IUIC entries).
   IUIC has no separate period; do not recreate one.
   `group`: one of GROUPS in check.mjs ("Caribbean and Latin America", "Native dispossession",
   "Resistance", "Slavery", "Other atrocities", "Achievements", "Civil rights", "Abolition",
   "Transatlantic trade", "African captivity", "Reconstruction and Jim Crow", "Identity and erasure").
5. Do NOT duplicate an existing event: the events already published are listed (slug | title | year |
   period) in app/scripts/final-captivity/research/existing-slugs.txt.
   If you find more to say about one of those, put it in "gaps" as "extends <slug>: ...".
6. Still strict: never invent; every number and date in `account` is in a cited source you read;
   `disagreements` where sources (or the classes) differ; no images; nothing about IUIC from outside
   (BRIEF rule 0). Neutral, plain, documented language in `summary`/`account`.
7. Aim: 30–45 well-supported events for your tribes, spread across the centuries, chronological.
   Quality and coverage over count; drafts for anything you could not source.

## Check your file before you finish
node app/scripts/final-captivity/research/checkbatch.mjs <your file>
It must print 0 problem(s) (it checks schema, periods, scripture refs, quotes against the transcripts,
duplicate slugs, and that every event names its tribes). Fix and re-run until it does.

## Added by the owner (applies now)
"Many of our classes address those things." For every major event you add, run a transcript search
(tsearch, one search at a time, a few well-built alternations per event: the event's name, the place,
the people) and, where a class taught it, add its `teaching` (read the moment; verbatim quote rules)
and the scriptures that class read with it. The classes' own words are the heart of this Timeline.
