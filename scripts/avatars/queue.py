import json, re, hashlib, sys
L = json.load(open('/home/user/cyberjudah/data/people/people.json'))['people']
if isinstance(L, dict): L = list(L.values())
done = set(json.load(open('/home/user/cyberjudah-telegram/app/public/people/manifest.json'))['people'])
skipped = set(json.load(open(sys.argv[1]))) if len(sys.argv) > 1 else set()
HAM = {'Egypt', 'Cush', 'Canaan', 'Philistia'}
EDOM = {'Edom', 'Italy'}
def nation(t):
    t = t.strip().lstrip('>')
    if t.startswith('Tribe of') or t == 'Israel': return 'israel'
    if t in EDOM: return 'edom'
    if t in HAM: return 'ham'
    return None
# Records the data tags wrongly (corrected by the classes' teaching and the KJV), or that the brief leaves out (see docs/AVATARS.md, section 3).
HORITES = "seir-gen-36-20 lotan-gen-36-20 shobal-gen-36-20 zibeon-gen-36-2 anah-gen-36-2 dishon-gen-36-21 ezer-gen-36-21 dishan-gen-36-21 hori-gen-14-6 hemam-gen-36-22 timna-gen-36-12 alvan-gen-36-23 manahath-gen-36-23 ebal-gen-36-23 shepho-gen-36-23 onam-gen-36-23 aiah-gen-36-24 dishon-gen-36-25 hemdan-gen-36-26 eshban-gen-36-26 ithran-gen-36-26 cheran-gen-36-26 bilhan-gen-36-27 zaavan-gen-36-27 akan-gen-36-27 uz-gen-36-28 aran-gen-36-28 oholibamah-gen-36-2".split()
EXCLUDE = {"melchizedek-gen-14-18", "rechab-2ki-10-15", "jonadab-2ki-10-15", "jerusalem-wives-2sa-5-13"}
# Hittites are of Canaan (Genesis 10:15); Jezebel was a Zidonian (1 Kings 16:31).
REASSIGN = {"elon-gen-26-34": ("ham", "Canaan (a Hittite)"), "beeri-gen-26-34": ("ham", "Canaan (a Hittite)"),
            "adah-gen-26-34": ("ham", "Canaan (a Hittite)"), "judith-gen-26-34": ("ham", "Canaan (a Hittite)"),
            "jezebel-1ki-16-31": ("ham", "Zidon (Canaan)")}
# The class: the Horites of Seir were "a group of Hamites named after the region they lived in".
REASSIGN.update({h: ("ham", "Seir (a Horite)") for h in HORITES})
out = []
for x in L:
    if x['type'] not in ('Male', 'Female') or x['id'] in done or x['id'] in skipped: continue
    if x['id'].startswith('jesus-'): continue
    if x['id'] in EXCLUDE: continue
    d = x.get('description', '')
    if re.search(r'\bor town\b|\(\?\)\s+living|compatriots\b', d): continue
    n = nation(x.get('tribe') or '>'); tribe = x.get('tribe')
    if x['id'] in REASSIGN: n, tribe = REASSIGN[x['id']]
    if not n: continue
    out.append((len(x.get('verses', [])), dict(x, tribe=tribe, description=re.sub(r'\s*\S*@\S*', '', d).strip()), n))
out.sort(key=lambda r: -r[0])
json.dump([{'id': x['id'], 'name': x['name'], 'n': n, 'tribe': x['tribe'], 'type': x['type'], 'desc': x.get('description', ''), 'verses': v} for v, x, n in out], open(sys.argv[2] if len(sys.argv) > 2 else '/dev/stdout', 'w'), indent=0)
