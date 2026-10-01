#!/bin/sh
# Build the Bible Strong fork for the web, rooted at /app/strong, into strong/dist.
# bot/scripts/prepare-assets.sh copies strong/dist to .deploy/app/strong when it exists.
set -eu
cd "$(dirname "$0")"
# Yarn comes through the npm registry (some networks block the Yarn host).
export COREPACK_NPM_REGISTRY="${COREPACK_NPM_REGISTRY:-https://registry.npmjs.org}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
yarn install --immutable --mode=skip-build
rm -rf dist
(cd apps/expo && EXPO_BASE_URL=/app/strong NODE_ENV=production yarn expo export --platform web --output-dir ../../dist)
# Cloudflare serves no asset over 25 MiB; say so here rather than inside the deploy.
big=$(find dist -type f -size +25M)
if [ -n "$big" ]; then echo "::error::Files over 25 MiB: $big"; exit 1; fi
echo "built $(find dist -type f | wc -l) files, $(du -sh dist | cut -f1)"
