# Recently viewed producer contract

The history model follows Bible Strong **27.2.0**, commit `cda1eb4c96b32095129dee029cda704c621a13fa`, `features/history/historyModel.ts`. `app/src/lib/marks.ts` continues to export `useHistory`, `pushHistory` and `HistoryRow`; the pure model lives in `lib/history.ts`.

Existing Bible producers need no change:

```ts
setHistory(pushHistory(history, { slug, chapter, verse, name }));
```

Omitting `type` means `bible`. Bible `name` remains the existing chapter label (for example `John 3`); a verse greater than one is appended in the list. Opening it retains `/read/john/3?at=16`.

Other producers use these inputs (timestamps are assigned by `pushHistory`):

```ts
{ type: "strong", reference: "G3056", name: "logos", original: "λόγος" }
{ type: "dictionary", slug: "abraham", name: "Abraham", dictionaryTitle: "Easton's Bible Dictionary" }
{ type: "topic", slug: "faith", name: "Faith" }
```

Dictionary records may include `resourceId`, `language`, and `entryId` to distinguish datasets and entries. The existing dictionary route still uses `slug`. Topic identity uses its lowercase route slug. `WordStudy` records successful Strong's loads; dictionary/topic screen producers are intentionally left for their separate PRs.

`normalizeHistory` validates records, drops unknown fields, sorts newest first and deduplicates by `getHistoryItemKey`. The legacy array storage shape and `hist` key remain unchanged. Each write keeps at most 50 entries and at most **4096 UTF-8 bytes**, including JSON punctuation. Older entries are dropped as necessary; display strings are bounded to 160 Unicode code points. Route identifiers are validated rather than truncated. Thus long multilingual records can retain fewer than 50 entries. Existing data is normalized for display and migrated on the next history write.
