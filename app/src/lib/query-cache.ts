import { dehydrate, hydrate, type DehydratedState, type QueryClient } from "@tanstack/react-query";
import { openDB } from "idb";
import { merge, persistable, settle, trim } from "./query-persist.mjs";

const STORE = "state", KEY = "queries", VERSION = 1;
type Saved = { version: number; queries: DehydratedState["queries"] };
let db: ReturnType<typeof openDB> | undefined;
const database = () => db ??= openDB("cyberjudah-query-cache", 1, { upgrade(d) { d.createObjectStore(STORE); } });

/** Puts the saved public data back, marked stale so each screen still refreshes it in the background. */
export async function restoreQueries(client: QueryClient) {
  try {
    const saved = await (await database()).get(STORE, KEY) as Saved | undefined;
    if (saved?.version !== VERSION) return;
    hydrate(client, { queries: trim(saved.queries), mutations: [] });
    await client.invalidateQueries({ predicate: (q) => persistable(q.queryKey), refetchType: "none" });
  } catch { /* No IndexedDB (a private window): a cold start, as before. */ }
}

/** Saves the public queries a moment after they load, and when the app is put away. */
export function persistQueries(client: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer); timer = undefined;
    // Any query holding loaded data, including one whose last refresh failed.
    const fresh = dehydrate(client, { shouldDehydrateQuery: (q) => persistable(q.queryKey) && q.state.data !== undefined && q.state.dataUpdatedAt > 0 }).queries.map(settle);
    void (async () => {
      const d = await database();
      const stored = await d.get(STORE, KEY) as Saved | undefined;
      const saved: Saved = { version: VERSION, queries: trim(merge(stored?.version === VERSION ? stored.queries : [], fresh)) };
      await d.put(STORE, saved, KEY);
    })().catch(() => undefined);
  };
  client.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.action.type === "success" && persistable(e.query.queryKey)) timer ??= setTimeout(save, 2000);
  });
  addEventListener("pagehide", () => { if (timer) save(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && timer) save(); });
}
