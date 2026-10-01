"""ingest.py batch.json  — batch.json: {"batch": "2", "items": [{"id","job","url","keep":true}]}; downloads, reviews sheet, adds kept ones to app."""
import json, sys, os, subprocess, prompt
from PIL import Image
APP = "/home/user/cyberjudah-telegram/app"
b = json.load(open(sys.argv[1])); q = {r["id"]: r for r in json.load(open("queue.json")) + json.load(open("queue-final.json"))}
def trim(im):
    """Cut away a light painted frame, if the image came with one, keeping it square."""
    from PIL import ImageOps
    g = ImageOps.grayscale(im); w, h = im.size; px = g.load(); t = 0
    while t < w // 6 and sum(px[t, y] for y in range(0, h, 8)) / len(range(0, h, 8)) > 170: t += 1
    if t == 0: return im
    t += 6
    return im.crop((t, t, w - t, h - t)).resize((w, h), Image.LANCZOS)
mode = sys.argv[2] if len(sys.argv) > 2 else "sheet"
os.makedirs("raw", exist_ok=True)
if mode == "sheet":
    ims = []
    for it in b['items']:
        f = f"raw/{it['id']}.png"
        if not os.path.exists(f): subprocess.run(["curl", "-sSf", "-o", f, it['url']], check=True)
        ims.append(Image.open(f).convert("RGB").resize((320, 320)))
    m = Image.new("RGB", (1280, 320 * ((len(ims) + 3) // 4)))
    for i, im in enumerate(ims): m.paste(im, ((i % 4) * 320, (i // 4) * 320))
    m.save(f"sheet-{b['batch']}.jpg", quality=85); print("sheet", [it['id'] for it in b['items']])
else:
    used = {}
    if os.path.exists(f"reqs/{b['batch']}.json"):
        r = json.load(open(f"reqs/{b['batch']}.json")); used = {i: x['params']['prompt'] for i, x in zip(r['ids'], r['requests'])}
    mf = f"{APP}/public/people/manifest.json"; man = json.load(open(mf)); skipped = json.load(open("skipped.json"))
    for it in b['items']:
        if not it.get('keep', True): skipped.append(it['id']); continue
        im = trim(Image.open(f"raw/{it['id']}.png").convert("RGB"))
        for s in (256, 128, 64): im.resize((s, s), Image.LANCZOS).save(f"{APP}/public/people/{it['id']}-{s}.webp", quality=82, method=6)
        r = q[it['id']]
        man['people'][it['id']] = {"name": r['name'], "job": it['job'], "batch": b['batch'], "notes": r['tribe'], "nation": r['n'], "prompt": used.get(it['id']) or prompt.prompt(r)}
    json.dump(man, open(mf, "w"), indent=2); json.dump(skipped, open("skipped.json", "w"))
    ids = sorted(man['people'])
    open(f"{APP}/src/ui/portraits.ts", "w").write("/** People with an approved portrait, keyed by person id (see docs/AVATARS.md and public/people/manifest.json). */\nexport const PORTRAITS: ReadonlySet<string> = new Set([\n" + "".join(f'  "{i}",\n' for i in ids) + "]);\n")
    print("in app:", len(ids))
