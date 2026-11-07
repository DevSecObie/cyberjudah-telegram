"""Record small, public library excerpts. No user chats, model calls, or network access."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3

parser = argparse.ArgumentParser()
parser.add_argument("library", type=Path)
parser.add_argument("--output", type=Path, default=Path(__file__).parents[1] / "evals/grounding-recorded.json")
args = parser.parse_args()
db = sqlite3.connect(f"file:{args.library.resolve()}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
records = []

def add(question, kind, title, url, text, **metadata):
    # Extractive baseline only: copy one existing sentence/fragment without paraphrasing it.
    text = text.strip()
    quote = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)[0][:400]
    source = {"kind": kind, "title": title, "url": url, "text": text[:1000], **{k: v for k, v in metadata.items() if v}}
    records.append({"id": f"recorded-{len(records)+1:02}", "question": question, "source": source, "quote": quote})

verses = [("exodus",20,8),("exodus",20,12),("deuteronomy",6,5),("deuteronomy",10,12),("psalms",119,105),("psalms",119,11),("proverbs",4,7),("proverbs",3,5),("micah",6,8),("isaiah",1,18),("matthew",5,17),("john",8,32),("john",11,35),("john",14,15),("2-timothy",2,15),("james",1,22),("joshua",1,8),("sirach",1,1),("wisdom-of-solomon",1,1),("1-maccabees",2,50)]
for slug, chapter, verse in verses:
    row = db.execute("SELECT b.book,v.text FROM verses v JOIN books b ON b.slug=v.book_slug WHERE v.book_slug=? AND v.chapter=? AND v.verse=?", (slug,chapter,verse)).fetchone()
    title = f"{row['book']} {chapter}:{verse}"
    add(f"What does {title} say?", "verse", title, f"/bible/{slug}/{chapter}#v{verse}", row["text"])

for row in db.execute("SELECT law,section_title,text,url FROM laws ORDER BY id LIMIT 10"):
    add(f"What does library law {row['law']} say?", "law", f"{row['law']} · {row['section_title']}", row["url"], row["text"])

used = set()
for topic in ["Sabbath", "Passover", "Prayer", "Faith", "Repentance", "Forgiveness", "Commandments", "Wisdom"]:
    row = db.execute("SELECT * FROM notes WHERE kind='class' AND title LIKE ? AND length(plain)>400 ORDER BY date,url", (f"%{topic}%",)).fetchone()
    if row is None or row["url"] in used:
        row = db.execute("SELECT * FROM notes WHERE kind='study' AND title LIKE ? AND length(plain)>400 ORDER BY url", (f"%{topic}%",)).fetchone()
    assert row is not None and row["url"] not in used, topic
    used.add(row["url"])
    # Keep an existing sentence mentioning the selected topic, not a rewritten summary.
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", row["plain"])
    sentence = next((s for s in sentences if topic.lower() in s.lower() and len(s)>60), row["plain"])
    add(f"What does the recorded note say about {topic.lower()}?", "note", row["title"], row["url"], sentence, teacher=row["teacher"], date=row["date"])

for row in db.execute("SELECT name,summary,text,url FROM cases ORDER BY id LIMIT 5"):
    add(f"What does the library record about {row['name']}?", "case", row["name"], row["url"], row["summary"] or row["text"])

for row in db.execute("SELECT * FROM precepts ORDER BY slug LIMIT 5"):
    ref = db.execute("SELECT * FROM precept_refs WHERE slug=? ORDER BY rowid LIMIT 1", (row["slug"],)).fetchone()
    number = int(re.match(r"\d+", ref["verses"])[0])
    verse = db.execute("SELECT v.text FROM verses v JOIN books b ON b.slug=v.book_slug WHERE b.book=? AND v.chapter=? AND v.verse=?", (ref["book"], ref["chapter"], number)).fetchone()
    title = f"{ref['book']} {ref['chapter']}:{number}"
    add(f"What does {title}, listed for {row['title']}, say?", "verse", title, row["url"], verse["text"])

assert len(records) == 48
cases = []
for index, record in enumerate(records):
    actual = {**record["source"], "n": 1 if index % 2 == 0 else 2}
    other = next(candidate for candidate in records[index+1:]+records[:index] if record["quote"] not in candidate["source"]["text"])
    distractor = {**other["source"], "n": 2 if index % 2 == 0 else 1}
    sources = sorted([actual,distractor], key=lambda source:source["n"])
    quote = record["quote"]
    assert quote in actual["text"]
    cases.append({"id": record["id"], "question": record["question"], "retrieval": sources,
        "answer": f"> {quote} [{actual['n']}]", "claims": [{"text":quote,"support":[{"n":actual["n"],"quote":quote}]}]})
cases.extend([
    {"id":"gap-uncovered", "question":"What is the library's recommendation for servicing a spacecraft engine?", "retrieval":[], "answer":"I couldn't find enough library material to answer this reliably. Try naming the person, book, feast or verse you mean.", "claims":[], "non_claim":True},
    {"id":"greeting", "question":"Shalom!", "retrieval":[], "answer":"Shalom!", "claims":[], "non_claim":True},
])
payload={"version":1,"provenance":{"source":"public CyberJudah library.sqlite","sha256":hashlib.sha256(args.library.read_bytes()).hexdigest(),"method":"Extractive public-source snapshots; no private conversations and no generated teaching. Non-extractive claim annotations require reviewer approval."},"cases":cases}
args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2)+"\n")
print(f"Recorded {len(cases)} cases from public library data")
