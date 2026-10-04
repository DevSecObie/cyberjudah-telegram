# Recent classes during YouTube outages

`GET /api/recent` keeps uploads without notes in Home and Classes as **Notes coming soon**. The display was still present; the old Worker cached an empty list for ten minutes whenever YouTube's RSS feed failed.

The Worker now tries RSS first, then the channel's public Videos and Live tabs together. Only completed recordings from the selected tab are included. Scheduled/live streams and Shorts are excluded. Channel-card dates are estimates from YouTube's English relative dates; RSS retains its precise publication dates.

Successful results are cached at the edge for ten minutes and saved in the existing `SUBS` KV binding under `recent:v2:<channel>` for seven days. If upstream sources fail, the last successful snapshot remains available and the edge retries after one minute. Failed refreshes do not extend the snapshot's expiration. A partial channel response is merged with the saved recordings, deduplicated and limited to fifteen. Each upstream request times out after five seconds. No new binding or secret is required. The versioned edge key bypasses empty entries made by the old Worker.

Run `node --test bot/tests/recent.test.mjs bot/tests/feed.test.mjs bot/tests/live.test.mjs` and `npm test --workspace bot`. Coverage includes RSS 404, network/timeout failures, malformed/empty feeds, both channel tabs, partial/total outages, shared snapshots, expiration and KV failures. The RSS 404 and total-outage regressions fail against the previous Worker.

The channel fixtures are reduced representative page structures, not a current live capture. The cloud environment cannot reach YouTube or `cyberjudah.io`; live confirmation remains necessary. After deployment, inspect `/api/recent` and confirm an uploaded class without notes appears on Home/Classes and opens its recording. If all upstream sources are unavailable before the first successful snapshot, there is no result to retain.
