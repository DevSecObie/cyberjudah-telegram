import { useState } from "react";

import { haptic } from "@/tg/sdk";
import { useAiVoices } from "@/lib/tts";
import { Feather, Ion } from "../icons";
import { HEADER_HEIGHT } from "../dom/Chapter";
import { Sheet } from "./Sheet";

/**
 * BibleFooter: the previous and next chapter buttons (40 px circles at the sides), and the
 * play pill at the bottom centre. Playing opens the audio card (AudioTTSFooter): the
 * reference being read, chapter skips, previous/next verse, play/stop, and the Speed and
 * Repeat chips. In fullscreen the arrows slide off and the pill drops by the header height.
 */
export type Speech = { supported: boolean; playing: boolean; paused: boolean; current: number | null; rate: number; setRate: (r: number) => void; play: (from?: number) => void; stop: () => void; toggle: () => void; voices: SpeechSynthesisVoice[]; voice: string | null; setVoice: (name: string | null) => void; currentVoice: string | null };

export function Footer({ hasPrev, hasNext, onPrev, onNext, speech, fullscreen, hidden, bottomBar, reference, verseCount, repeat, setRepeat, expanded, setExpanded }: {
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; speech: Speech; fullscreen: boolean; hidden: boolean; bottomBar: number; reference: string; verseCount: number; repeat: boolean; setRepeat: (v: boolean) => void; expanded: boolean; setExpanded: (v: boolean) => void;
}) {
  const [voices, setVoices] = useState(false);
  const aiVoices = useAiVoices();
  if (hidden) return null;
  const arrowsY = fullscreen ? HEADER_HEIGHT + 60 + bottomBar : 0;
  const centerY = fullscreen ? HEADER_HEIGHT : 0;
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const nextRate = () => speech.setRate(RATES[(RATES.indexOf(speech.rate) + 1) % RATES.length]);
  const cur = speech.current ?? 1;
  return (
    <div className="bs-footer" style={{ pointerEvents: "none" }}>
      {!fullscreen ? <div className="bs-controlstrip" style={{ bottom: bottomBar }} /> : null}
      <button type="button" className="bs-chapterbtn" style={{ left: 10, bottom: 10 + bottomBar, opacity: hasPrev ? 1 : 0.6, transform: `translateY(${arrowsY}px)` }} disabled={!hasPrev} aria-label="Previous chapter" onClick={() => { haptic(); onPrev(); }}><Feather name="arrow-left" size={20} color="var(--bs-tertiary)" /></button>
      <button type="button" className="bs-chapterbtn" style={{ right: 10, bottom: 10 + bottomBar, opacity: hasNext ? 1 : 0.6, transform: `translateY(${arrowsY}px)` }} disabled={!hasNext} aria-label="Next chapter" onClick={() => { haptic(); onNext(); }}><Feather name="arrow-right" size={20} color="var(--bs-tertiary)" /></button>
      {expanded && speech.supported ? (
        <div className="bs-audio" style={{ bottom: 20 + bottomBar, transform: `translateY(${centerY}px)` }}>
          <div className="bs-audio__top">
            <button type="button" className="bs-iconbtn" aria-label="Collapse" onClick={() => setExpanded(false)}><Feather name="chevron-down" size={20} /></button>
            <b>{reference}{speech.current ? `:${speech.current}` : ""} KJV</b>
            <span className="bs-audio__mode" aria-label="Read aloud"><Feather name="volume-2" size={16} color="currentColor" /></span>
          </div>
          <div className="bs-audio__controls">
            <button type="button" className="bs-audio__ctl" aria-label="Previous chapter" disabled={!hasPrev} onClick={onPrev}><Ion name="play-skip-back" size={20} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Previous verse" onClick={() => speech.play(Math.max(1, cur - 1))}><Feather name="chevron-left" size={22} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__play" aria-label={speech.playing ? "Pause audio playback" : "Start audio playback"} style={{ background: speech.playing && !speech.paused ? "var(--bs-primary)" : "var(--bs-reverse)" }} onClick={() => { haptic(); speech.toggle(); }}><Feather name={speech.playing && !speech.paused ? "pause" : "play"} size={20} color={speech.playing && !speech.paused ? "var(--bs-reverse)" : "var(--bs-primary)"} /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Next verse" onClick={() => speech.play(Math.min(verseCount, cur + 1))}><Feather name="chevron-right" size={22} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Next chapter" disabled={!hasNext} onClick={onNext}><Ion name="play-skip-forward" size={20} color="var(--bs-tertiary)" /></button>
          </div>
          <div className="bs-audio__chips">
            <button type="button" className="bs-chip" onClick={() => setVoices(true)}>Voice</button>
            <button type="button" className="bs-chip" onClick={nextRate}>Speed {speech.rate}x</button>
            <button type="button" className="bs-chip" aria-pressed={repeat} onClick={() => setRepeat(!repeat)}>Repeat</button>
            <button type="button" className="bs-chip" onClick={() => { speech.stop(); setExpanded(false); }}>Stop</button>
          </div>
          <Sheet open={voices} onClose={() => setVoices(false)} title="Voice" subTitle={aiVoices.data?.length ? `${aiVoices.data.length} reading voices, and ${speech.voices.length} on this device` : speech.voices.length ? `${speech.voices.length} English voices on this device` : "No English voice on this device"} height="half">
            <div className="bs-fontlist">
              {aiVoices.data?.map((v) => {
                const id = `ai:${v.id}`, on = speech.voice === id;
                return <button key={id} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(id); setVoices(false); if (speech.playing) speech.play(speech.current ?? 1); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>Reading voice · {v.note}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
              })}
              {speech.voices.map((v) => {
                const on = (speech.voice ?? speech.currentVoice) === v.name;
                return <button key={v.name} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(v.name); setVoices(false); if (speech.playing) speech.play(speech.current ?? 1); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name.replace(/^Microsoft |^Google /, "")}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>{v.lang}{/natural|premium|enhanced|neural|siri/i.test(v.name) ? " · high quality" : ""}{v.localService ? "" : " · online"}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
              })}
            </div>
          </Sheet>
        </div>
      ) : (
        <div className="bs-playpill" style={{ bottom: 10 + bottomBar, transform: `translateY(${centerY}px)` }}>
          <button type="button" className="bs-playbtn" aria-label={speech.playing ? "Pause audio playback" : "Start audio playback"} aria-busy={false} disabled={!speech.supported} style={{ background: speech.playing ? "var(--bs-primary)" : "var(--bs-reverse)", opacity: speech.supported ? 1 : 0.6 }} onClick={() => { haptic(); if (!speech.playing) speech.play(1); setExpanded(true); }}>
            <Feather name="volume-2" size={22} color={speech.playing ? "var(--bs-reverse)" : "var(--bs-primary)"} />
          </button>
        </div>
      )}
    </div>
  );
}
