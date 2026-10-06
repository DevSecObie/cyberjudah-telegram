import { AudioIntent, audioRate } from "./audio-intent.mjs";
import { ambient } from "./ambient";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useNarrators, narrationSource, type Narrator } from "./recordings";

import { app } from "@/tg/sdk";

/**
 * The reading voices from Workers AI (Deepgram Aura), served a verse at a time by the Worker
 * and kept in R2, so a chapter is generated once. Chosen as "ai:<voice>" beside the device's
 * own voices; played through an <audio> element with the listener's rate, the next verse
 * fetched while this one plays.
 */
export type AiVoice = { id: string; name: string; note: string };
export const isAiVoice = (name: string | null) => !!name && name.startsWith("ai:");
const authed = (path: string) => fetch(path, { headers: { Authorization: `tma ${app?.initData ?? ""}` } });
async function verseAudio(slug: string, ch: number, verse: number, voice: string): Promise<string> {
  const res = await authed(`/api/tts/${encodeURIComponent(slug)}/${ch}/${verse}?voice=${encodeURIComponent(voice)}`);
  if (!res.ok) throw new Error(`tts ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
export function useAiVoices() {
  return useQuery({ queryKey: ["voices"], queryFn: () => authed("/api/voices").then((r) => r.json() as Promise<{ voices: AiVoice[] }>).then((r) => r.voices), staleTime: Infinity, retry: 1 });
}

/** Device / AI verse playback and one seekable human recording per chapter. */
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
const saved = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
export function useSpeech(verses: { verse: number; text: string }[], intro: string, where?: { slug: string; chapter: number }) {
  const [playing, setPlaying] = useState(false), [paused, setPaused] = useState(false);
  const [audible, setAudible] = useState(false), [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<number | null>(null), [completed, setCompleted] = useState(false);
  const [rate, setRate] = useState(() => audioRate(saved("ttsRate"))), [pitch, setPitch] = useState(() => audioRate(saved("ttsPitch")));
  const [voiceName, setVoiceName] = useState<string | null>(() => saved("ttsVoice"));
  const [fallback, setFallback] = useState(() => saved("ttsAiVoice") ?? "ai:asteria");
  const [available, setAvailable] = useState<SpeechSynthesisVoice[]>([]);
  const [notice, setNotice] = useState("");
  const narrators = useNarrators(where);
  const human = voiceName?.startsWith("narrator:") ?? false;
  const intent = useRef(new AudioIntent()), audio = useRef<HTMLAudioElement | null>(null);
  const mediaAttempt = useRef<{ audio: HTMLAudioElement; generation: number } | null>(null);
  const recording = useRef<Narrator | null>(null), release = useRef<() => void>(() => undefined);
  const activeVoice = useRef<string | null>(null), utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingNext = useRef<(() => void) | null>(null);
  const ahead = useRef<{ verse: number; voice: string; promise: Promise<string | null> } | null>(null);
  const discardAhead = () => { const pending = ahead.current; ahead.current = null; if (pending) void pending.promise.then((url) => { if (url) URL.revokeObjectURL(url); }); };
  const options = useRef({ rate, pitch }); options.current = { rate, pitch };
  const currentRef = useRef(current); currentRef.current = current;
  const restartOnResume = useRef(false);
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setAvailable(speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load(); speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  const clearAudio = () => {
    discardAhead();
    if (audio.current) { audio.current.onended = null; audio.current.ontimeupdate = null; audio.current.onerror = null; audio.current.onplaying = null; audio.current.onpause = null; audio.current.onwaiting = null; audio.current.pause(); audio.current.removeAttribute("src"); }
    audio.current = null; recording.current = null; release.current(); release.current = () => undefined;
  };
  const stop = (betweenChapters = false) => {
    mediaAttempt.current = null;
    if (!betweenChapters) ambient.stop();
    setAudible(false); setLoading(false);
    discardAhead();
    intent.current.stop(); if (ttsSupported) speechSynthesis.cancel(); utterance.current = null;
    pendingNext.current = null; restartOnResume.current = false;
    if (audio.current) audio.current.pause();
    setPlaying(false); setPaused(false); setCurrent(null); setCompleted(false);
  };
  const finish = (generation: number) => {
    if (!intent.current.canPlay(generation)) return;
    intent.current.stop(); setAudible(false); setLoading(false);
    ambient.stop(); setPlaying(false); setPaused(false); setCurrent(null); setCompleted(true);
  };
  const fail = (generation: number, message: string) => {
    if (generation !== intent.current.generation) return;
    stop(); setNotice(message);
  };
  const playMedia = (a: HTMLAudioElement, generation: number) => {
    const attempt = { audio: a, generation };
    mediaAttempt.current = attempt;
    const owns = () => intent.current.owns(generation) && audio.current === a && mediaAttempt.current === attempt;
    a.onplaying = () => {
      if (!owns()) return;
      if (intent.current.paused) { a.pause(); return; }
      setAudible(true); setLoading(false);
    };
    a.onwaiting = () => { if (owns()) { setAudible(false); setLoading(true); } };
    a.onpause = () => {
      if (!owns() || a.ended || a.paused === false) return;
      intent.current.paused = true; setPaused(true); setAudible(false); setLoading(false); ambient.stop();
    };
    setLoading(true);
    void a.play().then(() => {
      if (!owns()) { if (mediaAttempt.current?.audio !== a || mediaAttempt.current === attempt) a.pause(); return; }
      if (intent.current.paused || a.paused === true) { intent.current.paused = true; setPaused(true); a.pause(); setAudible(false); setLoading(false); ambient.stop(); return; }
      setAudible(true); setLoading(false);
    }).catch(() => { if (owns()) fail(generation, "Tap Play to resume audio."); });
  };
  const readVerses = (from: number, generation: number, voice: string | null) => {
    clearAudio(); activeVoice.current = voice;
    const ai = isAiVoice(voice) && !!where;
    const queue = [...(from === 1 && !ai ? [{ verse: 0, text: intro }] : []), ...verses.filter((v) => v.verse >= from)];
    const next = () => {
      if (generation !== intent.current.generation) return;
      if (intent.current.paused) { pendingNext.current = next; return; }
      pendingNext.current = null;
      const item = queue.shift(); if (!item) { finish(generation); return; }
      if (ai && where) {
        const prefetched = ahead.current?.verse === item.verse && ahead.current.voice === voice ? ahead.current.promise : null;
        if (prefetched) ahead.current = null;
        void (prefetched ?? Promise.resolve(null)).then((url) => generation === intent.current.generation ? url ?? verseAudio(where.slug, where.chapter, item.verse, voice!.slice(3)) : null).then((url) => {
          if (!url) return;
          if (generation !== intent.current.generation) { URL.revokeObjectURL(url); return; }
          release.current(); release.current = () => URL.revokeObjectURL(url);
          const a = new Audio(url); audio.current = a; a.playbackRate = options.current.rate;
          a.onended = () => { if (intent.current.owns(generation)) { setAudible(false); setLoading(true); next(); } }; a.onerror = () => fail(generation, "Reading voice is unavailable. Please try again.");
          setCurrent(item.verse); if (!intent.current.paused) playMedia(a, generation);
          const following = queue[0];
          if (following) ahead.current = { verse: following.verse, voice: voice!, promise: verseAudio(where.slug, where.chapter, following.verse, voice!.slice(3)).then((url) => {
            if (generation !== intent.current.generation) { URL.revokeObjectURL(url); return null; } return url;
          }).catch(() => null) };
        }).catch(() => fail(generation, "Reading voice is unavailable. Please try again."));
        return;
      }
      if (!ttsSupported) { fail(generation, "Choose a reading voice to listen."); return; }
      const u = new SpeechSynthesisUtterance(item.text); utterance.current = u;
      const vs = speechSynthesis.getVoices();
      const selected = vs.find((v) => v.name === voice) ?? vs.find((v) => /^en/i.test(v.lang) && /natural|premium|enhanced|neural|siri/i.test(v.name)) ?? vs.find((v) => /^en/i.test(v.lang));
      if (selected) u.voice = selected;
      u.lang = selected?.lang ?? "en-GB"; u.rate = options.current.rate; u.pitch = options.current.pitch;
      u.onstart = () => { if (intent.current.canPlay(generation)) { setCurrent(item.verse || null); setAudible(true); setLoading(false); } else if (intent.current.owns(generation)) speechSynthesis.pause(); };
      u.onpause = () => { if (intent.current.owns(generation)) { setAudible(false); setPaused(true); intent.current.paused = true; ambient.stop(); } };
      u.onresume = () => { if (intent.current.canPlay(generation)) { setAudible(true); setLoading(false); } };
      u.onend = next; u.onerror = () => fail(generation, "Device voice is unavailable.");
      speechSynthesis.speak(u);
    };
    if (!ai && ttsSupported && !speechSynthesis.getVoices().length) {
      // Voice discovery is asynchronous on iOS; Stop must cancel this deferred start.
      const ready = () => { clearTimeout(timer); speechSynthesis.removeEventListener("voiceschanged", ready); next(); };
      const timer = setTimeout(ready, 1500);
      speechSynthesis.addEventListener("voiceschanged", ready, { once: true });
    } else next();
  };
  const play = (from = 1, requestedVoice = voiceName, fromGesture = true) => {
    mediaAttempt.current = null;
    discardAhead();
    pendingNext.current = null;
    ambient.begin(fromGesture);
    setAudible(false); setLoading(true);
    const generation = intent.current.start();
    restartOnResume.current = false;
    if (audio.current) audio.current.pause();
    setNotice(""); setCompleted(false); setPlaying(true); setPaused(false); intent.current.paused = false;
    if (ttsSupported) { speechSynthesis.cancel(); speechSynthesis.resume(); }
    const start = async () => {
      const requestedHuman = requestedVoice?.startsWith("narrator:");
      let narrator = narrators.data?.narrators.find((n) => `narrator:${n.id}` === requestedVoice);
      if (requestedHuman && !narrators.data && !narrators.isError) {
        const result = await narrators.refetch(); narrator = result.data?.narrators.find((n) => `narrator:${n.id}` === requestedVoice);
      }
      if (generation !== intent.current.generation) return;
      if (!narrator) {
        if (requestedHuman) setNotice("No recording for this chapter. Using your chosen AI reading voice.");
        readVerses(from, generation, requestedHuman ? fallback : requestedVoice); return;
      }
      const verse = narrator.verses.find((v) => v[0] === from);
      if (!verse) { fail(generation, "This verse has no verified recording timing."); return; }
      if (recording.current?.audio !== narrator.audio || !audio.current) {
        clearAudio();
        const source = await narrationSource(narrator.audio);
        if (generation !== intent.current.generation) { source.release(); return; }
        release.current = source.release; audio.current = new Audio(source.url); recording.current = narrator;
      }
      const a = audio.current!; activeVoice.current = `narrator:${narrator.id}`;
      a.playbackRate = options.current.rate; a.currentTime = verse[1]; setCurrent(from);
      a.ontimeupdate = () => {
        if (generation !== intent.current.generation) return;
        const match = narrator!.verses.find((v) => a.currentTime >= v[1] && a.currentTime < v[2]);
        setCurrent(match?.[0] ?? currentRef.current);
      };
      a.onended = () => finish(generation);
      a.onerror = () => {
        if (generation !== intent.current.generation) return;
        setNotice("Recording unavailable. Using your chosen AI reading voice.");
        readVerses(currentRef.current ?? from, generation, fallback);
      };
      if (intent.current.canPlay(generation)) playMedia(a, generation);
    };
    void start().catch(() => fail(generation, "Recording unavailable. Please try again."));
  };
  const setVoice = (name: string | null) => {
    const resume = playing && !intent.current.paused, preservePause = playing && intent.current.paused, from = currentRef.current ?? 1;
    stop(); clearAudio(); setVoiceName(name);
    try { if (name) localStorage.setItem("ttsVoice", name); else localStorage.removeItem("ttsVoice"); } catch { /* private mode */ }
    if (isAiVoice(name)) { setFallback(name!); try { localStorage.setItem("ttsAiVoice", name!); } catch { /* private mode */ } }
    if (resume) play(from, name);
    else if (preservePause) { setPlaying(true); setPaused(true); intent.current.paused = true; setCurrent(from); restartOnResume.current = true; }
  };
  const toggle = () => {
    if (!playing) { play(current ?? 1); return; }
    const next = !intent.current.paused;
    if (!next && restartOnResume.current) { play(currentRef.current ?? 1); return; }
    intent.current.paused = next; setPaused(next);
    if (next) { ambient.stop(); setAudible(false); setLoading(false); } else ambient.begin();
    if (!next && pendingNext.current) { pendingNext.current(); return; }
    const generation = intent.current.generation;
    if (audio.current) { if (next) audio.current.pause(); else playMedia(audio.current, generation); }
    else if (ttsSupported) { if (next) speechSynthesis.pause(); else speechSynthesis.resume(); }
  };
  useEffect(() => {
    try { localStorage.setItem("ttsRate", String(rate)); localStorage.setItem("ttsPitch", String(pitch)); } catch { /* private mode */ }
    if (audio.current) audio.current.playbackRate = rate;
    else if (playing && ttsSupported) {
      if (intent.current.paused) restartOnResume.current = true;
      else play(currentRef.current ?? 1, voiceName, false);
    }
  }, [rate, pitch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ambient.voice(playing && !paused && current !== null); }, [playing, paused, current]);
  useEffect(() => () => { ambient.stop(); intent.current.stop(); if (ttsSupported) speechSynthesis.cancel(); clearAudio(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: verses.length > 0 && (ttsSupported || !!where), playing, paused, audible, loading, current, rate, setRate, pitch, setPitch,
    pitchSupported: ttsSupported && !human && !isAiVoice(voiceName), completed, play, stop, toggle,
    voices: available, voice: voiceName, setVoice, currentVoice: activeVoice.current,
    narrators: narrators.data?.narrators ?? [], narratorsLoading: narrators.isPending && !!where,
    narratorsError: narrators.isError, notice };
}
