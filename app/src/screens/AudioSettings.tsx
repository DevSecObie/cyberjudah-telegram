import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAudioPlayer } from "@/lib/AudioPlayer";
import { useAiVoices, isAiVoice } from "@/lib/tts";
import { recordingJson, type RecordingCredit } from "@/lib/recordings";
import { AUDIO_RATES } from "@/lib/audio-intent.mjs";
import { ambient, AMBIENT_TRACKS, useAmbient } from "@/lib/ambient";
import { AmbientSheet } from "@/bible/ui/AmbientSheet";
import { Sheet } from "@/bible/ui/Sheet";
import { Feather } from "@/bible/icons";
import { useBackButton } from "@/tg/hooks";
import { List, Row, Screen, FormSection as Section } from "@/ui/ui";
import { Value } from "./Settings";

/** One global reader, deduplicated from the whole-book recordings catalog: readers are stable
 * across chapters, unlike the Bible reader's per-chapter Narrators list (Footer.tsx), so this
 * is the only list that makes sense as a standing preference, away from any particular chapter. */
function useLicensedNarrators() {
  return useQuery({
    queryKey: ["recordings-catalog"],
    queryFn: () => recordingJson<{ chapters: RecordingCredit[] }>("/api/recordings/catalog"),
    staleTime: 300_000, retry: 1,
    select: (data) => {
      const byReader = new Map<string, { id: string; reader: string }>();
      data.chapters.forEach((c) => { if (!byReader.has(c.readerId)) byReader.set(c.readerId, { id: c.readerId, reader: c.reader }); });
      return [...byReader.values()];
    },
  });
}

/**
 * Audio settings, reachable from Settings without starting playback (CYB-123): the same
 * shared player preferences the Bible reader uses (AudioPlayer.tsx), so a choice made here
 * takes effect there, and vice versa. Nothing on this screen calls play() or toggle().
 */
