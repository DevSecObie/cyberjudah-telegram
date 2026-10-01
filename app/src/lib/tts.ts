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
  const choice = narrators.data?.narrators.find((n) => `narrator:${n.id}` === voiceName);
  const run = useRef(0), audio = useRef<HTMLAudioElement | null>(null);
  const recording = useRef<Narrator | null>(null), release = useRef<() => void>(() => undefined);
  const activeVoice = useRef<string | null>(null), utterance = useRef<SpeechSynthesisUtterance | null>(null);
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
    if (audio.current) { audio.current.onended = null; audio.current.ontimeupdate = null; audio.current.onerror = null; audio.current.pause(); audio.current.removeAttribute("src"); }
    audio.current = null; recording.current = null; release.current(); release.current = () => undefined;
  };
  const stop = () => {
    run.current++; if (ttsSupported) speechSynthesis.cancel(); utterance.current = null;
    if (audio.current) audio.current.pause();
    setPlaying(false); setPaused(false); setCurrent(null); setCompleted(false);
  };
  const finish = (generation: number) => {
    if (generation !== run.current) return;
    setPlaying(false); setPaused(false); setCurrent(null); setCompleted(true);
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
      const item = queue.shift(); if (!item) { finish(generation); return; }
      if (ai && where) {
        void verseAudio(where.slug, where.chapter, item.verse, voice!.slice(3)).then((url) => {
          if (generation !== run.current) { URL.revokeObjectURL(url); return; }
          release.current(); release.current = () => URL.revokeObjectURL(url);
          const a = new Audio(url); audio.current = a; a.playbackRate = options.current.rate;
          a.onended = next; a.onerror = () => fail(generation, "Reading voice is unavailable. Please try again.");
          setCurrent(item.verse); if (!pausedRef.current) void a.play().catch(() => fail(generation, "Tap Play to try the reading voice again."));
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
  const play = (from = 1) => {
    const generation = ++run.current;
    setNotice(""); setCompleted(false); setPlaying(true); setPaused(false); pausedRef.current = false;
    if (ttsSupported) speechSynthesis.cancel();
    const start = async () => {
      let narrator = choice;
      if (human && !narrators.data && !narrators.isError) {
        const result = await narrators.refetch(); narrator = result.data?.narrators.find((n) => `narrator:${n.id}` === voiceName);
      }
      if (generation !== run.current) return;
      if (!narrator) {
        if (human) setNotice("No recording for this chapter. Using your chosen AI reading voice.");
        readVerses(from, generation, human ? fallback : voiceName); return;
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
        setCurrent(match?.[0] ?? null);
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
    stop(); clearAudio(); setVoiceName(name);
    try { if (name) localStorage.setItem("ttsVoice", name); else localStorage.removeItem("ttsVoice"); } catch { /* private mode */ }
    if (isAiVoice(name)) { setFallback(name!); try { localStorage.setItem("ttsAiVoice", name!); } catch { /* private mode */ } }
  };
  const toggle = () => {
    if (!playing) { play(current ?? 1); return; }
    const next = !paused; pausedRef.current = next; setPaused(next);
    if (audio.current) { if (next) audio.current.pause(); else void audio.current.play().catch(() => fail(run.current, "Tap Play to resume.")); }
    else if (ttsSupported) { if (next) speechSynthesis.pause(); else speechSynthesis.resume(); }
  };
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
    else if (playing && ttsSupported) play(current ?? 1);
  }, [rate, pitch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { stop(); clearAudio(); }, [verses]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { run.current++; if (ttsSupported) speechSynthesis.cancel(); clearAudio(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: verses.length > 0 && (ttsSupported || !!where), playing, paused, current, rate, setRate, pitch, setPitch,
    pitchSupported: ttsSupported && !human && !isAiVoice(voiceName), completed, play, stop, toggle,
    voices: available, voice: voiceName, setVoice, currentVoice: activeVoice.current,
    narrators: narrators.data?.narrators ?? [], narratorsLoading: narrators.isPending && !!where,
    narratorsError: narrators.isError, notice };
}
