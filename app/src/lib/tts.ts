import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

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

/**
 * Listen to a chapter: the browser's speech synthesis, one utterance per verse so the reader
 * can follow along (the verse being read is reported) and pick up from any verse. Rate and
 * voice are the listener's; the screen keeps awake through Telegram's own webview behaviour.
 */
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export function useSpeech(verses: { verse: number; text: string }[], intro: string, where?: { slug: string; chapter: number }) {
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const queue = useRef<{ verse: number; text: string }[]>([]);
  const rateRef = useRef(rate); rateRef.current = rate;
  // One voice for the whole chapter, chosen once when playback starts: the voice list loads
  // asynchronously, so choosing per verse would read the first verses in the default voice
  // and switch once the list arrived.
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const [available, setAvailable] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(() => { try { return localStorage.getItem("ttsVoice"); } catch { return null; } });
  const voiceNameRef = useRef(voiceName); voiceNameRef.current = voiceName;
  // The reader's choice first; else the best English voice on the device (the "natural",
  // "premium", "enhanced" or "neural" ones read far better than the compact defaults).
  const pick = (vs: SpeechSynthesisVoice[]) => vs.find((v) => v.name === voiceNameRef.current) ?? vs.find((v) => /^en/i.test(v.lang) && /natural|premium|enhanced|neural|siri/i.test(v.name)) ?? vs.find((v) => /en[-_](GB|US)/i.test(v.lang)) ?? vs.find((v) => /^en/i.test(v.lang)) ?? vs[0] ?? null;
  useEffect(() => {
    if (!ttsSupported) return;
    const load = () => setAvailable(speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)));
    load(); speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  const setVoice = (name: string | null) => { setVoiceName(name); try { if (name) localStorage.setItem("ttsVoice", name); else localStorage.removeItem("ttsVoice"); } catch { /* ignore */ } };
  const voices = () => new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const vs = speechSynthesis.getVoices();
    if (vs.length) { resolve(vs); return; }
    const t = setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    speechSynthesis.addEventListener("voiceschanged", () => { clearTimeout(t); resolve(speechSynthesis.getVoices()); }, { once: true });
  });
  // The AI voices: one <audio> per verse, the next verse's audio fetched ahead.
  const audio = useRef<HTMLAudioElement | null>(null);
  const ahead = useRef<{ verse: number; url: Promise<string> } | null>(null);
  const [aiState, setAiState] = useState<{ playing: boolean; paused: boolean }>({ playing: false, paused: false });
  const stopAi = () => { const a = audio.current; if (a) { a.onended = null; a.pause(); a.src = ""; } audio.current = null; ahead.current = null; queue.current = []; setAiState({ playing: false, paused: false }); setPlaying(false); setCurrent(null); };
  const playAiNext = () => {
    const item = queue.current.shift();
    const voice = (voiceNameRef.current ?? "").slice(3);
    if (!item || !where) { stopAi(); return; }
    const url = ahead.current?.verse === item.verse ? ahead.current.url : item.verse > 0 ? verseAudio(where.slug, where.chapter, item.verse, voice) : Promise.resolve("");
    const next = queue.current[0];
    ahead.current = next && next.verse > 0 ? { verse: next.verse, url: verseAudio(where.slug, where.chapter, next.verse, voice) } : null;
    void url.then((src) => {
      if (!aiRun.current) return;
      if (!src) { playAiNext(); return; }
      const a = new Audio(src); audio.current = a;
      a.playbackRate = rateRef.current;
      a.onended = () => { URL.revokeObjectURL(src); playAiNext(); };
      a.onerror = () => stopAi();
      setCurrent(item.verse);
      void a.play().catch(() => stopAi());
    }).catch(() => stopAi());
  };
  const aiRun = useRef(false);
  const speakNext = () => {
    const item = queue.current.shift();
    if (!item) { setPlaying(false); setCurrent(null); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = rateRef.current; const v = voiceRef.current; if (v) { u.voice = v; u.lang = v.lang; } else u.lang = "en-GB";
    u.onstart = () => setCurrent(item.verse > 0 ? item.verse : null);
    u.onend = speakNext;
    u.onerror = () => { setPlaying(false); setCurrent(null); };
    speechSynthesis.speak(u);
  };
  const ai = isAiVoice(voiceName) && !!where;
  const play = (from = 1) => {
    if (ttsSupported) speechSynthesis.cancel();
    stopAi();
    queue.current = [...(from === 1 && !ai ? [{ verse: 0, text: intro }] : []), ...verses.filter((v) => v.verse >= from)];
    setPlaying(true);
    if (ai) { aiRun.current = true; setAiState({ playing: true, paused: false }); playAiNext(); return; }
    if (!ttsSupported) { setPlaying(false); return; }
    void voices().then((vs) => { voiceRef.current = pick(vs); speakNext(); });
  };
  const stop = () => { aiRun.current = false; stopAi(); if (ttsSupported) { queue.current = []; speechSynthesis.cancel(); } setPlaying(false); setCurrent(null); };
  const toggle = () => {
    if (!playing) { play(current ?? 1); return; }
    if (aiState.playing) { const a = audio.current; if (!a) return; if (a.paused) { void a.play(); setAiState({ playing: true, paused: false }); } else { a.pause(); setAiState({ playing: true, paused: true }); } return; }
    if (!ttsSupported) return;
    if (speechSynthesis.paused) { speechSynthesis.resume(); } else { speechSynthesis.pause(); }
  };
  useEffect(() => { if (audio.current) audio.current.playbackRate = rate; }, [rate]);
  useEffect(() => () => { aiRun.current = false; if (ttsSupported) speechSynthesis.cancel(); const a = audio.current; if (a) { a.pause(); a.src = ""; } }, []);
  useEffect(() => { stop(); /* a new chapter */ }, [verses]); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: ttsSupported || ai, playing, paused: aiState.playing ? aiState.paused : playing && ttsSupported && speechSynthesis.paused, current, rate, setRate, play, stop, toggle, voices: available, voice: voiceName, setVoice, currentVoice: ai ? voiceName : voiceRef.current?.name ?? null };
}
