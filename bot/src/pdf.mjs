// A class note as a PDF, typeset like a printed study guide: a head with the collection,
// the date and the teacher; headings; paragraphs in a book face; quoted Scripture set off
// with a rule; lists; the class's timestamps as small grey marks; page numbers and the
// note's address at the foot. Pure JavaScript (pdf-lib, marked), so it runs in the Worker
// and in the tests alike.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { marked } from "marked";

const PAGE = [612, 792];
const M = { left: 68, right: 68, top: 70, bottom: 70 };
const WIDTH = PAGE[0] - M.left - M.right;
const INK = rgb(0.11, 0.11, 0.13), MUTED = rgb(0.43, 0.45, 0.5), ACCENT = rgb(0.0, 0.42, 0.6), RULE = rgb(0.82, 0.83, 0.86);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLLECTION = { class: "Sabbath class", captains: "15 Minutes with the Captains", history: "Our Hidden History", study: "Study note", encyclopedia: "Encyclopedia" };

/** 2025-12-28 as "December 28, 2025". */
export const longDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? ""); return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ""; };
const MOMENT = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/** The note's markdown with what only the site shows taken out. */
function prepare(md) {
  return String(md ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<div class="class-video-mount"[^>]*><\/div>/g, "")
    .replace(/<figure[\s\S]*?<\/figure>/g, "")
    .replace(/<section class="shown-all">[\s\S]*?<\/section>/g, "")
    .replace(/[ \t]+taught in \[[^\]]+\]\(\/study\/[^)]+\)/g, "");
}
const stripTags = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const unescape = (t) => String(t).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export async function notePdf(note, { site = "https://cyberjudah.io" } = {}) {
  const doc = await PDFDocument.create();
  const title = String(note.title ?? "Class notes");
  doc.setTitle(title); doc.setAuthor(note.teacher || "CyberJudah"); doc.setCreator("CyberJudah"); doc.setProducer("CyberJudah");
  doc.setSubject(`${COLLECTION[note.kind] ?? "Note"}${note.date ? `, ${longDate(note.date)}` : ""}`);
  const F = {
    serif: await doc.embedFont(StandardFonts.TimesRoman), serifB: await doc.embedFont(StandardFonts.TimesRomanBold),
    serifI: await doc.embedFont(StandardFonts.TimesRomanItalic), serifBI: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    sans: await doc.embedFont(StandardFonts.Helvetica), sansB: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  // The standard faces carry the Western set only; anything else is swapped or left out.
  const known = new Set(F.serif.getCharacterSet());
  const SWAP = { " ": " ", "‑": "-", "‐": "-", "−": "-", " ": " ", " ": " ", "​": "", "→": "->", "←": "<-", "✓": "", "×": "x" };
  const clean = (t) => [...String(t)].map((ch) => (known.has(ch.codePointAt(0)) ? ch : SWAP[ch] ?? "")).join("");

  let page, y;
  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - M.top; };
  newPage();
  const need = (h) => { if (y - h < M.bottom) newPage(); };

  /** Lays out runs of styled text inside a width, wrapping by words; draws them unless measuring. */
  const flow = (runs, { x = M.left, width = WIDTH, size = 11.5, leading = 1.5, align = "left" } = {}) => {
    const words = [];
    for (const r of runs) {
      const parts = clean(r.text).split(/(\s+)/);
      for (const p of parts) if (p) words.push({ ...r, text: p, space: /^\s+$/.test(p) });
    }
    const lines = []; let line = [], w = 0;
    const widthOf = (wd) => (wd.space ? wd.font.widthOfTextAtSize(" ", wd.size ?? size) : wd.font.widthOfTextAtSize(wd.text, wd.size ?? size));
    for (const wd of words) {
      const ww = widthOf(wd);
      if (!wd.space && w + ww > width && line.length) { lines.push(line); line = []; w = 0; }
      if (wd.space && !line.length) continue;
      line.push({ ...wd, w: ww }); w += ww;
    }
    if (line.length) lines.push(line);
    const lh = size * leading;
    for (const ln of lines) {
      while (ln.length && ln[ln.length - 1].space) ln.pop();
      need(lh);
      let cx = x;
      if (align === "center") cx = x + (width - ln.reduce((a, b) => a + b.w, 0)) / 2;
      const base = y - size;
      for (const wd of ln) { if (!wd.space) page.drawText(wd.text, { x: cx, y: base, size: wd.size ?? size, font: wd.font, color: wd.color ?? INK }); cx += wd.w; }
      y -= lh;
    }
  };

  /** Inline markdown as runs: bold, italic, links (as their words), the class's times in grey. */
  const runsOf = (tokens, st = {}) => {
    const out = [];
    const face = (s) => (s.sans ? (s.bold ? F.sansB : F.sans) : s.bold && s.italic ? F.serifBI : s.bold ? F.serifB : s.italic ? F.serifI : F.serif);
    for (const t of tokens ?? []) {
      if (t.type === "strong") out.push(...runsOf(t.tokens, { ...st, bold: true }));
      else if (t.type === "em") {
        // A moment of the class, "*[[19:13](…)]*", is a small grey time, not italics.
        const inner = (t.tokens ?? []).map((x) => x.text ?? x.raw ?? "").join("");
        const time = /\[?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]?/.exec(inner);
        if (time && MOMENT.test(time[1]) && inner.replace(/[\[\]\s]/g, "").length <= 8) out.push({ text: `${time[1]}  `, font: F.sans, size: 8.5, color: MUTED });
        else out.push(...runsOf(t.tokens, { ...st, italic: true }));
      }
      else if (t.type === "link") {
        if (MOMENT.test(String(t.text).trim())) out.push({ text: `${String(t.text).trim()}  `, font: F.sans, size: 8.5, color: MUTED });
        else out.push(...runsOf(t.tokens, st));
      }
      else if (t.type === "codespan") out.push({ text: unescape(t.text), font: F.sans, size: st.size, color: st.color });
      else if (t.type === "br") out.push({ text: " ", font: face(st) });
      else if (t.type === "html") { const s = stripTags(t.raw); if (s) out.push({ text: s, font: face(st), color: st.color }); }
      else if (t.tokens?.length) out.push(...runsOf(t.tokens, st));
      else if (t.text !== undefined || t.raw !== undefined) out.push({ text: unescape(t.text ?? t.raw).replace(/^\[|\]$/g, (m) => (st.inMoment ? "" : m)), font: face(st), color: st.color, size: st.size });
    }
    return out;
  };

  // The head: the library's name, the title, then the collection, date and teacher.
  flow([{ text: "CYBERJUDAH", font: F.sansB, size: 8.5, color: ACCENT }], { size: 8.5, leading: 1.6 });
  y -= 6;
  flow([{ text: title, font: F.serifB, size: 24 }], { size: 24, leading: 1.18 });
  y -= 6;
  const meta = [COLLECTION[note.kind] ?? "", longDate(note.date), note.teacher].filter(Boolean).join("  ·  ");
  if (meta) flow([{ text: meta, font: F.sans, size: 10, color: MUTED }], { size: 10 });
  y -= 10; need(14);
  page.drawLine({ start: { x: M.left, y }, end: { x: PAGE[0] - M.right, y }, thickness: 0.75, color: RULE });
  y -= 18;

  const block = (tokens, indent = 0) => {
    for (const t of tokens) {
      const x = M.left + indent, width = WIDTH - indent;
      if (t.type === "heading") {
        const size = t.depth <= 2 ? 15.5 : 12.5;
        y -= t.depth <= 2 ? 12 : 8; need(size * 3);
        flow(runsOf(t.tokens, { sans: true, bold: true }).map((r) => ({ ...r, size })), { x, width, size, leading: 1.3 });
        y -= 4;
      } else if (t.type === "paragraph" && /^\s*<span class="opens">/.test(t.raw)) {
        block([{ type: "html", raw: t.raw }], indent);
      } else if (t.type === "paragraph") {
        flow(runsOf(t.tokens), { x, width }); y -= 7;
      } else if (t.type === "blockquote") {
        const top = y;
        const startPage = page;
        block(t.tokens, indent + 16);
        if (page === startPage) page.drawLine({ start: { x: x + 3, y: top - 2 }, end: { x: x + 3, y: y + 6 }, thickness: 2, color: ACCENT });
        y -= 2;
      } else if (t.type === "list") {
        t.items.forEach((item, i) => {
          const mark = t.ordered ? `${(Number(t.start) || 1) + i}.` : "•";
          need(17);
          page.drawText(mark, { x: x + 2, y: y - 11.5, size: 11.5, font: F.serif, color: MUTED });
          const inner = item.tokens.map((k) => (k.type === "text" && k.tokens ? { ...k, type: "paragraph" } : k));
          const before = y; block(inner, indent + 20); if (y === before) y -= 17;
          y += 4;
        });
        y -= 4;
      } else if (t.type === "hr") {
        y -= 6; need(12); page.drawLine({ start: { x, y }, end: { x: PAGE[0] - M.right, y }, thickness: 0.5, color: RULE }); y -= 12;
      } else if (t.type === "html") {
        const raw = t.raw;
        if (/class="taught"/.test(raw)) continue; // the head already says when and what
        if (/class="opens"/.test(raw)) {
          const refs = [...raw.matchAll(/\[([^\]]+)\]\([^)]*\)|<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1] ?? m[2]);
          const more = /<i>([^<]+)<\/i>/.exec(raw)?.[1];
          if (refs.length) { flow([{ text: "Scriptures opened  ", font: F.sansB, size: 9.5, color: MUTED }, { text: refs.join(" · ") + (more ? ` · ${more}` : ""), font: F.sans, size: 9.5, color: MUTED }], { x, width, size: 9.5, leading: 1.55 }); y -= 10; }
          continue;
        }
        const text = stripTags(raw);
        if (text) { flow([{ text, font: F.serif }], { x, width }); y -= 7; }
      } else if (t.type === "code") {
        flow([{ text: t.text, font: F.sans, size: 10 }], { x, width, size: 10 }); y -= 7;
      } else if (t.tokens?.length) {
        flow(runsOf(t.tokens), { x, width }); y -= 7;
      }
    }
  };
  block(marked.lexer(prepare(note.body), { gfm: true }));

  // The foot of every page: where the note lives, and the page.
  const pages = doc.getPages();
  const where = clean(`${site.replace(/^https?:\/\//, "")}${note.url ?? ""}`);
  pages.forEach((p, i) => {
    p.drawText(where.length > 90 ? `${where.slice(0, 88)}…` : where, { x: M.left, y: 38, size: 8, font: F.sans, color: MUTED });
    const label = `${i + 1} of ${pages.length}`;
    p.drawText(label, { x: PAGE[0] - M.right - F.sans.widthOfTextAtSize(label, 8), y: 38, size: 8, font: F.sans, color: MUTED });
  });
  return doc.save();
}

/** A file name from the title: letters, digits and dashes, with the date. */
export const pdfName = (note) => `${(note.date ?? "").slice(0, 10)}-${String(note.title ?? "note").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}.pdf`.replace(/^-/, "");
