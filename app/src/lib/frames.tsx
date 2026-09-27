import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";

import { api } from "@/tg/sdk";

/**
 * Frames of a recording: YouTube's storyboard, the small pictures the player shows while
 * scrubbing, served by the Worker from its bucket. A frame is one cell of a sheet, so it
 * is drawn as a background image positioned on the cell and scaled to the box; nothing is
 * cut out server side, and the same sheet serves every moment on it.
 */
export type Level = { level: number; w: number; h: number; frames: number; rows: number; cols: number; sheets: number; interval: number };
export type Board = { ok: boolean; duration: number; levels: Level[] };

export function useBoard(video: string | null | undefined) {
  return useQuery({ queryKey: ["frames", video], enabled: !!video, staleTime: 3_600_000, retry: false, queryFn: () => api<Board>(`/api/frames/${encodeURIComponent(video!)}`).catch(() => ({ ok: false, duration: 0, levels: [] }) as Board) });
}

/** The level closest to (at least) `width` pixels wide; the largest when none is. */
export function pickLevel(levels: Level[], width: number): Level | null {
  const usable = levels.filter((l) => l.interval > 0);
  return usable.find((l) => l.w >= width) ?? usable[usable.length - 1] ?? null;
}

/**
 * The style that shows the frame for second `t`: the sheet as background, sized to the grid
 * and positioned on the cell in percentages, so the same style fits a box of any size (a
 * fixed `width` is set when given, at 16:9).
 */
export function frameStyle(video: string, board: Board | undefined, t: number, width?: number): CSSProperties | null {
  const l = board?.ok ? pickLevel(board.levels, width ?? 160) : null;
  if (!l) return null;
  const idx = Math.min(l.frames - 1, Math.max(0, Math.floor(t / l.interval)));
  const per = l.rows * l.cols;
  const sheet = Math.floor(idx / per), cell = idx % per, row = Math.floor(cell / l.cols), col = cell % l.cols;
  const x = l.cols > 1 ? (col / (l.cols - 1)) * 100 : 0, y = l.rows > 1 ? (row / (l.rows - 1)) * 100 : 0;
  return {
    ...(width ? { width, height: Math.round((width * l.h) / l.w) } : {}),
    backgroundImage: `url(/frames/${encodeURIComponent(video)}/${l.level}/${sheet}.jpg)`,
    backgroundSize: `${l.cols * 100}% ${l.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: "no-repeat",
  };
}

/** The same, as an inline style string for HTML built outside React (the notes). */
export function frameStyleText(video: string, board: Board | undefined, t: number, width: number): string | null {
  const s = frameStyle(video, board, t, width);
  if (!s) return null;
  return `width:${s.width}px;height:${s.height}px;background-image:${s.backgroundImage};background-size:${s.backgroundSize};background-position:${s.backgroundPosition};background-repeat:no-repeat`;
}

/** The moments the teacher pointed at something on the screen, from the captions. */
export type Visual = { t: number; said: number; text: string };
export function useVisuals(video: string | null | undefined) {
  return useQuery({ queryKey: ["visuals", video], enabled: !!video, staleTime: 3_600_000, retry: false, queryFn: () => api<{ ok: boolean; visuals: Visual[] }>(`/api/visuals/${encodeURIComponent(video!)}`).then((r) => r.visuals).catch(() => [] as Visual[]) });
}

/** One frame of a recording at a moment; nothing when the recording has no frames. */
export function Frame({ video, t, width, className, onClick }: { video: string; t: number; width?: number; className?: string; onClick?: () => void }) {
  const board = useBoard(video);
  const style = frameStyle(video, board.data, t, width);
  if (!style) return null;
  return <span className={`frame${className ? ` ${className}` : ""}`} style={style} role={onClick ? "button" : undefined} onClick={onClick} aria-label={onClick ? "Watch from here" : undefined} />;
}
