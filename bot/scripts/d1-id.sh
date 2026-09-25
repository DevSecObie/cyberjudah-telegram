#!/bin/bash
# Prints the id of the D1 database named $1 (default cyberjudah-telegram), creating it if it
# does not exist yet. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
# The deploy workflow writes the id into wrangler.jsonc so nothing account-specific is committed.
set -euo pipefail
NAME="${1:-cyberjudah-telegram}"
list() { npx --yes wrangler@4 d1 list --json 2>/dev/null | jq -r --arg n "$NAME" '.[] | select(.name == $n) | .uuid'; }
ID=$(list || true)
if [ -z "$ID" ]; then
  npx --yes wrangler@4 d1 create "$NAME" >&2
  ID=$(list)
fi
[ -n "$ID" ] || { echo "no D1 database named $NAME" >&2; exit 1; }
echo "$ID"
