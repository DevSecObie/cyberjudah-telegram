import { useAudioPlayer } from "@/lib/AudioPlayer";
import { useNavigate } from "react-router";
import { AUDIO_RATES } from "@/lib/audio-intent.mjs";
import { AmbientSheet } from "./AmbientSheet";
import { useAmbient } from "@/lib/ambient";
import { useState } from "react";

import { haptic } from "@/tg/sdk";
import type { Narrator } from "@/lib/recordings";
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
export type Speech = { supported: boolean; loading?: boolean; playing: boolean; paused: boolean; current: number | null; rate: number; setRate: (r: number) => void; pitch: number; setPitch: (p: number) => void; pitchSupported: boolean; play: (from?: number) => void; stop: () => void; toggle: () => void; voices: SpeechSynthesisVoice[]; voice: string | null; setVoice: (name: string | null) => void; currentVoice: string | null; narrators: Narrator[]; narratorsLoading: boolean; narratorsError: boolean; narratorsRefetch: () => void; notice: string };

export function Footer({ hasPrev, hasNext, onPrev, onNext, speech, fullscreen, hidden, bottomBar, reference, verseCount, repeat, setRepeat, expanded, setExpanded }: {
  hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; speech: Speech; fullscreen: boolean; hidden: boolean; bottomBar: number; reference: string; verseCount: number; repeat: boolean; setRepeat: (v: boolean) => void; expanded: boolean; setExpanded: (v: boolean) => void;
}) {
  const ambient = useAmbient();
  const player = useAudioPlayer(), navigate = useNavigate();
  const passage = player.selection;
  const returnToPassage = () => { if (passage) navigate(`/read/${passage.where.slug}/${passage.where.chapter}`); };
  const [ambientOpen, setAmbientOpen] = useState(false);
  const [voices, setVoices] = useState(false);
  const [adjust, setAdjust] = useState<"Speed" | "Pitch" | null>(null);
  const aiVoices = useAiVoices();
  if (hidden) return null;
  const arrowsY = fullscreen ? HEADER_HEIGHT + 60 + bottomBar : 0;
  const centerY = fullscreen ? HEADER_HEIGHT : 0;
  const RATES = AUDIO_RATES;
  const cur = speech.current ?? 1;
  const playbackLabel = !speech.playing ? "Start audio playback" : speech.paused ? "Resume audio playback" : "Pause audio playback";
  return (
    <div className="bs-footer" style={{ pointerEvents: "none" }}>
      <button type="button" className="bs-chapterbtn" style={{ left: 10, bottom: 10 + bottomBar, opacity: hasPrev ? 1 : 0.6, transform: `translateY(${arrowsY}px)` }} disabled={!hasPrev} aria-label="Previous chapter" title="Previous chapter" onClick={() => { haptic(); onPrev(); }}><Feather name="arrow-left" size={20} color="var(--bs-tertiary)" /></button>
      <button type="button" className="bs-chapterbtn" style={{ right: 10, bottom: 10 + bottomBar, opacity: hasNext ? 1 : 0.6, transform: `translateY(${arrowsY}px)` }} disabled={!hasNext} aria-label="Next chapter" title="Next chapter" onClick={() => { haptic(); onNext(); }}><Feather name="arrow-right" size={20} color="var(--bs-tertiary)" /></button>
      {expanded && speech.supported ? (
        <div className="bs-audio" style={{ bottom: 20 + bottomBar, transform: `translateY(${centerY}px)` }}>
          <div className="bs-audio__top">
            <button type="button" className="bs-iconbtn" aria-label="Collapse" title="Collapse" onClick={() => setExpanded(false)}><Feather name="chevron-down" size={20} /></button>
            <button type="button" className="bs-chip" aria-label="Return to current passage" onClick={returnToPassage}>{passage?.label ?? reference}:{cur} KJV</button>
            <span className="bs-audio__mode" aria-label="Read aloud"><Feather name="volume-2" size={16} color="currentColor" /></span>
          </div>
          <div className="bs-audio__controls">
            <button type="button" className="bs-audio__ctl" aria-label="Previous chapter" title="Previous chapter" disabled={!player.previous} onClick={() => player.skip(-1)}><Ion name="play-skip-back" size={20} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Previous verse" title="Previous verse" onClick={() => speech.play(Math.max(1, cur - 1))}><Feather name="chevron-left" size={22} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__play" aria-label={playbackLabel} title={playbackLabel} onClick={() => { haptic(); speech.toggle(); }}><Feather name={speech.playing && !speech.paused ? "pause" : "play"} size={24} color={speech.playing ? "var(--bs-quart)" : "var(--bs-primary)"} /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Next verse" title="Next verse" onClick={() => speech.play(Math.min(passage?.verses.length ?? verseCount, cur + 1))}><Feather name="chevron-right" size={22} color="var(--bs-tertiary)" /></button>
            <button type="button" className="bs-audio__ctl" aria-label="Next chapter" title="Next chapter" disabled={!player.next} onClick={() => player.skip(1)}><Ion name="play-skip-forward" size={20} color="var(--bs-tertiary)" /></button>
          </div>
          {speech.loading ? <p className="bs-audio__notice" role="status">Loading audio…</p> : null}
          {speech.notice ? <p className="bs-audio__notice" role="status">{speech.notice}</p> : null}
          <div className="bs-audio__chips">
            {speech.playing ? <button type="button" className="bs-chip" aria-label="Stop audio playback" onClick={() => speech.stop()}><Feather name="x" size={12} />Stop</button> : null}
            <button type="button" className="bs-chip" onClick={() => setVoices(true)}><Feather name="mic" size={12} />Voice</button>
            <button type="button" className="bs-chip" onClick={() => setAdjust("Speed")}><Feather name="clock" size={12} />Speed {speech.rate}x</button>
            <button type="button" className="bs-chip" disabled={!speech.pitchSupported} title={!speech.pitchSupported ? "Pitch is available with device voices" : undefined} onClick={() => setAdjust("Pitch")}><Feather name="sliders" size={12} />Pitch {speech.pitch}x</button>
            <button type="button" className="bs-chip" onClick={() => setAmbientOpen(true)} aria-label={ambient.error ? "Ambient unavailable" : "Ambient"} title={ambient.error ? "Ambient unavailable" : "Ambient"}><Feather name={ambient.error ? "alert-circle" : "music"} size={12} />Ambient</button>
            <button type="button" className="bs-chip" aria-pressed={repeat} onClick={() => setRepeat(!repeat)}><Feather name="repeat" size={12} />Repeat</button>
          </div>

        </div>
      ) : (
        <div className="bs-playpill" style={{ bottom: 10 + bottomBar, transform: `translateY(${centerY}px)` }}>
          <button type="button" className="bs-playbtn" aria-label={playbackLabel} title={playbackLabel} aria-busy={speech.loading ?? false} disabled={!speech.supported} style={{ background: speech.playing ? "var(--bs-primary)" : "var(--bs-reverse)", opacity: speech.supported ? 1 : 0.6 }} onClick={() => { haptic(); speech.toggle(); setExpanded(true); }}>
            <Feather name="volume-2" size={22} color={speech.playing ? "var(--bs-reverse)" : "var(--bs-primary)"} />
          </button>
          {speech.playing ? <><button type="button" className="bs-iconbtn" aria-label="Stop audio playback" onClick={speech.stop}><Feather name="x" size={20} /></button><button type="button" className="bs-iconbtn" aria-label="Next audio chapter" disabled={!player.next} onClick={() => player.skip(1)}><Feather name="skip-forward" size={20} /></button></> : null}
        </div>
      )}
          <AmbientSheet open={ambientOpen} onClose={() => setAmbientOpen(false)} />
          <Sheet open={adjust !== null} onClose={() => setAdjust(null)} title={adjust ?? "Audio"}>
            <div className="bs-fontlist">{RATES.map((value) => <button key={value} type="button" role="radio" aria-checked={value === (adjust === "Pitch" ? speech.pitch : speech.rate)} className="bs-fontrow" onClick={() => { if (adjust === "Pitch") speech.setPitch(value); else speech.setRate(value); setAdjust(null); }}><span>{value}x</span>{value === (adjust === "Pitch" ? speech.pitch : speech.rate) ? <Feather name="check" size={18} color="var(--bs-primary)" /> : null}</button>)}</div>
          </Sheet>
          <Sheet open={voices} onClose={() => setVoices(false)} title="Voice" subTitle={aiVoices.data?.length ? `${aiVoices.data.length} reading voices, and ${speech.voices.length} on this device` : speech.voices.length ? `${speech.voices.length} English voices on this device` : "No English voice on this device"} height="half">
            <div className="bs-fontlist">
              <h3 className="bs-audio__group">Narrators</h3>
              {speech.narratorsLoading ? <p className="bs-audio__notice">Finding recordings…</p> : !speech.narrators.length ? (
                <p className="bs-audio__notice">
                  {speech.narratorsError ? <>Recordings are unavailable right now. <button type="button" className="link" onClick={speech.narratorsRefetch}>Retry</button></> : "No recording for this chapter. Choose an AI reading voice below."}
                </p>
              ) : null}
              {speech.narrators.map((n) => <button key={n.id} type="button" role="radio" aria-checked={speech.voice === `narrator:${n.id}`} className="bs-fontrow" onClick={() => { speech.setVoice(`narrator:${n.id}`); setVoices(false); }}><span>{n.reader}<small className="bs-audio__detail">Licensed narration · KJV</small></span>{speech.voice === `narrator:${n.id}` ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>)}
              <h3 className="bs-audio__group">AI reading voices</h3>
              {aiVoices.isError ? <p className="bs-audio__notice">Reading voices are unavailable right now. <button type="button" className="link" onClick={() => void aiVoices.refetch()}>Retry</button></p> : aiVoices.isPending ? <p className="bs-audio__notice">Finding reading voices…</p> : null}
              {aiVoices.data?.map((v) => {
                const id = `ai:${v.id}`, on = speech.voice === id;
                return <button key={id} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(id); setVoices(false); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>Reading voice · {v.note}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
              })}
              <h3 className="bs-audio__group">Device voices</h3>
              {speech.voices.map((v) => {
                const on = (speech.voice ?? speech.currentVoice) === v.name;
                return <button key={v.name} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(v.name); setVoices(false); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name.replace(/^Microsoft |^Google /, "")}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>{v.lang}{/natural|premium|enhanced|neural|siri/i.test(v.name) ? " · high quality" : ""}{v.localService ? "" : " · online"}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
              })}
            </div>
          </Sheet>
    </div>
  );
}
