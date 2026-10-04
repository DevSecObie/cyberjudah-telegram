"""Validate this proposal against immutable library Git objects; never edit the library."""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def check(root, folder=HERE):
    people, timeline, evidence = [json.loads((folder / f'{name}.json').read_text())
                                  for name in ('people', 'timeline', 'evidence')]
    commit = evidence['commit']
    assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Source must be a pinned commit'
    cache = {}

    def source(file):
        if file not in cache:
            cache[file] = json.loads(subprocess.check_output(
                ['git', 'show', f'{commit}:{file}'], cwd=root))
        return cache[file]

    def verse(ref):
        book, chapter, number = ref.split('/')
        assert int(number) > 0, ref
        return source(f'data/bible/{book}.json')['chapters'][chapter][int(number) - 1]

    original = {p['id']: p for p in source('data/people/people.json')['people']}
    sample = {p['id']: p for p in people}
    assert len(sample) == len(people) == len(evidence['people']) == 10
    assert len(set(sample) - set(original)) == 8
    for row in evidence['people']:
        p = sample[row['id']]
        assert bool(p['id'] in original) == row['reuseExisting'], p['id']
        assert set(p) == set('id name names description type tribe father mother siblings partners children verses taught source'.split()), p['id']
        assert p['name'] in p['names'] and p['description']
        assert len(p['verses']) == len(set(p['verses'])), p['id']
        matched = set()
        for book in row['books']:
            for chapter, texts in source(f'data/bible/{book}.json')['chapters'].items():
                for number, text in enumerate(texts, 1):
                    if any(re.search(r'\b' + re.escape(form) + r'\b', text) for form in row['forms']):
                        matched.add(f'{book}/{chapter}/{number}')
        assert set(row['excludedMatches']) <= matched, p['id']
        assert all(row['excludedMatches'].values()), p['id']
        old = original.get(p['id'], {})
        assert set(p['verses']) == set(old.get('verses', [])) | (matched - set(row['excludedMatches'])), p['id']
        for ref in p['verses']:
            assert verse(ref), ref
        for ref in row['descriptionRefs']:
            assert ref in evidence['scripture'], ref
        for relation in ('father', 'mother', 'siblings', 'partners', 'children'):
            assert set(old.get(relation, [])) <= {r['id'] for r in p[relation]}, (p['id'], relation)
            for r in p[relation]:
                target = sample.get(r['id'], original.get(r['id']))
                assert target and r['name'] == target['name'], r
        if old:
            assert set(old['names']) <= set(p['names']) and 'CC BY 4.0' in p['source']['license']
        else:
            assert p['source']['name'] == 'King James Version with Apocrypha'
            assert re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*-(?:1ma|tob|jdt)-\d+-\d+', p['id'])
        assert commit in p['source']['url']
    for ref, text in evidence['scripture'].items():
        assert verse(ref) == text, f'Scripture changed: {ref}'
    for moment in evidence['moments']:
        s = moment['source']
        recording = source(moment['transcript'])
        assert moment['transcript'] == f'blog/transcripts/{s["id"]}.json'
        assert s['title'] == recording['title'] and s['date'] == (recording['date'] or '')
        seconds = sum(int(n) * factor for n, factor in zip(reversed(s['ts'].split(':')), (1, 60, 3600)))
        assert 0 <= seconds < recording['duration']
        assert s['url'] == f'https://youtu.be/{s["id"]}?t={seconds}'
        start, end = moment['segmentRange']
        assert seconds <= start <= end <= seconds + 600
        text = ' '.join(seg[1].removeprefix('>> ') for seg in recording['segments'] if start <= seg[0] <= end)
        assert moment['quote'] and moment['quote'] in text, f'Caption changed: {s["id"]}'
        if moment['teacher']:
            assert source(moment['teacherSource'])['teacher'] == moment['teacher']
    for p in people:
        for taught in p['taught']:
            m = next(m for m in evidence['moments'] if m['source']['id'] == taught['video'])
            assert taught['points'] == [m['quote']]
            assert taught['ts'] == m['source']['ts'] and taught['note']['teacher'] == m['teacher']
            assert taught['note']['label'] == m['source']['title'] and taught['note']['date'] == m['source']['date']
            assert m['source']['url'].endswith(f'?t={taught["t"]}')
            assert re.sub(r'^/bible/|#v', lambda match: '' if match[0] == '/bible/' else '/', taught['url']) in p['verses']
    assert len(timeline['events']) == len({e['slug'] for e in timeline['events']}) == 5
    for event in timeline['events']:
        assert event['status'] == 'proposal' and event['start'] is event['end'] is None
        assert set(event['people']) <= set(sample)
        assert all(0 <= i < len(evidence['moments']) for i in event['moments'])
        assert all(ref in evidence['scripture'] for ref in event['scriptureRefs'])
        date = event['date']
        assert date['precision'] in ('day', 'month', 'unknown')
        assert date['sourceRef'] is None or date['sourceRef'] in event['scriptureRefs']
        if date['precision'] != 'unknown':
            assert date['calendar'] and date['sourceRef']
        assert not re.search(r'\b(?:BCE?|CE|AD)\b', date['text']), event['slug']
    return f"10 people (8 new, 2 reused), 5 events, {len(evidence['scripture'])} exact scripture quotations, 4 verified caption excerpts"


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python check.py /path/to/cyberjudah')
    print(check(Path(sys.argv[1])))
