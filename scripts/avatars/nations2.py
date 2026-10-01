"""Phase 2: nations from the assembly's chart (Genesis 10), corrections from the KJV, and lineage by
fathers' house (Numbers 1:18). Prints the resolved nation for every record not already queued."""
import json, re, collections
L = json.load(open('/home/user/cyberjudah/data/people/people.json'))['people']
if isinstance(L, dict): L = list(L.values())
by = {x['id']: x for x in L}
TAG = {'Moab': 'moab', 'Ammon': 'ammon', 'Arabia': 'ishmael', 'Syria': 'syria', 'Assyria': 'assyria'}
FIX = {  # KJV and the classes over the data's tag
 'og-num-21-33': ('ham', 'Canaan (an Amorite)'), 'sihon-num-21-21': ('ham', 'Canaan (an Amorite)'), 'debir-jos-10-3': ('ham', 'Canaan (an Amorite)'),
 'hiram-2sa-5-11': ('ham', 'Tyre (Canaan)'), 'ethbaal-1ki-16-31': ('ham', 'Zidon (Canaan)'), 'toi-2sa-8-9': ('ham', 'Hamath (Canaan)'),
 'agag-1sa-15-8': ('edom', 'Amalek'), 'agag-num-24-7': ('edom', 'Amalek'), 'haman-est-3-1': ('edom', 'Amalek (the Agagite)'),
 'sennacherib-2ki-18-13': ('assyria', 'Assyria'), 'chedorlaomer-gen-14-1': ('elam', 'Elam'),
 'dinah-gen-30-21': ('israel', 'Israel'),
 # Herod the Great is Edom (the approved direction); the data tags him "Canaan"
 'herod-mat-2-1': ('edom', 'Edom'), 'herod-act-12-1': ('edom', 'Edom'), 'herod-mat-14-1': ('edom', 'Edom'),
 # by their generations in Genesis
 'ham-gen-5-32': ('ham', 'Ham'), 'japheth-gen-5-32': ('japheth', 'Japheth'),
}
# The Hebrew line, Shem to Terah, and the houses of Terah and Nahor (Genesis 11:10-32; 22:20-24; 24; 29)
HEBREW = '''arpachshad-gen-10-22 shelah-gen-10-24 cainan-luk-3-36 eber-gen-10-21 peleg-gen-10-25 reu-gen-11-18 serug-gen-11-20
 nahor-gen-11-22 terah-gen-11-24 haran-gen-11-26 nahor-gen-11-26 sarah-gen-11-29 milcah-gen-11-29 iscah-gen-11-29
 lot-gen-11-27 daughter1-of-lot-gen-19-37 daughter2-of-lot-gen-19-38 bethuel-gen-22-22 laban-gen-24-29 rebekah-gen-22-23
 rachel-gen-29-6 leah-gen-29-16 uz-gen-22-21 buz-gen-22-21 kemuel-gen-22-21 aram-gen-22-21 chesed-gen-22-22 hazo-gen-22-22
 pildash-gen-22-22 jidlaph-gen-22-22 tebah-gen-22-24 gaham-gen-22-24 tahash-gen-22-24 maacah-gen-22-24'''.split()
FIX.update({h: ('hebrew', 'the house of Terah (Hebrew)') for h in HEBREW})
# The classes: Keturah's sons are Arabs with Ishmael's ("the sons of Ishmael joined with the sons of Keturah"); Midian is Keturah's son
KETURAH = '''zimran-gen-25-2 jokshan-gen-25-2 medan-gen-25-2 midian-gen-25-2 ishbak-gen-25-2 shuah-gen-25-2 sheba-gen-25-3 dedan-gen-25-3
 ephah-gen-25-4 epher-gen-25-4 hanoch-gen-25-4 abida-gen-25-4 eldaah-gen-25-4 jethro-exo-2-18 zipporah-exo-2-21 hobab-num-10-29
 zebah-jdg-8-5 zalmunna-jdg-8-5 evi-num-31-8 rekem-num-31-8 zur-num-31-8 hur-num-31-8'''.split()
FIX.update({k: ('ishmael', 'Keturah (the Arabs)') for k in KETURAH})
HOLD = {'joktan-gen-10-25', 'lud-gen-10-22', 'melchizedek-gen-14-18', 'rechab-2ki-10-15', 'jonadab-2ki-10-15'} | set('talmai-2sa-3-3 jozacar-2ki-12-21 jehozabad-2ki-12-21 shomer-2ki-12-21 amasa-2sa-17-25 hiram-1ki-7-13 aretas-2co-11-32 herod-mat-14-1 og-num-21-33'.split()) - {'og-num-21-33'}
ROOTS = {  # eponyms named in the chart, and their sons by Genesis 10
 'ham': 'cush-gen-10-6 egypt-gen-10-6 put-gen-10-6 canaan-gen-9-18'.split(),
 'japheth': 'gomer-gen-10-2 magog-gen-10-2 madai-gen-10-2 javan-gen-10-2 tubal-gen-10-2 meshech-gen-10-2 tiras-gen-10-2'.split(),
 'elam': ['elam-gen-10-22'], 'assyria': ['asshur-gen-10-22'], 'syria': ['aram-gen-10-22'],
}
LABEL = {'ham': None, 'japheth': 'Japheth', 'elam': 'Elam', 'assyria': 'Assyria', 'syria': 'Aram (Syria)', 'moab': 'Moab', 'ammon': 'Ammon', 'ishmael': 'Ishmael', 'israel': None, 'edom': None}
def base(x):
    t = (x.get('tribe') or '').strip().lstrip('>')
    if x['id'] in FIX: return FIX[x['id']]
    if x['id'] in HOLD: return None
    if t.startswith('Tribe of') or t == 'Israel': return ('israel', t)
    if t in ('Edom', 'Italy'): return ('edom', t)
    if t in ('Egypt', 'Cush', 'Canaan', 'Philistia'): return ('ham', t)
    if t in TAG: return (TAG[t], t)
    return None
res = {}
for x in L:
    b = base(x)
    if b: res[x['id']] = b
for n, roots in ROOTS.items():
    for r in roots: res[r] = (n, by[r]['name'] if n == 'ham' else LABEL[n])
# fathers' house, repeated until nothing changes; only where the father's nation is known
changed = True
while changed:
    changed = False
    for x in L:
        if x['id'] in res or x['id'] in HOLD: continue
        fs = [res.get(f) for f in x.get('father', []) if f in by]
        fs = [f for f in fs if f]
        if fs and all(f[0] == fs[0][0] for f in fs):
            res[x['id']] = (fs[0][0], fs[0][1]); changed = True
def eligible(x):
    d = x.get('description', '')
    return (x['type'] in ('Male', 'Female') and not x['id'].startswith('jesus-') and x['id'] not in HOLD
            and not re.search(r'\bor town\b|\(\?\)\s+living|compatriots\b|^People\b|^Warriors\b|-wives-', d + ' ' + x['id']))
res = {k: v for k, v in res.items() if eligible(by[k])}
json.dump(res, open('nations2.json', 'w'), indent=0)
if __name__ == '__main__':
    q1 = {r['id'] for r in json.load(open('queue-final.json'))} | set(json.load(open('/home/user/cyberjudah-telegram/app/public/people/manifest.json'))['people'])
    new = [(k, v) for k, v in res.items() if k not in q1]
    print(len(res), 'resolved;', len(new), 'not yet queued')
    print(collections.Counter(v[0] for k, v in new))
