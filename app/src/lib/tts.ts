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
  const [current, setCurrent] = useState<number | null>(null), [completed, setCompleted] = useState(false);
  const [rate, setRate] = useState(1), [pitch, setPitch] = useState(1);
  const [voiceName, setVoiceName] = useState<string | null>(() => saved("ttsVoice"));
  const [fallback, setFallback] = useState(() => saved("ttsAiVoice") ?? "ai:asteria");
  const [available, setAvailable] = useState<SpeechSynthesisVoice[]>([]);
  const [notice, setNotice] = useState("");
  const narrators = useNarrators(where);
  const human = voiceName?.startsWith("narrator:") ?? false;
  const continuation = useRef(false), previousChapter = useRef("");
  const playingRef = useRef(playing); playingRef.current = playing;
  const run = useRef(0), audio = useRef<HTMLAudioElement | null>(null);
  const recording = useRef<Narrator | null>(null), release = useRef<() => void>(() => undefined);
  const activeVoice = useRef<string | null>(null), utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingNext = useRef<(() => void) | null>(null);
  const ahead = useRef<{ verse: number; voice: string; promise: Promise<string | null> } | null>(null);
  const discardAhead = () => { const pending = ahead.current; ahead.current = null; if (pending) void pending.promise.then((url) => { if (url) URL.revokeObjectURL(url); }); };
  const options = useRef({ rate, pitch }); options.current = { rate, pitch };
  const currentRef = useRef(current); currentRef.current = current;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setAvailable(speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load(); speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  const clearAudio = () => {
    discardAhead();
    if (audio.current) { audio.current.onended = null; audio.current.ontimeupdate = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute("src"); }
    audio.current = null; recording.current = null; release.current(); release.current = () => undefined;
  };
  const stop = (betweenChapters = false) => {
    continuation.current = betweenChapters; if (!betweenChapters) ambient.stop();
    discardAhead();
    run.current++; if (ttsSupported) speechSynthesis.cancel(); utterance.current = null;
    pendingNext.current = null;
    if (audio.current) audio.current.pause();
    setPlaying(false); setPaused(false); setCurrent(null); setCompleted(false);
  };
  const finish = (generation: number) => {
    if (generation !== run.current) return;
    ambient.stop(); setPlaying(false); setPaused(false); setCurrent(null); setCompleted(true);
  };
  const fail = (generation: number, message: string) => {
    if (generation !== run.current) return;
    stop(); setNotice(message);
  };
  const readVerses = (from: number, generation: number, voice: string | null) => {
    clearAudio(); activeVoice.current = voice;
    const ai = isAiVoice(voice) && !!where;
    const queue = [...(from === 1 && !ai ? [{ verse: 0, text: intro }] : []), ...verses.filter((v) => v.verse >= from)];
    const next = () => {
      if (generation !== run.current) return;
      if (pausedRef.current) { pendingNext.current = next; return; }
      pendingNext.current = null;
      const item = queue.shift(); if (!item) { finish(generation); return; }
      if (ai && where) {
        const prefetched = ahead.current?.verse === item.verse && ahead.current.voice === voice ? ahead.current.promise : null;
        if (prefetched) ahead.current = null;
        void (prefetched ?? Promise.resolve(null)).then((url) => generation === run.current ? url ?? verseAudio(where.slug, where.chapter, item.verse, voice!.slice(3)) : null).then((url) => {
          if (!url) return;
          if (generation !== run.current) { URL.revokeObjectURL(url); return; }
          release.current(); release.current = () => URL.revokeObjectURL(url);
          const a = new Audio(url); audio.current = a; a.playbackRate = options.current.rate;
          a.onended = next; a.onerror = () => fail(generation, "Reading voice is unavailable. Please try again.");
          setCurrent(item.verse); if (!pausedRef.current) void a.play().catch(() => fail(generation, "Tap Play to try the reading voice again."));
          const following = queue[0];
          if (following) ahead.current = { verse: following.verse, voice: voice!, promise: verseAudio(where.slug, where.chapter, following.verse, voice!.slice(3)).then((url) => {
            if (generation !== run.current) { URL.revokeObjectURL(url); return null; } return url;
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
      u.onstart = () => { if (generation === run.current) setCurrent(item.verse || null); };
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
  const play = (from = 1, requestedVoice = voiceName) => {
    discardAhead();
    pendingNext.current = null;
    continuation.current = false; ambient.begin();
    const generation = ++run.current;
    setNotice(""); setCompleted(false); setPlaying(true); setPaused(false); pausedRef.current = false;
    if (ttsSupported) { speechSynthesis.cancel(); speechSynthesis.resume(); }
    const start = async () => {
      const requestedHuman = requestedVoice?.startsWith("narrator:");
      let narrator = narrators.data?.narrators.find((n) => `narrator:${n.id}` === requestedVoice);
      if (requestedHuman && !narrators.data && !narrators.isError) {
        const result = await narrators.refetch(); narrator = result.data?.narrators.find((n) => `narrator:${n.id}` === requestedVoice);
      }
      if (generation !== run.current) return;
      if (!narrator) {
        if (requestedHuman) setNotice("No recording for this chapter. Using your chosen AI reading voice.");
        readVerses(from, generation, requestedHuman ? fallback : requestedVoice); return;
      }
      const verse = narrator.verses.find((v) => v[0] === from);
      if (!verse) { fail(generation, "This verse has no verified recording timing."); return; }
      if (recording.current?.audio !== narrator.audio || !audio.current) {
        clearAudio();
        const source = await narrationSource(narrator.audio);
        if (generation !== run.current) { source.release(); return; }
        release.current = source.release; audio.current = new Audio(source.url); recording.current = narrator;
      }
      const a = audio.current!; activeVoice.current = `narrator:${narrator.id}`;
      a.playbackRate = options.current.rate; a.currentTime = verse[1]; setCurrent(from);
      a.ontimeupdate = () => {
        if (generation !== run.current) return;
        const match = narrator!.verses.find((v) => a.currentTime >= v[1] && a.currentTime < v[2]);
        setCurrent(match?.[0] ?? currentRef.current);
      };
      a.onended = () => finish(generation);
      a.onerror = () => {
        if (generation !== run.current) return;
        setNotice("Recording unavailable. Using your chosen AI reading voice.");
        readVerses(currentRef.current ?? from, generation, fallback);
      };
      void a.play().catch(() => fail(generation, "Tap Play to start the recording."));
    };
    void start().catch(() => fail(generation, "Recording unavailable. Please try again."));
  };
  const setVoice = (name: string | null) => {
    const resume = playing && !paused, from = currentRef.current ?? 1;
    stop(); clearAudio(); setVoiceName(name);
    try { if (name) localStorage.setItem("ttsVoice", name); else localStorage.removeItem("ttsVoice"); } catch { /* private mode */ }
    if (isAiVoice(name)) { setFallback(name!); try { localStorage.setItem("ttsAiVoice", name!); } catch { /* private mode */ } }
    if (resume) play(from, name);
  };
  const toggle = () => {
    if (!playing) { play(current ?? 1); return; }
    const next = !paused; pausedRef.current = next; setPaused(next);
    if (next) ambient.stop(); else ambient.begin();
    if (!next && pendingNext.current) { pendingNext.current(); return; }
    if (audio.current) { if (next) audio.current.pause(); else void audio.current.play().catch(() => fail(run.current, "Tap Play to resume.")); }
    else if (ttsSupported) { if (next) speechSynthesis.pause(); else speechSynthesis.resume(); }
  };
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
    else if (playing && ttsSupported) play(current ?? 1);
  }, [rate, pitch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = `${where?.slug}/${where?.chapter}`;
    const resume = !pausedRef.current && (continuation.current || (previousChapter.current !== key && playingRef.current));
    previousChapter.current = key; stop(resume); clearAudio();
    if (resume && verses.length) play(1);
  }, [verses.length, where?.slug, where?.chapter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ambient.voice(playing && !paused && current !== null); }, [playing, paused, current]);
  useEffect(() => {
    const pause = () => { if (audio.current) audio.current.pause(); if (ttsSupported) speechSynthesis.pause(); pausedRef.current = true; setPaused(true); ambient.background(); };
    const hidden = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", hidden); app?.onEvent("deactivated", pause);
    return () => { document.removeEventListener("visibilitychange", hidden); app?.offEvent("deactivated", pause); };
  }, []);
  useEffect(() => () => { ambient.stop(); run.current++; if (ttsSupported) speechSynthesis.cancel(); clearAudio(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: verses.length > 0 && (ttsSupported || !!where), playing, paused, current, rate, setRate, pitch, setPitch,
    pitchSupported: ttsSupported && !human && !isAiVoice(voiceName), completed, play, stop, toggle,
    voices: available, voice: voiceName, setVoice, currentVoice: activeVoice.current,
    narrators: narrators.data?.narrators ?? [], narratorsLoading: narrators.isPending && !!where,
    narratorsError: narrators.isError, notice };
}
