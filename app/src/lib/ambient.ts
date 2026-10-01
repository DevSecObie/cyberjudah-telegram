import { useSyncExternalStore } from "react";
import { app } from "@/tg/sdk";

/** Licences apply to these recordings, not merely their compositions. All are CC0. */
export const AMBIENT_TRACKS = [
  { id: "quiet-piano", name: "Soft piano", category: "music", artist: "blankie.rest", original: "Sleepy Upright Piano Seamless Loop", source: "https://freesound.org/people/blankie.rest/sounds/859607/", download: "https://cdn.freesound.org/previews/859/859607_15820073-lq.mp3", duration: 227.502, sha256: "81c8dbdd82fcf01a3c80685a0c3159ef5639dcafc87853cbcc0e106dfde5b77b" },
  { id: "soft-keys", name: "Warm keys", category: "music", artist: "Boatlanman-", original: "Ambient piano loop", source: "https://freesound.org/people/Boatlanman-/sounds/788677/", download: "https://cdn.freesound.org/previews/788/788677_16161631-lq.mp3", duration: 182, sha256: "db6a8ce481340a0898c13ff6923a7bd59506977c34f9fcf4074caf8dcee1860e" },
  { id: "stillness", name: "Slow chords", category: "music", artist: "Erokia", original: "Synth Loop Ambiance (Unedited - 100 BPM)", source: "https://freesound.org/people/Erokia/sounds/524947/", download: "https://cdn.freesound.org/previews/524/524947_9497060-lq.mp3", duration: 240, sha256: "c8222f955844527c562f897684ebf6121df50b611fcbfb52ad4a1d73bd9978e5" },
  { id: "evening-pad", name: "Evening pad", category: "music", artist: "deadrobotmusic", original: "Blurred Piano Atmosphere [G Sharp Minor]", source: "https://freesound.org/people/deadrobotmusic/sounds/575035/", download: "https://cdn.freesound.org/previews/575/575035_11532701-lq.mp3", duration: 164.335, sha256: "6edcc0854746f47cd247fc3bd58a44559af6fe4311a3c9dcfae0262641ae2595" },
  {"id": "rain", "name": "Rain", "category": "nature", "artist": "barkenov", "original": "Soft rain.WAV", "source": "https://freesound.org/people/barkenov/sounds/640655/", "download": "https://cdn.freesound.org/previews/640/640655_2414299-lq.mp3", "duration": 177.29, "sha256": "c8bc4526e89f6ff77a2ff270141435ab1d5a990aa2ea59b6b519fdb23ba43d8f"},
  {"id": "wind", "name": "Wind", "category": "nature", "artist": "fthgurdy", "original": "Gentle wind", "source": "https://freesound.org/people/fthgurdy/sounds/528944/", "download": "https://cdn.freesound.org/previews/528/528944_3302313-lq.mp3", "duration": 150.639, "sha256": "0daff730c8c1c9986a67e4e7b20cf8b8915bc69752c07ea4c355a7d16e3672cc"},
  {"id": "ocean", "name": "Ocean waves", "category": "nature", "artist": "SamsterBirdies", "original": "Calm ocean waves", "source": "https://freesound.org/people/SamsterBirdies/sounds/578524/", "download": "https://cdn.freesound.org/previews/578/578524_5487341-lq.mp3", "duration": 240.0, "sha256": "e06cd01020cc9004df3271511e3f0cea63cde4f6e39dab34b01e9df7bdc95585"},
  {"id": "fire", "name": "Gentle fire", "category": "nature", "artist": "soundofsong", "original": "fire crackling loop.wav", "source": "https://freesound.org/people/soundofsong/sounds/650574/", "download": "https://cdn.freesound.org/previews/650/650574_9782868-lq.mp3", "duration": 151.5, "sha256": "6eeec23eac3f8b6535f9617227042c3a75ef03d162a0b9d792a91f6379c73e4e"},
].map((t) => ({ ...t, license: "CC0 1.0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", changes: "Repeated with crossfades, level adjusted and encoded to AAC at 96 kbps", audio: `/api/audio/ambient/${t.id}.m4a?v=${t.sha256}` }));
type State = { choice: string; volume: number; error: boolean; preview: string | null };
const get = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const put = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const storedChoice = get("ambientTrack"), storedVolume = get("ambientVolume");
const volume = storedVolume !== null && Number.isFinite(+storedVolume) ? Math.max(0, Math.min(1, +storedVolume)) : .25;

