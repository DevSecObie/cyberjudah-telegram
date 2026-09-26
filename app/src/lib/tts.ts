import { useEffect, useRef, useState } from "react";

/**
 * Listen to a chapter: the browser's speech synthesis, one utterance per verse so the reader
 * can follow along (the verse being read is reported) and pick up from any verse. Rate and
 * voice are the listener's; the screen keeps awake through Telegram's own webview behaviour.
 */
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export function useSpeech(verses: { verse: number; text: string }[], intro: string) {
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
  const play = (from = 1) => {
    if (!ttsSupported) return;
    speechSynthesis.cancel();
    queue.current = [...(from === 1 ? [{ verse: 0, text: intro }] : []), ...verses.filter((v) => v.verse >= from)];
    setPlaying(true);
    void voices().then((vs) => { voiceRef.current = pick(vs); speakNext(); });
  };
  const stop = () => { if (!ttsSupported) return; queue.current = []; speechSynthesis.cancel(); setPlaying(false); setCurrent(null); };
  const toggle = () => { if (!ttsSupported) return; if (playing) { if (speechSynthesis.paused) { speechSynthesis.resume(); } else { speechSynthesis.pause(); } } else play(current ?? 1); };
  useEffect(() => () => { if (ttsSupported) speechSynthesis.cancel(); }, []);
  useEffect(() => { stop(); /* a new chapter */ }, [verses]); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: ttsSupported, playing, paused: playing && ttsSupported && speechSynthesis.paused, current, rate, setRate, play, stop, toggle, voices: available, voice: voiceName, setVoice, currentVoice: voiceRef.current?.name ?? null };
}
