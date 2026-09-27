// YouTube's storyboards: the small frames the player shows while scrubbing, packed into
// sprite sheets (a grid of frames per JPEG) at two or three sizes. The watch page carries a
// spec naming them; this module turns the spec into levels and sheet URLs, and places a
// moment inside a sheet. Pure: no fetch, so it is tested on its own.

/** The player response's storyboard spec and the video's length, from a watch page. */
export function extractStoryboard(html) {
  const m = /"playerStoryboardSpecRenderer":\{"spec":"((?:[^"\\]|\\.)*)"/.exec(html);
  const d = /"lengthSeconds":"(\d+)"/.exec(html);
  if (!m) return null;
  let spec;
  try { spec = JSON.parse(`"${m[1]}"`); } catch { return null; }
  return { spec, duration: d ? Number(d[1]) : 0 };
}

/**
 * Levels of a spec: `base|w#h#frames#rows#cols#ms#name#sigh|...`. `$L` in the base is the
 * level, `$N` the sheet name, whose `$M` is the sheet index. The interval between frames
 * comes from the video's length when known, else from the spec's own millisecond field.
 */
export function parseStoryboard(spec, duration = 0) {
  const [base, ...parts] = String(spec).split("|");
  const levels = [];
  parts.forEach((part, level) => {
    const f = part.split("#");
    if (f.length < 8) return;
    const [w, h, frames, rows, cols, ms, name, sigh] = [Number(f[0]), Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5]), f[6], f[7]];
    if (!(w > 0 && h > 0 && frames > 0 && rows > 0 && cols > 0)) return;
    const perSheet = rows * cols;
    const sheets = Math.ceil(frames / perSheet);
    const interval = duration > 0 ? duration / frames : ms > 0 ? ms / 1000 : 0;
    const template = base.replace("$L", String(level)).replace("$N", name) + `&sigh=${sigh}`;
    levels.push({ level, w, h, frames, rows, cols, sheets, interval, url: (n) => template.replace("$M", String(n)) });
  });
  return levels;
}

/** The public shape of a level: everything but the signed URLs. */
export const publicLevel = ({ level, w, h, frames, rows, cols, sheets, interval }) => ({ level, w, h, frames, rows, cols, sheets, interval });

/** Where the frame for second `t` sits: the sheet and the cell inside it. */
export function locate(level, t) {
  const idx = Math.min(level.frames - 1, Math.max(0, level.interval > 0 ? Math.floor(t / level.interval) : 0));
  const perSheet = level.rows * level.cols;
  const sheet = Math.floor(idx / perSheet), cell = idx % perSheet;
  return { sheet, row: Math.floor(cell / level.cols), col: cell % level.cols, frame: idx };
}

/** The level closest to (at least) `width` pixels wide; the largest when none is. */
export function pickLevel(levels, width) {
  const usable = levels.filter((l) => l.interval > 0);
  return usable.find((l) => l.w >= width) ?? usable[usable.length - 1] ?? null;
}