/** One decoded buffer loops gaplessly. GainNodes handle volume on iOS (media.volume does not). */
class AmbientAudio {
  state: State = { choice: AMBIENT_TRACKS.some((t) => t.id === storedChoice) ? storedChoice! : "off", volume, error: false, preview: null };
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private loaded: { id: string; buffer: AudioBuffer } | null = null;
  private generation = 0;
  private reading = false;
  private speaking = false;
  private unlocked = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fadeUntil = 0;
  private currentTrack: string | null = null;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.state;
  private update(value: Partial<State>) { this.state = { ...this.state, ...value }; this.listeners.forEach((fn) => fn()); }
  private cancelTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private ensureGesture() {
    // Invoked synchronously by a Play, choice or preview tap, never by a mount effect.
    try {
      if (!this.context) {
        const Audio = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.context = new Audio(); this.gain = this.context.createGain(); this.gain.gain.value = 0; this.gain.connect(this.context.destination);
      }
      this.unlocked = true;
      void this.context.resume().catch(() => this.failed());
    } catch { this.failed(); }
  }
  private ramp(value: number, seconds: number) {
    if (!this.gain || !this.context) return;
    const gain = this.gain.gain, now = this.context.currentTime;
    if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
    else { gain.cancelScheduledValues(now); gain.setValueAtTime(gain.value, now); }
    gain.linearRampToValueAtTime(value, now + seconds);
  }
  private target() { return this.state.volume * (this.speaking && !this.state.preview ? .72 : 1); }
  private clearSource() { try { this.source?.stop(); } catch { /* already stopped */ } this.source?.disconnect(); this.source = null; this.currentTrack = null; }
  private failed() { this.generation++; this.clearSource(); this.update({ error: true, preview: null }); }
  private async start(id: string, fade = 1.5) {
    if (!this.unlocked || !this.context || !this.gain || document.hidden) return;
    if (this.source && this.currentTrack === id) { this.ramp(this.target(), fade); return; }
    const track = AMBIENT_TRACKS.find((t) => t.id === id); if (!track) return;
    const generation = ++this.generation;
    this.cancelTimer(); this.clearSource(); this.update({ error: false });
    try {
      let buffer = this.loaded?.id === id ? this.loaded.buffer : undefined;
      if (!buffer) {
        const response = await fetch(track.audio); if (!response.ok) throw new Error("Track unavailable");
        buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      }
      if (generation !== this.generation || !this.unlocked || document.hidden) return;
      this.loaded = { id, buffer };
      const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true;
      source.connect(this.gain); this.source = source; this.currentTrack = id;
      this.gain.gain.setValueAtTime(0, this.context.currentTime); source.start(); this.fadeUntil = this.context.currentTime + fade; this.ramp(this.target(), fade);
    } catch { if (generation === this.generation) this.failed(); }
  }
  choose(id: string) {
    if (id !== "off" && !AMBIENT_TRACKS.some((t) => t.id === id)) return;
    this.ensureGesture(); this.cancelTimer(); this.update({ choice: id, preview: null, error: false }); put("ambientTrack", id);
    if (id === "off") this.fadeOut(); else if (this.reading) void this.start(id);
  }
  setVolume(value: number) {
    if (!Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value)); this.update({ volume }); put("ambientVolume", String(volume));
    if (this.source) this.ramp(this.target(), .15);
  }
  preview(id: string) {
    this.ensureGesture(); this.cancelTimer();
    if (this.state.preview === id) { this.endPreview(); return; }
    this.update({ preview: id });
    void this.start(id, .3).then(() => {
      if (this.state.preview === id) this.timer = setTimeout(() => this.endPreview(), 8000);
    });
  }
  endPreview() {
    if (!this.state.preview) return;
    this.cancelTimer(); this.update({ preview: null });
    if (this.reading && this.state.choice !== "off") void this.start(this.state.choice);
    else this.fadeOut();
  }
  begin() {
    this.ensureGesture(); this.cancelTimer(); this.reading = true; this.update({ preview: null, error: false });
    if (this.state.choice !== "off") void this.start(this.state.choice);
  }
  voice(active: boolean) { this.speaking = active; if (this.source && this.reading) this.ramp(this.target(), Math.max(.25, this.fadeUntil - (this.context?.currentTime ?? 0))); }
  stop() { this.reading = false; this.speaking = false; this.update({ preview: null }); this.fadeOut(); }
  private fadeOut() {
    const generation = ++this.generation; this.cancelTimer(); this.ramp(0, 1);
    this.timer = setTimeout(() => { if (generation === this.generation) this.clearSource(); }, 1000);
  }
  background = () => {
    this.generation++; this.unlocked = false; this.reading = false; this.cancelTimer(); this.clearSource(); this.update({ preview: null });
    if (this.context) void this.context.suspend().catch(() => undefined);
  };
}
export const ambient = new AmbientAudio();
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) ambient.background(); });
  app?.onEvent("deactivated", ambient.background);
}
export const useAmbient = () => useSyncExternalStore(ambient.subscribe, ambient.snapshot);
