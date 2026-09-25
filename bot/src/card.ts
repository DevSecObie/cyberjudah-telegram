import { escapeHtml } from "./data";

/**
 * A 1200x630 verse card as SVG, for link previews and sharing. Long verses get a smaller
 * face so the whole text fits; the wrap is by an average glyph width, which is enough for a
 * serif at these sizes.
 */
const W = 1200, H = 630, PAD = 90;

function wrap(text: string, size: number, width: number): string[] {
  const perLine = Math.floor(width / (size * 0.48));
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export function verseCard(text: string, reference: string): string {
  const width = W - PAD * 2;
  let size = 48, lines = wrap(text, size, width);
  // Shrink until the block fits above the reference line (about 380px of room).
  while (lines.length * size * 1.35 > 380 && size > 22) { size -= 2; lines = wrap(text, size, width); }
  const lineH = size * 1.35;
  const top = (H - 110 - lines.length * lineH) / 2 + size;
  const body = lines.map((l, i) => `<tspan x="${PAD}" y="${(top + i * lineH).toFixed(1)}">${escapeHtml(l)}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#05070f"/>
<rect x="0" y="0" width="${W}" height="6" fill="#00e5ff"/>
<rect x="${PAD}" y="${H - 118}" width="72" height="3" fill="#00e5ff"/>
<text font-family="Georgia, 'Times New Roman', serif" font-size="${size}" fill="#e8ecf5">${body}</text>
<text x="${PAD}" y="${H - 78}" font-family="Georgia, 'Times New Roman', serif" font-size="30" fill="#00e5ff">${escapeHtml(reference)} <tspan fill="#7d8ba3" font-size="22">KJV</tspan></text>
<text x="${W - PAD}" y="${H - 78}" text-anchor="end" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="24" letter-spacing="4" fill="#7d8ba3">cyber<tspan fill="#00e5ff">judah</tspan></text>
</svg>`;
}
