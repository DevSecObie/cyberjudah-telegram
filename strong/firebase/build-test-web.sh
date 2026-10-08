#!/bin/sh
# Local emulator build only. Real project IDs are rejected by the app's emulator guard.
set -eu
cd "$(dirname "$0")/../apps/expo"
export CI=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 NODE_ENV=production
export EXPO_BASE_URL=/app/strong EXPO_PUBLIC_RESOURCE_API_URL=/bs
export EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1
export EXPO_PUBLIC_FIREBASE_PROJECT_ID=demo-cyberjudah
export EXPO_PUBLIC_FIREBASE_API_KEY=local-emulator-only
export EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=localhost
export EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=demo-cyberjudah.invalid
export EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=0
export EXPO_PUBLIC_FIREBASE_APP_ID=local-emulator-only
export EXPO_PUBLIC_FIREBASE_APP_CHECK_SITE_KEY=''
export EXPO_PUBLIC_ANALYTICS_ENABLED=false EXPO_PUBLIC_SENTRY_DSN=''
export EXPO_PUBLIC_AI_API_URL='' EXPO_PUBLIC_AUTOMATIC_UPDATES=''
corepack yarn expo export --clear --platform web --output-dir ../../dist-auth
node ../../scripts/check-web-config.mjs ../../dist-auth demo-cyberjudah
