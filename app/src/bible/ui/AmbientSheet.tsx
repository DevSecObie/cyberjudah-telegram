import { ambient, AMBIENT_TRACKS, useAmbient } from "@/lib/ambient";
import { Sheet } from "./Sheet";
import { Feather } from "../icons";
import { useState } from "react";
export function AmbientSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAmbient();
  const [category, setCategory] = useState(() => AMBIENT_TRACKS.find((t) => t.id === state.choice)?.category ?? "nature");
  const close = () => { ambient.endPreview(); onClose(); };
  return <Sheet open={open} onClose={close} title="Ambient" subTitle="A quiet background for reading" footer={
    <label className="bs-ambient-volume">Ambient volume <span>{Math.round(state.volume * 100)}%</span><input type="range" min="0" max="100" value={Math.round(state.volume * 100)} onChange={(e) => ambient.setVolume(+e.target.value / 100)} /></label>
  }>
    <div className="bs-fontlist">
      <button type="button" role="radio" aria-checked={state.choice === "off"} className="bs-fontrow" onClick={() => ambient.choose("off")}><span>Off</span>{state.choice === "off" ? <Feather name="check" size={18} /> : null}</button>
      <div className="bs-ambient-tabs" role="tablist" aria-label="Ambient sounds">{["nature", "music"].map((kind) => <button key={kind} type="button" role="tab" aria-selected={category === kind} className="bs-chip" onClick={() => setCategory(kind)}>{kind === "nature" ? "Nature" : "Music"}</button>)}</div>
      {AMBIENT_TRACKS.filter((t) => t.category === category).map((t) => <div className="bs-ambient-row" key={t.id}>
        <button type="button" role="radio" aria-checked={state.choice === t.id} className="bs-fontrow" onClick={() => ambient.choose(t.id)}><span>{t.name}</span>{state.choice === t.id ? <Feather name="check" size={18} /> : null}</button>
        <button type="button" className="bs-iconbtn" aria-label={`${state.preview === t.id ? "Stop preview" : "Preview"} ${t.name}`} onClick={() => ambient.preview(t.id)}><Feather name={state.preview === t.id ? "x" : "play"} size={18} /></button>
      </div>)}
      {state.error ? <p className="bs-audio__notice" role="status">Ambient sound is unavailable. Your reading can continue.</p> : null}
    </div>
  </Sheet>;
}
