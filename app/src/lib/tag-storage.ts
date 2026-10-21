import { allAnnotations } from "@/studies/storage";
import { removeTagFromMarks } from "@/bible/annotation/marks";
import type { Tag } from "@/bible/store";
import { json, personalStore, store } from "@/tg/store";
import { buildTagInventory, type TagChapter } from "./tag-list";

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
  const tags = await json.get<Record<string, Tag>>("bs_tags", {});
  const next = { ...tags }; delete next[id];
  await write("bs_tags", next, tags);
}
