# Audio verification

The audio suites use a 390 × 780 browser viewport. Recording, generated-voice and
ambient media are controlled test doubles; they verify playback commands, seeking,
async ordering, selection, saved preferences and UI state. These are **emulated**
checks, not listening tests or certification of Telegram on iOS or Android.

Run `node --test app/tests/audio-intent.test.mjs` for playback intent and saved-value
validation. Run `npm run test:e2e --workspace app -- recordings.spec.ts ambient.spec.ts`
for Chromium, WebKit and Firefox. The normal configuration builds the app and starts
a local Worker. It does not deploy.

On the Paperclip Linux runner, source `/data/.cache/playwright-sysdeps/env.sh`
before running Playwright. The installed rootless fonts are under
`/data/.cache/playwright-sysdeps/prefix/usr/share/fonts`; set `FONTCONFIG_FILE` to a
run-local fontconfig file listing that directory if the default configuration
points at the absent `/usr/share/fonts`. Run the test command with
`taskset -c 0,1` on this runner to bound browser and Worker thread creation. Keep
other test/build processes stopped while running the browser suite. Do not change
the tests or disable tracing to hide a runtime failure.

Physical follow-up must cover both Telegram iOS and Android: start a licensed
recording, pause/resume, seek, change chapter and speed, switch apps, lock/unlock,
and use headset/system controls. Repeat with a device voice and a generated voice,
with and without ambient sound. Record OS/client versions and whether playback
stops, resumes, advances, or needs another tap. A simulated visibility event does
not establish this behavior. Device voices may need to restart the current verse
when their speed, pitch or voice is changed while paused; the change must never
start playback until Resume is pressed.
