import { collection, doc, onSnapshot, writeBatch, type Firestore } from "firebase/firestore";
import { migrationDocumentId } from "./migration";
import { readerCollection, readerEntries, readerValue, recordIdentity } from "./records";

/** Adapts Firestore snapshots to the existing reader store; the SDK owns its offline queue. */
export async function connectReader(db: Firestore, uid: string, changed: (key: string, value: string) => void, report: (message: string) => void) {
  type Row = { key: string; entry: string; value: unknown; revision: string; previous?: string };
  const rows = new Map<string, Row>(), own = new Map<string, string>(), stops: (() => void)[] = [];
  let closed = false;
  const entries = (key: string) => Object.fromEntries([...rows.values()].filter(r => r.key === key && r.value !== null).map(r => [r.entry, r.value]));
  try {
    await Promise.all(["highlights", "notes", "links", "bookmarks", "tags", "relations"].map(name => new Promise<void>((resolve, reject) => {
      stops.push(onSnapshot(collection(db, "users", uid, name), { includeMetadataChanges: true }, snapshot => {
        if (closed) return;
        const keys = new Set<string>();
        for (const change of snapshot.docChanges()) {
          const row = change.doc.data() as Row & { history?: boolean };
          if (row.history || typeof row.key !== "string" || typeof row.entry !== "string") continue;
          const identity = recordIdentity(row.key, row.entry), local = own.get(identity);
          if (!change.doc.metadata.hasPendingWrites && local && row.revision !== local && row.previous !== local) {
            report("This mark changed on another device. Both saved versions are preserved; review the latest value before editing again.");
            own.delete(identity);
          }
          keys.add(row.key);
          if (change.type === "removed") rows.delete(identity); else rows.set(identity, row);
        }
        keys.forEach(key => changed(key, readerValue(key, entries(key))));
        if (!snapshot.metadata.fromCache || !navigator.onLine) resolve();
      }, error => { report("Saved data could not sync. Your existing marks are unchanged."); reject(error); }));
    })));
  } catch (error) { stops.forEach(stop => stop()); throw error; }
  return {
    get: (key: string) => readerValue(key, entries(key)),
    keys: () => [...new Set([...rows.values()].map(row => row.key))],
    close() { closed = true; stops.forEach(stop => stop()); rows.clear(); own.clear(); },
    async set(key: string, raw: string | null, baseline: string | null) {
      if (closed) throw new Error("Account changed. Reopen the app before saving.");
      const name = readerCollection(key); if (!name) throw new Error("Unsupported reader key");
      // Diff the caller's copy, so another device's unrelated verse is never removed.
      const before = readerEntries(key, baseline), after = readerEntries(key, raw);
      const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(entry => JSON.stringify(before[entry]) !== JSON.stringify(after[entry]));
      if (!changes.length) return;
      const batch = writeBatch(db), staged: [string, Row][] = [];
      for (const entry of changes) {
        const identity = recordIdentity(key, entry), previous = rows.get(identity);
        const id = await migrationDocumentId(identity), revision = crypto.randomUUID();
        const next: Row = { key, entry, value: after[entry] ?? null, revision, previous: previous?.revision ?? "none" };
        const ref = doc(db, "users", uid, name, id);
        // Keep both versions, including simultaneous and offline edits. Deletions are tombstones,
        // so an older device import cannot bring a removed mark back.
        batch.set(ref, next, { merge: true });
        const history = name === "notes" ? doc(ref, "revisions", revision) : doc(db, "users", uid, name, `revision-${revision}`);
        batch.set(history, { history: true, snapshot: next, before: previous ?? null, user: { id: uid } });
        staged.push([identity, next]);
      }
      if (closed) throw new Error("Account changed. No changes were sent.");
      const pending = batch.commit(); // SDK applies locally now and persists pending writes offline.
      staged.forEach(([identity, row]) => { rows.set(identity, row); own.set(identity, row.revision); });
      changed(key, readerValue(key, entries(key)));
      await pending;
    },
  };
}
