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
# Vite names every file under assets/ by its content hash, so a browser may keep one for a
# year without asking again; a new build references new names. index.html, sw.js and the
# public files keep their names across builds and keep the default caching.
# Every page and file: no MIME sniffing, no full URL sent to other sites, and only this site and
# Telegram's web clients (web.telegram.org frames the Mini App) may show it inside a frame.
# Telegram's phone and desktop apps open it in their own web view, which frame-ancestors does not touch.
cat > .deploy/_headers <<'HEADERS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://*.telegram.org
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/app/assets/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
# The Bible Strong fork (strong/, built by strong/build-web.sh) is staged beside the current
# app at /app/strong while it is built out; the current app at /app is unchanged.
if [ -d strong/dist ]; then
  mkdir -p .deploy/app/strong
  cp -r strong/dist/. .deploy/app/strong/
fi
echo "staged $(find .deploy -type f | wc -l) asset files in .deploy/"
