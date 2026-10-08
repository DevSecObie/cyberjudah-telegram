#!/usr/bin/env python3
"""Search the class transcripts and Our Hidden History episodes.
Usage: tsearch.py build
       tsearch.py find '<regex>' [--feed classes|history] [--n 30] [--ctx 240] [--after YYYY] [--title '<regex>']
       tsearch.py read <videoId> <m:ss|seconds> [--len 600]   (the transcript from that moment)
       tsearch.py titles '<regex>'                           (titles matching)
Results: date, feed, videoId, ts, title, snippet; each hit links https://youtu.be/<id>?t=<s>.
Set CJ_ROOT (or ROOT) to your checkout of DevSecObie/cyberjudah."""
import json, os, re, sys, glob, pickle, bisect
ROOT = os.environ.get("CJ_ROOT") or os.environ.get("ROOT")
IDX = os.path.join(os.path.dirname(__file__), "tindex.pkl")
def fmt(s):
    s = int(s); h, m = divmod(s, 3600); m, sec = divmod(m, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"
def build():
    if not ROOT or not os.path.isdir(os.path.join(ROOT, "blog", "transcripts")):
        sys.exit("set CJ_ROOT (or ROOT) to a checkout of DevSecObie/cyberjudah with blog/transcripts/")
    docs = []
    meta = {}
    for f in ("blog/channel-meta.tsv", "history/channel-meta.tsv"):
        for line in open(os.path.join(ROOT, f), encoding="utf-8"):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 4: meta[p[0]] = (p[1], p[3])
    for feed, d in (("classes", "blog/transcripts"), ("history", "history/transcripts")):
        for f in glob.glob(os.path.join(ROOT, d, "*.json")):
            try: t = json.load(open(f, encoding="utf-8"))
            except Exception: continue
            segs = t.get("segments") or []
            text, offs, starts = [], [], []
            n = 0
            for s in segs:
                if not isinstance(s, (list, tuple)) or len(s) < 2: continue
                offs.append(n); starts.append(float(s[0])); w = str(s[1]).strip() + " "; text.append(w); n += len(w)
            vid = t.get("videoId") or os.path.basename(f)[:-5]
            date = t.get("date") or (meta.get(vid, ("",""))[0])
            if date and len(date) == 8 and date.isdigit(): date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
            docs.append({"id": vid, "feed": feed, "title": t.get("title") or meta.get(vid, ("", ""))[1], "date": date or "", "dur": t.get("duration"), "text": "".join(text).lower(), "offs": offs, "starts": starts})
    pickle.dump(docs, open(IDX, "wb"))
    print(len(docs), "documents")
def load(): return pickle.load(open(IDX, "rb"))
def ts_of(d, pos):
    i = bisect.bisect_right(d["offs"], pos) - 1
    return d["starts"][max(i, 0)] if d["starts"] else 0
def args(a, k, dflt):
    return a[a.index(k) + 1] if k in a else dflt
def find(a):
    rx = re.compile(a[0], re.I); feed = args(a, "--feed", None); n = int(args(a, "--n", 30)); ctx = int(args(a, "--ctx", 240))
    after = args(a, "--after", ""); trx = args(a, "--title", None)
    hits = []
    for d in load():
        if feed and d["feed"] != feed: continue
        if after and d["date"] < after: continue
        if trx and not re.search(trx, d["title"] or "", re.I): continue
        ms = list(rx.finditer(d["text"]))
        if ms: hits.append((len(ms), d, ms))
    hits.sort(key=lambda h: (-h[0], h[1]["date"]))
    print(f"{len(hits)} recordings, {sum(h[0] for h in hits)} hits")
    for c, d, ms in hits[:n]:
        m = ms[0]; s = ts_of(d, m.start())
        print(f"\n[{c}] {d['date']} {d['feed']} {d['id']} {fmt(s)} https://youtu.be/{d['id']}?t={int(s)}\n    {d['title']}")
        for m in ms[:3]:
            s = ts_of(d, m.start()); a0 = max(0, m.start() - ctx // 2)
            print(f"    @{fmt(s)}: …{d['text'][a0:m.end() + ctx // 2]}…")
def read(a):
    vid = a[0]; t = a[1]; ln = int(args(a, "--len", 1500))
    sec = sum(float(x) * 60 ** i for i, x in enumerate(reversed(t.split(":")))) if ":" in t else float(t)
    for d in load():
        if d["id"] == vid:
            i = max(bisect.bisect_left(d["starts"], sec) - 1, 0)
            print(d["date"], d["title"], d["dur"])
            out, k = [], i
            while k < len(d["starts"]) and sum(len(x) for x in out) < ln:
                nxt = d["offs"][k + 1] if k + 1 < len(d["offs"]) else len(d["text"])
                out.append(f"[{fmt(d['starts'][k])}] " + d["text"][d["offs"][k]:nxt]); k += 1
            print("\n".join(out)); return
    print("not found")
def titles(a):
    rx = re.compile(a[0], re.I)
    for d in sorted(load(), key=lambda d: d["date"]):
        if rx.search(d["title"] or ""): print(d["date"], d["feed"], d["id"], int(d["dur"] or 0) // 60, "min", d["title"])
if __name__ == "__main__":
    c, rest = sys.argv[1], sys.argv[2:]
    {"build": lambda a: build(), "find": find, "read": read, "titles": titles}[c](rest)
