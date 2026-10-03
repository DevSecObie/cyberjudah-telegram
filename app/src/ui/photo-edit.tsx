import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

import { Sheet } from "@/bible/ui/Sheet";
import { api, ApiError, haptic } from "@/tg/sdk";
import "./photo-edit.css";

/**
 * Photos an admin sets from the app (bot/src/photos.ts): a leader's portrait, a period's cover,
 * an event's picture. `usePhotos` is what every reader sees (slot → URL); `PhotoEdit` is the
 * admin's button: choose a photo, drag and zoom it in the frame, Save. The crop is made on the
 * phone, so only the framed photo is sent. "Remove photo" brings back the app's own.
 */
export type PhotoSlot = `leader:${string}` | `period:${string}` | `event:${string}`;

export function usePhotos() {
  return useQuery({
    queryKey: ["photos"],
    queryFn: async () => { const r = await fetch("/api/photos"); return (r.ok ? await r.json() : {}) as Record<string, string>; },
    staleTime: 60_000,
    retry: 1,
  });
}

/** Whether this reader is an admin (/api/me), shared with the note editor's query. */
export function useIsAdmin() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ admin?: boolean; canEdit?: boolean }>("/api/me"), staleTime: 600_000, retry: false });
  return !!me.data?.admin;
}

/** The frame a slot is cut to, and the size sent: square portraits, 4:5 covers (their period pictures). */
const SHAPE = { square: { w: 512, h: 512 }, cover: { w: 640, h: 800 } } as const;

export function PhotoEdit({ slot, label, shape = "square", hasPhoto }: { slot: PhotoSlot; label: string; shape?: keyof typeof SHAPE; hasPhoto: boolean }) {
  const admin = useIsAdmin();
  const photos = usePhotos();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  if (!admin) return null;
  const set = !!photos.data?.[slot];
  return (
    <div className="photo-edit">
      <button type="button" className="btn btn--bordered btn--sm photo-edit__btn" onClick={() => { haptic("select"); input.current?.click(); }}>{hasPhoto ? "Change photo" : "Add photo"}</button>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setFile(f); }} />
      {file ? <Framer file={file} slot={slot} label={label} shape={shape} canRemove={set} onDone={() => setFile(null)} /> : null}
    </div>
  );
}

function Framer({ file, slot, label, shape, canRemove, onDone }: { file: File; slot: PhotoSlot; label: string; shape: keyof typeof SHAPE; canRemove: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const out = SHAPE[shape];
  const frame = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [fw, setFw] = useState(280);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState("");
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const fh = Math.round(fw * out.h / out.w);

  // The photo is decoded straight from the file and drawn on a canvas: no URL to it is ever made.
  useEffect(() => {
    let live = true, bmp: ImageBitmap | null = null;
    createImageBitmap(file).then((b) => { bmp = b; if (live) setImg(b); else b.close(); }, () => { if (live) { setError("That file is not a photo this phone can open."); setState("error"); } });
    return () => { live = false; bmp?.close(); };
  }, [file]);
  useEffect(() => { if (frame.current) setFw(frame.current.clientWidth); }, [img]);
  // The photo covers the frame at zoom 1; it can be enlarged and moved but never leave a gap.
  const base = img ? Math.max(fw / img.width, fh / img.height) : 1;
  const scale = base * zoom;
  const w = img ? img.width * scale : 0, h = img ? img.height * scale : 0;
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(fw - w, p.x)), y: Math.min(0, Math.max(fh - h, p.y)) });
  // Centred when it loads, and kept in bounds as the zoom changes.
  useEffect(() => { if (img) setPos({ x: (fw - w) / 2, y: (fh - h) / 2 }); }, [img, fw]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPos((p) => clamp(p)); }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const c = view.current;
    if (!c || !img) return;
    const r = window.devicePixelRatio || 1;
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  }, [img, w, h]);

  const down = (e: RPointerEvent) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; };
  const move = (e: RPointerEvent) => { const d = drag.current; if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y })); };
  const up = () => { drag.current = null; };

  const save = async () => {
    if (!img) return;
    setState("saving");
    try {
      const c = document.createElement("canvas");
      c.width = out.w; c.height = out.h;
      const k = out.w / fw;
      c.getContext("2d")!.drawImage(img, pos.x * k, pos.y * k, w * k, h * k);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.88));
      if (!blob) throw new Error("The photo could not be prepared.");
      await api(`/api/admin/photos?slot=${encodeURIComponent(slot)}`, { method: "PUT", body: blob, headers: { "content-type": "image/jpeg" } });
      haptic("success");
      await qc.invalidateQueries({ queryKey: ["photos"] });
      onDone();
    } catch (e) {
      haptic("error");
      setError(e instanceof ApiError && e.status === 403 ? "Only an admin can change photos." : e instanceof ApiError && e.status === 413 ? "That photo is too large." : "The photo was not saved. Try again.");
      setState("error");
    }
  };
  const remove = async () => {
    setState("saving");
    try {
      await api(`/api/admin/photos?slot=${encodeURIComponent(slot)}`, { method: "DELETE" });
      haptic("success");
      await qc.invalidateQueries({ queryKey: ["photos"] });
      onDone();
    } catch {
      setError("The photo was not removed. Try again.");
      setState("error");
    }
  };

  return (
    <Sheet open onClose={onDone} height="full" title={label} subTitle="Drag to frame it, then Save" className="photo-sheet">
      <div className="photo-frame" ref={frame} style={{ aspectRatio: `${out.w} / ${out.h}` }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {img ? <canvas ref={view} aria-hidden="true" style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }} /> : <span className="hint" aria-busy="true">Loading the photo…</span>}
      </div>
      <label className="photo-zoom"><span>Zoom</span><input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" /></label>
      {state === "error" ? <p className="photo-error" role="alert">{error}</p> : null}
      <div className="photo-actions">
        <button type="button" className="btn" disabled={!img || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>
        {canRemove ? <button type="button" className="btn btn--quiet" disabled={state === "saving"} onClick={() => void remove()}>Remove photo</button> : null}
        <button type="button" className="btn btn--quiet" disabled={state === "saving"} onClick={onDone}>Cancel</button>
      </div>
      <p className="hint photo-note">Everyone sees the new photo straight away. Remove photo brings back the app's own.</p>
    </Sheet>
  );
}
