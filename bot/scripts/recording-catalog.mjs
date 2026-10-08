/** Keep previously published chapters when an upstream source is temporarily unavailable. */
export function mergeRecordingCatalog(previous, incoming) {
  const entries = new Map();
  for (const catalog of [previous, incoming]) {
    if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.chapters)) throw new Error("Invalid narration catalog; existing chapters must be preserved");
    for (const chapter of catalog.chapters) {
      if (!/^[a-z0-9-]+$/.test(chapter.readerId) || !/^[a-z0-9-]+$/.test(chapter.slug) || !Number.isInteger(chapter.chapter) || chapter.chapter < 1 || chapter.chapter > 999) throw new Error("Invalid narration chapter identity");
      const key = `${chapter.readerId}/${chapter.slug}/${chapter.chapter}`;
      if (chapter.audio !== `recordings/${key}.m4a` || chapter.index !== `${key}.json` || !/^[a-f0-9]{64}$/.test(chapter.sha256) || !Number.isSafeInteger(chapter.bytes) || chapter.bytes < 1) throw new Error("Invalid published narration chapter");
      entries.set(key, chapter);
    }
  }
  return { schemaVersion: 1, chapters: [...entries.values()], ...(incoming.partial ? { partial: true } : {}) };
}
