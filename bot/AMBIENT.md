# Ambient reading audio

## Dwell research (1 October 2026)

Dwell's [help page on background music](https://help.dwellbible.com/en/articles/15193090-how-many-options-are-there-for-background-music)
lists musical categories (ambient, hymns, piano, guitar), immersive environments and
nature/noise sounds. It describes previews, downloads and a music control on the
player, plus Settings → App Personalization → Background Music.
Its [volume help](https://help.dwellbible.com/en/articles/15196744-how-do-i-adjust-the-volume)
describes independent voice, music and master volume. The [player announcement](https://dwellapp.io/articles/1Z9y48yVLHahIxYQo65piU)
explains the music pill. [February 2025 release notes](https://dwellapp.io/articles/4q38SxF5QB8T3lyAfpfoi0)
confirm fades between Bible and devotional listening. The [App Store listing](https://apps.apple.com/us/app/dwell-audio-bible/id1343917374)
describes Selah (music continues when narration pauses) and background albums,
immersive soundscapes and nature sounds. These sources do **not** establish exact
fade durations or guarantee gapless chapter transitions. Our 1.5-second start,
1-second stop and continuity across chapter navigation implement the requested
behavior, rather than an unverified claim about Dwell's internals.

No Dwell music, track names, artwork or recordings are included.

## Our loops

All eight recordings have CC0 statements on their individual source pages. Names,
creators, original titles, source links, license links, changes, durations and
encoded checksums live in `app/src/lib/ambient.ts` and are shown in Credits.
We use each source's public MP3 preview, crossfade repetitions and the wrap point,
level-adjust and encode AAC at 96 kbps. Prepared lengths are 150–240 seconds and
sizes are 1.8–3.0 MB. The Music tab offers Soft piano, Warm keys, Slow chords and
Evening pad. The Nature tab adds the requested Rain, Wind, Ocean waves and Gentle
fire. These are field recordings, alongside four instrumental piano/synth loops.

| Choice | Creator and confirmed CC0 source |
| --- | --- |
| Soft piano | [blankie.rest](https://freesound.org/people/blankie.rest/sounds/859607/) |
| Warm keys | [Boatlanman-](https://freesound.org/people/Boatlanman-/sounds/788677/) |
| Slow chords | [Erokia](https://freesound.org/people/Erokia/sounds/524947/) |
| Evening pad | [deadrobotmusic](https://freesound.org/people/deadrobotmusic/sounds/575035/) |
| Rain | [barkenov](https://freesound.org/people/barkenov/sounds/640655/) |
| Wind | [fthgurdy](https://freesound.org/people/fthgurdy/sounds/528944/) |
| Ocean waves | [SamsterBirdies](https://freesound.org/people/SamsterBirdies/sounds/578524/) |
| Gentle fire | [soundofsong](https://freesound.org/people/soundofsong/sounds/650574/) |

Prepare with Python + NumPy and FFmpeg (reference encoding: the task's installed
FFmpeg; encoders can differ, so a checksum mismatch requires reviewing the result
and updating the catalog, never silently accepting a different asset):

```sh
python3 scripts/audio/prepare-ambient.py --cache .cache/ambient
AMBIENT_EXPORT_DIR=.cache/ambient/encoded node scripts/deploy-ambient.mjs --dry-run
```

On an authorized deployment, set `AMBIENT_EXPORT_DIR` and run the existing deploy
command. The uploader checks size and SHA-256 before writing `ambient/<id>.m4a` to
the audio R2 bucket. It does not publish any track with a mismatched file. No upload
or deployment was performed during implementation.

The app decodes one complete track to an AudioBuffer, then loops one BufferSource;
there are no new media-element requests at a loop boundary. A GainNode handles
independent volume on iOS. The default volume is 25%, ducked to 72% of that while a
verse is active. Track and volume persist; Off is the initial selection. Preview
lasts up to eight seconds without changing the saved track. Backgrounding cancels
pending loads, stops the music and suspends the AudioContext. Returning alone does
not start audio; a tap resumes it. Track failures show on the chip and do not stop
narration. Physical iOS/Telegram playback remains a device-validation item.

## Notes

Source licenses and encoded properties were verified; the sounds still need a
listening pass on a physical phone to assess their balance and loop joins. The
public MP3 previews are the source masters used here, not the login-only WAV
downloads. Browser audio tests use stubs; they verify control and lifecycle
behavior, not audible quality. Selecting a track in an environment without its
R2 assets reports an unavailable sound while narration continues.
