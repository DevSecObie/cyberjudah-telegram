import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { signInitData } from "../src/initdata.mjs";

export async function verifyAssets({ url, token, minimumChapters = 1, fetcher = fetch, log = console.log }) {
  if (!url || !token) throw new Error("WORKER_URL and BOT_TOKEN are required");
  const origin = new URL(url).origin;
  const launch = await signInitData({ user: { id: 1, first_name: "Release check" }, auth_date: String(Math.floor(Date.now() / 1000)) }, token);
  const get = async (path, method = "GET") => {
    const response = await fetcher(`${origin}${path}`, { method, headers: { authorization: `tma ${launch}` }, redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Published asset unavailable: ${path} (HTTP ${response.status})`);
    return response;
  };
  const checked = async (path, sha256, size) => {
    const bytes = Buffer.from(await (await get(path)).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== sha256 || (size !== undefined && bytes.length !== size)) throw new Error(`Published asset checksum mismatch: ${path}`);
    return bytes.toString("utf8");
  };
  const catalog = await (await get("/api/resources/catalog")).json();
  for (const id of ["strongs", "josephus", "jewish-encyclopedia", "smiths-dictionary-of-the-bible"]) {
    const entry = catalog.resources?.find(r => r.id === id);
    if (!entry) throw new Error(`Missing published resource: ${id}`);
    const base = `/api/resources/${id}/${encodeURIComponent(entry.release)}/`;
    const manifest = JSON.parse(await checked(`${base}manifest.json`, entry.manifestSha256));
    const part = manifest.parts?.[0];
    if (!part) throw new Error(`Empty resource: ${id}`);
    const rows = await checked(base + encodeURIComponent(part.path), part.sha256, part.bytes);
    const record = JSON.parse(rows.split("\n")[0]);
    const resolved = await (await get(`${base}record?key=${encodeURIComponent(record.key)}`)).json();
    if (resolved.release !== entry.release || JSON.stringify(resolved.data) !== JSON.stringify(record.data)) throw new Error(`Resource lookup differs from its published shard: ${id}`);
    log(`${id}: manifest, sample shard and indexed lookup verified`);
  }
  const narration = await (await get("/api/recordings/catalog")).json();
  if (!Array.isArray(narration.chapters) || narration.chapters.length < minimumChapters) throw new Error(`Narration is incomplete: expected at least ${minimumChapters} published chapters`);
  for (const chapter of narration.chapters) {
    const response = await get(`/api/audio/${chapter.audio}`, "HEAD");
    if (Number(response.headers.get("content-length")) !== chapter.bytes) throw new Error(`Narration size mismatch: ${chapter.audio}`);
  }
  for (const chapter of new Map(narration.chapters.map(c => [c.readerId, c])).values()) {
    const index = await (await get(`/api/recordings/${chapter.slug}/${chapter.chapter}`)).json();
    if (!index.narrators?.some(n => n.id === chapter.readerId && n.verses?.length)) throw new Error(`Narration timing index missing: ${chapter.index}`);
  }
  log(`${narration.chapters.length} narration files verified; one timing index per narrator verified`);
  for (const id of ["quiet-piano", "soft-keys", "stillness", "evening-pad", "rain", "wind", "ocean", "fire"]) await get(`/api/audio/ambient/${id}.m4a`, "HEAD");
  log("8 ambient loops available");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const escape = message => String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  verifyAssets({ url: process.env.WORKER_URL, token: process.env.BOT_TOKEN, minimumChapters: Number(process.env.MINIMUM_NARRATION_CHAPTERS ?? 1), log: message => console.log(`::notice::${escape(message)}`) })
    .catch(error => { console.error(`::error::${escape(error.message)}`); process.exitCode = 1; });
}
