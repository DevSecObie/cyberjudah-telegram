#!/bin/sh
# Stage the Mini App build for Workers Static Assets.
#
# The production build is rooted at /app/ (CYBERJUDAH_APP_BASE=/app/), so its
# index.html references /app/assets/.... But Workers Static Assets serves the
# assets directory at the request path, so /app/assets/x.js only resolves when
# the file exists at app/assets/x.js inside that directory. Copying the build
# output to both the directory root and an app/ subfolder makes the app load
# at / (workers.dev) and at /app (cyberjudah.io/app). Run after `npm run build`.
set -eu
cd "$(dirname "$0")/../.."
rm -rf .deploy
mkdir -p .deploy/app
cp -r app/dist/. .deploy/
cp -r app/dist/. .deploy/app/
echo "staged $(find .deploy -type f | wc -l) asset files in .deploy/"
