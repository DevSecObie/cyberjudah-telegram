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
# The one exception is the video player page (embed/youtube.html, served on staging for the
# phone app, and /embed/youtube that it redirects to): the app's Bible reader shows it inside a
# frame from the app's own page, which no frame-ancestors list can name, so that page alone drops
# the frame rule (owner's call, 2026-10-30). It only plays a YouTube video by id.
# A script policy is reported only, not enforced, until reports show it fits normal use: scripts
# from this site, Telegram's Mini App SDK (telegram.org, in index.html), Google's API loader that
# Firebase Auth fetches on phones and Safari (apis.google.com), and the inline scripts the app
# carries (the theme set before the first paint), named by hash so a change to one is seen.
INLINE=$(node -e '
  const fs = require("fs"), { createHash } = require("crypto"), q = String.fromCharCode(39), out = new Set();
  for (const f of process.argv.slice(1)) {
    if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, "utf8").matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))
      if (m[1].trim()) out.add(q + "sha256-" + createHash("sha256").update(m[1]).digest("base64") + q);
  }
  process.stdout.write([...out].map((h) => " " + h).join(""));
' .deploy/index.html)
cat > .deploy/_headers <<HEADERS
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org https://*.telegram.org
  Content-Security-Policy-Report-Only: script-src 'self' https://telegram.org https://apis.google.com$INLINE; object-src 'none'; base-uri 'self'
/embed/youtube.html
  ! Content-Security-Policy
/embed/youtube
  ! Content-Security-Policy
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/app/assets/*
  Cache-Control: public, max-age=31536000, immutable
HEADERS
echo "staged $(find .deploy -type f | wc -l) asset files in .deploy/"
