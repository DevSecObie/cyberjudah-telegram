#!/usr/bin/env python3
"""Prepare a verified Bible-only embedding input locally. No network or index writes."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('owned_archives', Path(__file__).with_name('build-online-interlinear.py'))
archives = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archives)


def prepare(root, output):
    assert not output.exists(), 'Use a fresh output directory'
    server = Path(__file__).resolve().parent.parent
    meta = json.loads((server / 'data/bs-metadata.json').read_text())
    books = {b['id']: b for b in json.loads((server / 'data/bs-books.json').read_text())}
    entry = json.loads((root / 'src/assets/cyberjudah/offline-catalog.json').read_text())['resources']['bible:KJV']
    canonical = json.loads(archives.read_archive(root, entry))
    revision = meta['textSha256']
    assert canonical['applicationVersionId'] == 'KJV' and canonical['datasetId'] == 'CYBERJUDAH'
    assert canonical['textSha256'] == revision == entry['textSha256'], 'KJV publication mismatch'
    records, chapters = [], set()
    for b, chapter_map in sorted(canonical['verses'].items(), key=lambda p: int(p[0])):
        book = int(b)
        for ch, verse_map in sorted(chapter_map.items(), key=lambda p: int(p[0])):
            chapter = int(ch)
            projection = [[int(v), data['text']] for v, data in sorted(verse_map.items(), key=lambda p: int(p[0]))]
            key = f'{book}-{chapter}'
            assert len(projection) == meta['verseCountByBookChapter'][key]
            assert archives.digest(json.dumps(projection, ensure_ascii=False, separators=(',', ':')).encode()) == meta['chapterHashes'][key], 'Canonical chapter hash mismatch'
            chapters.add(key)
            for verse, text in projection:
                assert verse > 0 and isinstance(text, str)
                records.append(dict(id=f'KJV:{book}:{chapter}:{verse}', text=f"{books[book]['name']} {chapter}:{verse}\n{text}",
                    metadata=dict(book=book, chapter=chapter, verse=verse, revision=revision, text=text)))
    assert chapters == set(meta['chapterHashes']) and len(records) == canonical['verseCount'], 'Incomplete canonical coverage'
    raw = ''.join(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n' for r in records).encode()
    manifest = dict(version=1, model='@cf/baai/bge-m3', dimensions=1024, revision=revision,
        recordCount=len(records), sha256=archives.digest(raw), sourceArchiveSha256=entry['archiveSha256'],
        sourceContentSha256=entry['contentSha256'], metadataIndexes={'book': 'number', 'revision': 'string'})
    output.mkdir(parents=True)
    (output / 'records.ndjson').write_bytes(raw)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expo-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.expo_root, args.output), indent=2))
