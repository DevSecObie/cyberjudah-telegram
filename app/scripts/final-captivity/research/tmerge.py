"""Add a tribes batch to the branch's events.json / drafts.json / ledger.json (additive).
Usage: tmerge.py <batch.json>...
Set FINAL_CAPTIVITY_ROOT to merge into a throwaway copy of the four JSON files
instead of the ones next to this script (used by the test suite)."""
import json, os, sys
R = os.environ.get("FINAL_CAPTIVITY_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda n: os.path.join(R, n)
order = [p["id"] for p in json.load(open(P("periods.json")))["periods"]]
events, drafts, ledger = json.load(open(P("events.json"))), json.load(open(P("drafts.json"))), json.load(open(P("ledger.json")))
dlist = drafts if isinstance(drafts, list) else drafts.setdefault("drafts", [])
seen = {e["slug"] for e in events} | {e["slug"] for e in dlist}
srcs = ledger.setdefault("sources", [])
have = {json.dumps(s, sort_keys=True) for s in srcs}
for f in sys.argv[1:]:
    b = json.load(open(f)); added = [0, 0]
    for kind, out, st, i in (("events", events, "published", 0), ("drafts", dlist, "draft", 1)):
        for e in b.get(kind, []):
            if e["slug"] in seen: print("skip duplicate", e["slug"]); continue
            seen.add(e["slug"]); e["status"] = st; out.append(e); added[i] += 1
    for s in b.get("ledger", []):
        k = json.dumps(s, sort_keys=True)
        if k not in have: have.add(k); srcs.append(s)
    print(os.path.basename(f), "events +%d drafts +%d" % tuple(added))
key = lambda e: (order.index(e["period"]) if e.get("period") in order else 99, e.get("start") or 0, e.get("end") or 0)
first = {}
for i, x in enumerate(events): first.setdefault(x["period"], i)
events.sort(key=lambda x: (first[x["period"]], x.get("start") or 0))  # stable: within each period by start
for n, d in (("events.json", events), ("drafts.json", drafts), ("ledger.json", ledger)):
    json.dump(d, open(P(n), "w"), indent=1, ensure_ascii=False); open(P(n), "a").write("\n")
