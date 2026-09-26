#!/bin/bash
# Prints the id of the KV namespace titled $1 (default SUBS), creating it if it does not exist
# yet. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. The deploy workflow writes the id
# into wrangler.jsonc so nothing account-specific is committed.
set -euo pipefail
TITLE="${1:-SUBS}"
# wrangler prefixes the title with the worker name: "cyberjudah-telegram-SUBS".
list() { npx --yes wrangler@4 kv namespace list 2>/dev/null | jq -r --arg t "$TITLE" '.[] | select(.title == $t or (.title | endswith("-" + $t))) | .id' | head -1; }
ID=$(list || true)
if [ -z "$ID" ]; then
  npx --yes wrangler@4 kv namespace create "$TITLE" >&2
  ID=$(list)
fi
[ -n "$ID" ] || { echo "no KV namespace titled $TITLE" >&2; exit 1; }
echo "$ID"
