"""mk.py <slice name> <n>: write reqs/<slice>-<n>.json, the 12 requests for batch n (0-based) of slice <slice>."""
import json, sys, prompt
sl, n = sys.argv[1], int(sys.argv[2])
ids = json.load(open(f"slice-{sl}.json"))[n * 12:(n + 1) * 12]
Q = {r['id']: r for r in json.load(open("queue-final.json"))}
reqs = [{"index": i, "params": {"model": "nano_banana_pro", "prompt": prompt.prompt(Q[x]), "aspect_ratio": "1:1", "resolution": "1k", "folder_id": "22db2a18-abfd-42c0-b1bd-415b8a4a4917"}} for i, x in enumerate(ids)]
json.dump({"ids": ids, "requests": reqs}, open(f"reqs/{sl}-{n:02d}.json", "w"))
print(json.dumps(reqs) if ids else "EMPTY")
