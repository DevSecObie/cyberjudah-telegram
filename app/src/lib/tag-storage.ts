import { allAnnotations } from "@/studies/storage";
import { removeTagFromMarks } from "@/bible/annotation/marks";
import type { Tag } from "@/bible/store";
import { json, personalStore, store } from "@/tg/store";
import { app, features } from "@/tg/sdk";
import { buildTagInventory, type TagChapter } from "./tag-list";

type Tags = Record<string, Tag>;
let tagWrite: Promise<void> = Promise.resolve();
/** Wait for cloud hydration, then apply one edit to the current definitions, never a UI snapshot. */
export function updateTagDefinitions(update: (tags: Tags) => Tags): Promise<void> {
  const run = tagWrite.catch(() => undefined).then(async () => {
    const synced = await personalStore();
    if (synced) {
      const raw = synced.get("bs_tags"), previous: Tags = raw ? JSON.parse(raw) : {};
      await synced.set("bs_tags", JSON.stringify(update(previous)), raw || null);
      return;
    }
    const before = await json.get<Tags>("bs_tags", {});
    let hydrated = before;
    if (features.cloud) {
      const raw = await new Promise<string | null>((resolve, reject) => app!.CloudStorage.getItem("bs_tags", (error, value) => error ? reject(new Error(error)) : resolve(value || null)));
      if (raw) hydrated = JSON.parse(raw) as Tags;
      const current = await json.get<Tags>("bs_tags", {});
      hydrated = { ...hydrated };
      // Preserve edits that landed while this read was pending, including removals.
      for (const id of new Set([...Object.keys(before), ...Object.keys(current)])) {
        if (JSON.stringify(before[id]) === JSON.stringify(current[id])) continue;
        if (current[id]) hydrated[id] = current[id]; else delete hydrated[id];
      }
    }
    await json.set("bs_tags", update(hydrated));
  });
  tagWrite = run;
  return run;
}

export const saveTagDefinition = (id: string, name: string, create: boolean) => updateTagDefinitions(tags => {
  if (!create && !tags[id]) throw new Error("This tag no longer exists.");
  return { ...tags, [id]: { ...tags[id], id, name, date: tags[id]?.date ?? Date.now() } };
});

export async function readTagInventory() {
  const keys = await store.keys();
  const chapters: TagChapter[] = [];
  for (const key of keys) {
    const match = /^bs_([hnl])_(.+)_(\d+)$/.exec(key);
    if (match) chapters.push({ kind: match[1] as TagChapter["kind"], slug: match[2], chapter: Number(match[3]), records: await json.get(key, {}) });
  }
  return buildTagInventory(chapters, await allAnnotations());
}

/** Keep the tag available for retry if removing any attachment fails. */
export async function deleteTagEverywhere(id: string) {
  const synced = await personalStore();
  const write = async (key: string, next: unknown, previous: unknown) => {
    if (synced) await synced.set(key, JSON.stringify(next), JSON.stringify(previous));
    else await json.set(key, next);
  };
  const keys = await store.keys();
  for (const key of keys.filter(key => /^bs_[hnl]_.+_\d+$/.test(key))) {
    const records = await json.get<Record<string, { tags?: Record<string, true> }>>(key, {});
    let changed = false;
    const next = Object.fromEntries(Object.entries(records).map(([key, record]) => {
      if (!record.tags?.[id]) return [key, record];
      const tags = { ...record.tags }; delete tags[id]; changed = true;
      return [key, { ...record, tags }];
    }));
    if (changed) await write(key, next, records);
  }
  await removeTagFromMarks(id);
  await updateTagDefinitions(tags => { const next = { ...tags }; delete next[id]; return next; });
}
