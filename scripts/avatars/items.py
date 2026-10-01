"""items.py <slice> <n>: read waits/<slice>-<n>.json (the jobs_wait JSON, optionally with extra
"regen": [{"id","job","url"}] and "reject": [{"id","reason"}]), write items/<slice>-<n>.json and sheet-<slice>-<n>.jpg."""
import json, sys, os, subprocess, re
from PIL import Image, ImageDraw
sl, n = sys.argv[1], int(sys.argv[2]); tag = f"{sl}-{n:02d}"
r = json.load(open(f"reqs/{tag}.json")); w = json.load(open(f"waits/{tag}.json"))
Q = {x['id']: x for x in json.load(open("queue-final.json"))}
by = {j['index']: j for j in w['jobs']}
items = []
for i, pid in enumerate(r['ids']):
    j = by.get(i)
    items.append({"id": pid, "job": j and j['job_id'], "url": j and j.get('result_url'), "keep": bool(j and j.get('result_url'))})
for g in w.get('regen', []):
    for it in items:
        if it['id'] == g['id']:
            it.update(job=g['job'], url=g['url'], keep=True)
            if os.path.exists(f"raw/{g['id']}.png"): os.remove(f"raw/{g['id']}.png")
for x in w.get('reject', []):
    for it in items:
        if it['id'] == x['id']: it.update(keep=False, reason=x['reason'])
os.makedirs("raw", exist_ok=True)
tiles = []
for k, it in enumerate(items):
    f = f"raw/{it['id']}.png"
    if it['url'] and not os.path.exists(f): subprocess.run(["curl", "-sSf", "--retry", "3", "-o", f, it['url']], check=True)
    t = Image.new("RGB", (320, 350), (20, 20, 20))
    if os.path.exists(f): t.paste(Image.open(f).convert("RGB").resize((320, 320)), (0, 0))
    q = Q[it['id']]
    ImageDraw.Draw(t).text((6, 326), f"{k} {q['name'][:16]} | {'F' if q['type']=='Female' else 'M'} | {q['n']} | {q['tribe'][:14]} | {re.split(r' living| of the time| at the time', q['desc'])[0][:20]}" + ("" if it['keep'] else " | REJECTED"), fill=(255, 255, 255))
    tiles.append(t)
m = Image.new("RGB", (1280, 350 * ((len(tiles) + 3) // 4)))
for k, t in enumerate(tiles): m.paste(t, ((k % 4) * 320, (k // 4) * 350))
m.save(f"sheet-{tag}.jpg", quality=85)
json.dump({"batch": tag, "items": items}, open(f"items/{tag}.json", "w"), indent=1)
print("sheet", f"sheet-{tag}.jpg", "kept", sum(i['keep'] for i in items), "of", len(items))
