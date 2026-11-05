#!/usr/bin/env python3
"""Derive public online BHG assets from the existing, catalog-verified offline archives.

No network, publication, source edits or synthesized text/alignment. A fresh output directory
is required; manifest.json is written last, only after every chapter validates.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import zipfile


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_archive(root, entry):
    raw = (root / 'public/offline' / entry['file']).read_bytes()
    assert len(raw) == entry['archiveBytes'] and digest(raw) == entry['archiveSha256'], 'Archive integrity mismatch'
    import io
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        assert archive.namelist() == [entry['entry']], 'Unexpected archive members'
        content = archive.read(entry['entry'])
    canonical = entry['entries']['canonical']
    assert len(content) == canonical['bytes'] and digest(content) == canonical['sha256'], 'Content integrity mismatch'
    return content


def build(root, output):
    assert not output.exists(), 'Use a fresh output directory'
    catalog = json.loads((root / 'src/assets/cyberjudah/offline-catalog.json').read_text())['resources']
    base_entry, token_entry = catalog['bible:BHG'], catalog['bible-interlinear:BHG:en']
    base_raw = read_archive(root, base_entry)
    base = json.loads(base_raw)
    tokens_raw = read_archive(root, token_entry)
    revision, text_hash = base['textRevision'], base['textSha256']
    assert base['applicationVersionId'] == 'BHG' and base['datasetId'] == 'CYBERJUDAH'
    for entry in [base_entry, token_entry]:
        assert entry['textRevision'] == revision and entry['textSha256'] == text_hash, 'Catalog text mismatch'
    resource = dict(kind='bible-text', versionId='BHG', revision='cj-bhg-' + revision,
                    textRevision=revision, textSha256=text_hash)
    interlinear = dict(kind='interlinear-index', versionId='BHG', datasetId='CYBERJUDAH', language='en',
                       revision='cj-bhg-en-' + token_entry['contentSha256'], textRevision=revision, textSha256=text_hash)
    files, chapters_by_book, verse_counts = {}, {}, {}
    output.mkdir(parents=True)

    def emit(path, value):
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        dest = output / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        files[path] = digest(raw)

    sql = '''SELECT v.verse,t.id,t.readingOrdinal,t.startOffset,t.length,
        s.ordinal,s.startOffset,s.length,tr.value,l.value,m.code,g.text,c0.code,c1.code,c2.code,c3.code
        FROM Verses v JOIN Tokens t ON t.verseId=v.id JOIN Segments s ON s.tokenId=t.id
        JOIN Transliterations tr ON tr.id=s.transliterationId JOIN Lemmas l ON l.id=s.lemmaId
        JOIN Morphologies m ON m.id=s.morphologyId JOIN Glosses g ON g.id=s.glossId
        LEFT JOIN StrongCodes c0 ON c0.id=s.strongCodeId LEFT JOIN StrongCodes c1 ON c1.id=s.eStrongCodeId
        LEFT JOIN StrongCodes c2 ON c2.id=s.dStrongCodeId LEFT JOIN StrongCodes c3 ON c3.id=s.uStrongCodeId
        WHERE v.bookOrder=? AND v.chapter=? ORDER BY v.verse,t.readingOrdinal,s.ordinal'''
    verse_total = token_total = segment_total = 0
    with tempfile.TemporaryDirectory(prefix='cj-interlinear-') as tmp:
        db_path = Path(tmp) / 'tokens.sqlite'
        db_path.write_bytes(tokens_raw)
        with sqlite3.connect('file:' + str(db_path) + '?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Invalid SQLite archive'
            meta = dict(db.execute('SELECT key,value FROM ResourceMetadata'))
            assert meta['datasetId'] == 'CYBERJUDAH' and meta['locale'] == 'en' and meta['schemaVersion'] == '5'
            assert meta['textRevision'] == revision and meta['textSha256'] == text_hash, 'Token text mismatch'
            for book_key, chapters in sorted(base['verses'].items(), key=lambda p: int(p[0])):
                book = int(book_key)
                assert 1 <= book <= 66
                chapters_by_book[book_key] = []
                for chapter_key, verses in sorted(chapters.items(), key=lambda p: int(p[0])):
                    chapter = int(chapter_key)
                    assert 1 <= chapter <= 200
                    chapters_by_book[book_key].append(chapter)
                    text_verses, by_verse, by_token = [], {}, {}
                    for key, verse in sorted(verses.items(), key=lambda p: int(p[0])):
                        number = int(key)
                        assert 0 <= number <= 200 and isinstance(verse['text'], str)
                        text_verses.append(dict(number=number, text=verse['text'], presentation={
                            key: verse.get(key, []) for key in ['startTags', 'layout', 'notes', 'headings']}))
                    for row in db.execute(sql, (book, chapter)):
                        verse, token_id, ordinal, start, length, seg_ordinal, seg_start, seg_length, tr, lemma, morph, gloss, *codes = row
                        assert str(verse) in verses and token_id > 0 and ordinal >= 0
                        assert start >= 0 and length >= 0 and start + length <= len(verses[str(verse)]['text'].encode('utf-16-le')) // 2, 'Token offset mismatch'
                        assert seg_ordinal >= 0 and seg_start >= 0 and seg_length >= 0 and seg_start + seg_length <= length, 'Segment offset mismatch'
                        if token_id not in by_token:
                            token = dict(id=token_id, ordinal=ordinal, startOffset=start, length=length, segments=[])
                            by_token[token_id] = token
                            by_verse.setdefault(verse, []).append(token)
                            token_total += 1
                        identities = [dict(kind=kind, code=code) for kind, code in zip(['strong', 'estrong', 'dstrong', 'ustrong'], codes) if code]
                        by_token[token_id]['segments'].append(dict(ordinal=seg_ordinal, startOffset=seg_start, length=seg_length,
                            transliteration=tr, lemma=lemma, morphology=morph, gloss=gloss, identities=identities))
                        segment_total += 1
                    verse_total += len(text_verses)
                    verse_counts[f'{book}-{chapter}'] = len(text_verses)
                    emit(f'text/{book}/{chapter}.json', dict(resource=resource, book=book, chapter=chapter, verses=text_verses))
                    emit(f'en/{book}/{chapter}.json', dict(resource=interlinear, book=book, chapter=chapter,
                         verses=[dict(number=v['number'], tokens=by_verse.get(v['number'], [])) for v in text_verses]))
            # Catch rows lost by joins or pointing outside the canonical publication.
            assert token_total == db.execute('SELECT count(*) FROM Tokens').fetchone()[0], 'Unrepresented tokens'
            assert segment_total == db.execute('SELECT count(*) FROM Segments').fetchone()[0], 'Unrepresented segments'
    assert verse_total == base['verseCount'], 'Verse count mismatch'
    coverage = dict(books=list(map(int, chapters_by_book)), chaptersByBook=chapters_by_book, verseCountByBookChapter=verse_counts)
    emit('text/coverage.json', dict(resource=resource, canon=dict(id='protestant-66', orderedBooks=coverage['books']), versification='bible-strong-default', **coverage))
    emit('en/coverage.json', dict(resource=interlinear, **coverage))
    manifest = dict(version=1, datasetId='CYBERJUDAH', textRevision=revision, textSha256=text_hash,
                    sourceArchives=[base_entry['archiveSha256'], token_entry['archiveSha256']], files=files)
    (output / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    return dict(chapters=len(verse_counts), verses=verse_total, tokens=token_total, segments=segment_total,
                files=len(files), textSha256=text_hash, output=str(output))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expo-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.expo_root, args.output), indent=2))
