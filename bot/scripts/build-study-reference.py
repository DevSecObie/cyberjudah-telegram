"""Build the server index from the exact published offline dictionary, preserving IDs.

Usage: python3 build-study-reference.py archive.zip catalog.json output.sql
Public editorial data only. Versioned rows keep the previous publication readable
until the final statement activates the fully imported revision.
"""
import hashlib
import html
import json
import pathlib
import re
import sqlite3
import sys
import tempfile
import zipfile


def build(archive_path, catalog_path, output_path):
    archive = pathlib.Path(archive_path).read_bytes()
    metadata = json.loads(pathlib.Path(catalog_path).read_text())["resources"]["database:JEWISH_ENCYCLOPEDIA:en"]
    if hashlib.sha256(archive).hexdigest() != metadata["archiveSha256"]:
        raise ValueError("Dictionary archive does not match its publication catalog")
    with zipfile.ZipFile(archive_path) as bundle:
        data = bundle.read("dictionnaire.sqlite")
    digest = hashlib.sha256(data).hexdigest()
    if digest != metadata["contentSha256"]:
        raise ValueError("Dictionary content does not match its publication catalog")
    revision = "jewish-" + digest
    quote = lambda value: "'" + str(value).replace("'", "''").replace("\x00", "") + "'"
    with tempfile.TemporaryDirectory() as directory:
        source = pathlib.Path(directory, "source.sqlite")
        source.write_bytes(data)
        db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Invalid source dictionary")
        rows = db.execute("SELECT id, word, sanitized_word, definition FROM dictionnaire ORDER BY id")
        with open(output_path, "w") as out:
            out.write("CREATE TABLE IF NOT EXISTS app_reference_publications (work TEXT PRIMARY KEY, revision TEXT NOT NULL, entries INTEGER NOT NULL);\n")
            out.write("CREATE TABLE IF NOT EXISTS app_reference_entries (revision TEXT NOT NULL, id INTEGER NOT NULL, word TEXT NOT NULL, normalized_word TEXT NOT NULL, definition TEXT NOT NULL, plain_text TEXT NOT NULL, PRIMARY KEY(revision,id));\n")
            out.write("CREATE INDEX IF NOT EXISTS app_reference_words ON app_reference_entries(revision,normalized_word,id);\n")
            out.write("CREATE VIRTUAL TABLE IF NOT EXISTS app_reference_search USING fts5(revision UNINDEXED, entry_id UNINDEXED, word, plain_text, tokenize='unicode61 remove_diacritics 2');\n")
            count = 0
            for identity, word, normalized, definition in rows:
                if identity < 1 or not word or not definition:
                    raise ValueError("Invalid dictionary entry")
                # The fixed content hash makes replay idempotent; existing published rows
                # are never deleted while a replacement is being imported.
                key = f"revision={quote(revision)} AND id={identity}"
                out.write(f"INSERT OR IGNORE INTO app_reference_entries VALUES ({quote(revision)},{identity},{quote(word)},{quote(normalized)},'','');\n")
                plain = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", definition))).strip()
                for column, value in [("definition", definition), ("plain_text", plain)]:
                    # D1 limits individual SQL statement size; long articles use bounded
                    # updates, while the activated revision always contains the full text.
                    for start in range(0, len(value), 8000):
                        chunk = quote(value[start:start + 8000])
                        expression = chunk if start == 0 else f"{column} || {chunk}"
                        out.write(f"UPDATE app_reference_entries SET {column}={expression} WHERE {key};\n")
                count += 1
            out.write(f"INSERT INTO app_reference_search(revision,entry_id,word,plain_text) SELECT revision,id,word,plain_text FROM app_reference_entries e WHERE revision={quote(revision)} AND NOT EXISTS (SELECT 1 FROM app_reference_search s WHERE s.revision={quote(revision)} LIMIT 1);\n")
            out.write(f"INSERT OR REPLACE INTO app_reference_publications VALUES ('jewish-encyclopedia',{quote(revision)},{count});\n")
        db.close()
    return {"revision": revision, "entries": count, "contentSha256": digest}


if __name__ == "__main__":
    print(json.dumps(build(*sys.argv[1:])))
