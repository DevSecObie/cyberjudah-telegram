# Audio verification

The audio suites use a 390 × 780 browser viewport. Recording, generated-voice and
ambient media are controlled test doubles; they verify playback commands, seeking,
async ordering, selection, saved preferences and UI state. These are **emulated**
checks, not listening tests or certification of Telegram on iOS or Android.

Run `node --test app/tests/audio-intent.test.mjs` for playback intent and saved-value
validation. Run `npm run test:e2e --workspace app -- recordings.spec.ts ambient.spec.ts`
for Chromium, WebKit and Firefox. The normal configuration builds the app and starts
a local Worker. It does not deploy.

On the Paperclip Linux runner, run through the shared capacity/port guard:

```sh
cd app
bash /data/.cache/playwright-sysdeps/run.sh npx playwright test recordings.spec.ts ambient.spec.ts --workers=1
```

The wrapper supplies libraries, fonts and the filtered GIO TLS module directory.
Retain its `GIO_MODULE_DIR`; unsetting it breaks WebKit HTTPS. It also pins the suite
to two CPUs. Exit 75 means temporary shared-host contention: retry after the other
suite finishes, without bypassing the guard, sandbox or TLS checks. Keep other
local test/build processes stopped during browser verification.

Physical follow-up must cover both Telegram iOS and Android: start a licensed
recording, pause/resume, seek, change chapter and speed, switch apps, lock/unlock,
and use headset/system controls. Repeat with a device voice and a generated voice,
with and without ambient sound. Record OS/client versions and whether playback
stops, resumes, advances, or needs another tap. A simulated visibility event does
not establish this behavior. Device voices may need to restart the current verse
when their speed, pitch or voice is changed while paused; the change must never
start playback until Resume is pressed.

## Shared playback

One app-level owner holds narration and the selected audio chapter. Navigating to
Settings, Search, another Bible chapter or any other screen does not restart it.
The reader's outside chapter arrows browse; the audio card's chapter controls and
system Next/Previous change the audio chapter without navigating. Return to current
passage opens the chapter being narrated. Verse following and manual-scroll release
still apply only when that chapter is visible.

Completion uses the repository catalog's order and `chapterIds`, including book
boundaries; the final chapter stops. Repeat belongs to the player, so collapsing
the panel or changing screens does not disable it. Stop invalidates pending chapter
loads and media starts. Pause during loading retains the request but requires Resume
before it starts. Reloading the app never restores playback automatically.

Media Session play, pause, stop, next and previous handlers are installed where
supported and cleared when the player unmounts. Playback state reports observed
media activity, not a pending request. A rejected media start shows a retry notice;
an external media pause offers Resume and does not restart on navigation.

Ambient sound suspends on document hiding or Telegram deactivation. On return it
attempts to restore the selected sound only if narration remains active and the
context was previously unlocked by a gesture. Paused/stopped narration and previews
never restart on return. A rejected context resume reports ambient unavailability
without interrupting narration. Narration is not deliberately stopped on hiding,
but operating systems and Telegram webviews can suspend it. These handlers do not
guarantee background or lock-screen playback; physical-client verification remains
separate from the emulated browser suite.

The audio suites cover route lifetime, canonical chapter/book completion,
end-of-catalog, collapsed repeat, rapid requests, Stop during chapter loading and
pending media play, Media Session actions, external pause and ambient return.
`app/tests/audio-continuity.test.mjs` covers catalog boundaries and handler disposal;
`audio-intent.test.mjs` covers async ownership and persisted rate validation.
