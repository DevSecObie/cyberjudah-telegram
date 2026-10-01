import { ambient, AMBIENT_TRACKS, useAmbient } from "@/lib/ambient";
import { Sheet } from "./Sheet";
import { Feather } from "../icons";
export function AmbientSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useAmbient();
  const close = () => { ambient.endPreview(); onClose(); };
  return <Sheet open={open} onClose={close} title="Ambient" subTitle="Music under your reading">
    <div className="bs-fontlist">
      <button type="button" role="radio" aria-checked={state.choice === "off"} className="bs-fontrow" onClick={() => ambient.choose("off")}><span>Off</span>{state.choice === "off" ? <Feather name="check" size={18} /> : null}</button>
      {AMBIENT_TRACKS.map((t) => <div className="bs-ambient-row" key={t.id}>
        <button type="button" role="radio" aria-checked={state.choice === t.id} className="bs-fontrow" onClick={() => ambient.choose(t.id)}><span>{t.name}</span>{state.choice === t.id ? <Feather name="check" size={18} /> : null}</button>
        <button type="button" className="bs-iconbtn" aria-label={`${state.preview === t.id ? "Stop preview" : "Preview"} ${t.name}`} onClick={() => ambient.preview(t.id)}><Feather name={state.preview === t.id ? "x" : "play"} size={18} /></button>
      </div>)}
      <label className="bs-ambient-volume">Music volume <span>{Math.round(state.volume * 100)}%</span><input type="range" min="0" max="100" value={Math.round(state.volume * 100)} onChange={(e) => ambient.setVolume(+e.target.value / 100)} /></label>
      {state.error ? <p className="bs-audio__notice" role="status">Music is unavailable. Your reading can continue.</p> : null}
    </div>
  </Sheet>;
}