export function AudioSettings() {
  useBackButton(true);
  const player = useAudioPlayer();
  const { speech } = player;
  const aiVoices = useAiVoices();
  const narrators = useLicensedNarrators();
  const ambientState = useAmbient();
  const [voiceSheet, setVoiceSheet] = useState(false);
  const [adjust, setAdjust] = useState<"Speed" | "Pitch" | null>(null);
  const [ambientSheet, setAmbientSheet] = useState(false);

  const voiceLabel = speech.voice === null ? "Default" : speech.voice.startsWith("narrator:") ? narrators.data?.find((n) => `narrator:${n.id}` === speech.voice)?.reader ?? "Licensed narrator" : isAiVoice(speech.voice) ? aiVoices.data?.find((v) => `ai:${v.id}` === speech.voice)?.name ?? "Generated voice" : speech.voice.replace(/^Microsoft |^Google /, "");

  // A saved preference the current catalogs no longer list: flagged once each list has actually loaded, never while still loading.
  const narratorGone = speech.voice?.startsWith("narrator:") && !!narrators.data && !narrators.data.some((n) => `narrator:${n.id}` === speech.voice);
  const aiGone = speech.voice ? isAiVoice(speech.voice) && !!aiVoices.data && !aiVoices.data.some((v) => `ai:${v.id}` === speech.voice) : false;
  const deviceGone = speech.voice !== null && !speech.voice.startsWith("narrator:") && !isAiVoice(speech.voice) && speech.voices.length > 0 && !speech.voices.some((v) => v.name === speech.voice);
  const unavailable = narratorGone || aiGone || deviceGone;
  const defaultAiVoice = aiVoices.data?.[0] ? `ai:${aiVoices.data[0].id}` : "ai:asteria";

  return (
    <Screen title="Audio settings">
      <Section title="Reading voice">
        <List>
          <Row onClick={() => setVoiceSheet(true)} title="Voice" sub="Licensed narrators, generated reading voices, and this device's own voices" trailing={<Value>{voiceLabel}</Value>} />
        </List>
        {unavailable ? (
          <p className="hint" role="status">
            {narratorGone ? "The licensed narrator you chose is no longer listed. " : aiGone ? "The generated voice you chose is no longer listed. " : "The device voice you chose is no longer on this device. "}
            Your reading continues with a fallback when you play; nothing has been changed here.{" "}
            <button type="button" className="link" onClick={() => setVoiceSheet(true)}>Choose again</button>{" "}
            <button type="button" className="link" onClick={() => speech.setVoice(defaultAiVoice)}>Use the free generated voice</button>
          </p>
        ) : null}
        <p className="hint">
          <b>Licensed narrators</b> are human recordings; they cover some chapters and need a connection unless you save a book's narration for offline use.{" "}
          <b>Generated voices</b> are read aloud for every chapter; they need a connection the first time a verse is heard, then replay from this device.{" "}
          <b>Device voices</b> come from this phone or browser and work fully offline, but which voices exist depends on the device.
        </p>
      </Section>
      <Section title="Speed and pitch">
        <List>
          <Row onClick={() => setAdjust("Speed")} title="Speed" trailing={<Value>{`${speech.rate}x`}</Value>} />
          <Row onClick={() => speech.pitchSupported && setAdjust("Pitch")} title="Pitch" sub={!speech.pitchSupported ? "Available with device voices" : undefined} trailing={<Value>{`${speech.pitch}x`}</Value>} />
        </List>
      </Section>
      <Section title="Ambient sound">
        <List>
          <Row onClick={() => setAmbientSheet(true)} title="Ambient sound" trailing={<Value>{ambientState.choice === "off" ? "Off" : AMBIENT_TRACKS.find((t) => t.id === ambientState.choice)?.name ?? "Off"}</Value>} />
        </List>
        <label className="bs-ambient-volume" style={{ padding: "8px 16px" }}>Ambient volume <span>{Math.round(ambientState.volume * 100)}%</span>
          <input type="range" min="0" max="100" value={Math.round(ambientState.volume * 100)} onChange={(e) => ambient.setVolume(+e.target.value / 100)} />
        </label>
        {ambientState.error ? <p className="hint" role="status">Ambient sound is unavailable. Reading can continue without it.</p> : null}
      </Section>

      <Sheet open={voiceSheet} onClose={() => setVoiceSheet(false)} title="Voice" subTitle={aiVoices.data?.length ? `${aiVoices.data.length} reading voices, and ${speech.voices.length} on this device` : speech.voices.length ? `${speech.voices.length} English voices on this device` : "No English voice on this device"} height="half">
        <div className="bs-fontlist">
          <h3 className="bs-audio__group">Licensed narrators</h3>
          {narrators.isPending ? <p className="bs-audio__notice">Finding recordings…</p> : narrators.isError ? <p className="bs-audio__notice">Recordings are unavailable right now. <button type="button" className="link" onClick={() => void narrators.refetch()}>Retry</button></p> : !narrators.data?.length ? <p className="bs-audio__notice">No licensed narrators yet.</p> : null}
          {narrators.data?.map((n) => <button key={n.id} type="button" role="radio" aria-checked={speech.voice === `narrator:${n.id}`} className="bs-fontrow" onClick={() => { speech.setVoice(`narrator:${n.id}`); setVoiceSheet(false); }}><span>{n.reader}<small className="bs-audio__detail">Licensed narration · KJV · plays when this reader recorded the chapter</small></span>{speech.voice === `narrator:${n.id}` ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>)}
          <h3 className="bs-audio__group">AI reading voices</h3>
          {aiVoices.isError ? <p className="bs-audio__notice">Reading voices are unavailable right now. <button type="button" className="link" onClick={() => void aiVoices.refetch()}>Retry</button></p> : aiVoices.isPending ? <p className="bs-audio__notice">Finding reading voices…</p> : null}
          {aiVoices.data?.map((v) => {
            const id = `ai:${v.id}`, on = speech.voice === id;
            return <button key={id} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(id); setVoiceSheet(false); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>Generated reading voice · {v.note}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
          })}
          <h3 className="bs-audio__group">Device voices</h3>
          {!speech.voices.length ? <p className="bs-audio__notice">No English voice found on this device.</p> : null}
          {speech.voices.map((v) => {
            const on = speech.voice === v.name;
            return <button key={v.name} type="button" role="radio" aria-checked={on} className="bs-fontrow" onClick={() => { speech.setVoice(v.name); setVoiceSheet(false); }}><span style={{ color: on ? "var(--bs-primary)" : "var(--bs-default)" }}>{v.name.replace(/^Microsoft |^Google /, "")}<small style={{ display: "block", fontSize: 12, color: "var(--bs-tertiary)" }}>{v.lang}{/natural|premium|enhanced|neural|siri/i.test(v.name) ? " · high quality" : ""}{v.localService ? " · offline" : " · online"}</small></span>{on ? <Feather name="check" size={20} color="var(--bs-primary)" /> : null}</button>;
          })}
        </div>
      </Sheet>

      <Sheet open={adjust !== null} onClose={() => setAdjust(null)} title={adjust ?? "Audio"}>
        <div className="bs-fontlist">{AUDIO_RATES.map((value) => <button key={value} type="button" role="radio" aria-checked={value === (adjust === "Pitch" ? speech.pitch : speech.rate)} className="bs-fontrow" onClick={() => { if (adjust === "Pitch") speech.setPitch(value); else speech.setRate(value); setAdjust(null); }}><span>{value}x</span>{value === (adjust === "Pitch" ? speech.pitch : speech.rate) ? <Feather name="check" size={18} color="var(--bs-primary)" /> : null}</button>)}</div>
      </Sheet>

      <AmbientSheet open={ambientSheet} onClose={() => setAmbientSheet(false)} />
    </Screen>
  );
}
