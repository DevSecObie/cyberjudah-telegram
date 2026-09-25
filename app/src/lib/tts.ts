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
  const voice = () => {
    const vs = speechSynthesis.getVoices();
    return vs.find((v) => /en[-_](GB|US)/i.test(v.lang) && /natural|premium|enhanced|neural/i.test(v.name)) ?? vs.find((v) => /^en/i.test(v.lang)) ?? null;
  };
  const speakNext = () => {
    const item = queue.current.shift();
    if (!item) { setPlaying(false); setCurrent(null); return; }
    const u = new SpeechSynthesisUtterance(item.text);
    u.rate = rateRef.current; u.lang = "en-GB"; const v = voice(); if (v) u.voice = v;
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
    speakNext();
  };
  const stop = () => { if (!ttsSupported) return; queue.current = []; speechSynthesis.cancel(); setPlaying(false); setCurrent(null); };
  const toggle = () => { if (!ttsSupported) return; if (playing) { if (speechSynthesis.paused) { speechSynthesis.resume(); } else { speechSynthesis.pause(); } } else play(current ?? 1); };
  useEffect(() => () => { if (ttsSupported) speechSynthesis.cancel(); }, []);
  useEffect(() => { stop(); /* a new chapter */ }, [verses]); // eslint-disable-line react-hooks/exhaustive-deps
  return { supported: ttsSupported, playing, paused: playing && ttsSupported && speechSynthesis.paused, current, rate, setRate, play, stop, toggle };
}
