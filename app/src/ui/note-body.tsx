import { marked } from "marked";
import DOMPurify from "dompurify";
import { useMemo, type MouseEvent } from "react";

import { openLink } from "@/tg/sdk";
import { useGo } from "@/ui/ui";
import { frameStyleText, useBoard, useVisuals, type Board, type Visual } from "@/lib/frames";

marked.setOptions({ gfm: true, breaks: false });

/** The moments a note marks: `*[[9:57](https://www.youtube.com/watch?v=ID&t=597s)]*` beside a scripture, a news clip, the closing. */
const MOMENT = /<em>\[<a href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})(?:&amp;|&)t=(\d+)s">([^<]+)<\/a>\]<\/em>/g;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const clock = (t: number) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };

/**
 * The note's markdown as HTML, with the video mount dropped (the app has its own player).
 * With the recording's frames and the moments the teacher pointed at the screen, the note
 * shows what was on the screen where it happened: each picture goes after the scripture
 * (or news clip) the class was on at that time, with the words that called for it, a tap
 * from playing there. The timestamps themselves play the recording from that moment.
 */
export function renderNote(md: string, frames?: { video: string; board: Board | undefined; visuals?: Visual[] }): string {
  const src = md.replace(/<!--\s*truncate\s*-->/g, "").replace(/[ \t]+taught in \[[^\]]+\]\(\/study\/[^)]+\)/g, "").replace(/<div class="class-video-mount"[^>]*><\/div>/g, "");
  const slug = (t: string) => DOMPurify.sanitize(t, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).toLowerCase().replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Headings carry an id from their text, so a search hit opens the class at its section.
  let html = (marked.parse(src) as string).replace(/<(li|p)>\s*<strong>([A-Z][^<:]{1,40}):<\/strong>\s*/g, '<$1><span class="who">$2</span>').replace(/<h([2-4])>(.*?)<\/h\1>/g, (_m, l: string, t: string) => `<h${l} id="${slug(t)}">${t}</h${l}>`);
  // Each scripture a note opens carries an id from its reference ("p-genesis-1-6-8"), so a verse's
  // comment opens the note right where that passage is broken down.
  html = html.replace(/<p><strong><a href="\/bible\/[^"]+">([^<]+)<\/a><\/strong>/g, (m, label: string) => m.replace("<p>", `<p id="p-${slug(label)}">`));
  // A moment is a time chip, without the brackets the markdown wraps it in.
  html = html.replace(MOMENT, (_m, video: string, t: string, label: string) => `<a class="moment__at" href="https://www.youtube.com/watch?v=${video}&t=${t}s" data-t="${t}">${label}</a>`);
  html = tidyHead(html);
  if (!frames?.visuals?.length) return sanitizeNote(html);
  // Newer library builds place the figure at the editorially chosen position, but leave
  // its picture for the app to supply from the private storyboard bucket. Hydrate those
  // placeholders instead of adding a second copy of the same moment.
  if (/class="[^"]*\bshown\b/.test(html)) {
    html = html.replace(/(<figure\b([^>]*)>)([\s\S]*?<\/figure>)/g, (whole, open: string, attrs: string, rest: string) => {
      if (!/class="[^"]*\bshown\b/.test(attrs)) return whole;
      if (/class="[^"]*\bshown__frame\b|<img\b/.test(rest)) return whole;
      const said = /data-t="(\d+)"/.exec(attrs)?.[1];
      if (!said) return whole;
      const visual = frames.visuals!.find((v) => v.said === Number(said));
      const style = visual && frameStyleText(frames.video, frames.board, visual.t, 320);
      return style ? `${open}<span class="frame shown__frame" style="${style}"></span>${rest}` : whole;
    });
    return sanitizeNote(html);
  }
  // The blocks in reading order, each with the moment it starts; a picture lands at the end of the block it was shown in.
  const marks = [...html.matchAll(/<p><strong>.*?<a class="moment__at"[^>]*data-t="(\d+)"/g)].map((m) => ({ t: Number(m[1]), at: m.index! }));
  const figure = (v: Visual) => {
    const style = frameStyleText(frames.video, frames.board, v.t, 320);
    if (!style) return "";
    return `<figure class="shown" data-t="${v.said}" title="${esc(v.text)}"><span class="frame shown__frame" style="${style}"></span><figcaption><span class="shown__at">${clock(v.said)}</span></figcaption></figure>`;
  };
  const inserts = new Map<number, string>(); const orphans: string[] = [];
  for (const v of [...frames.visuals].sort((a, b) => a.t - b.t)) {
    const i = marks.findIndex((m, k) => m.t <= v.said && (k === marks.length - 1 || marks[k + 1].t > v.said));
    const fig = figure(v); if (!fig) continue;
    if (i < 0) { orphans.push(fig); continue; }
    const pos = i + 1 < marks.length ? marks[i + 1].at : html.length;
    inserts.set(pos, (inserts.get(pos) ?? "") + fig);
  }
  const out: string[] = []; let last = 0;
  for (const pos of [...inserts.keys()].sort((a, b) => a - b)) { out.push(html.slice(last, pos), inserts.get(pos)!); last = pos; }
  out.push(html.slice(last));
  return sanitizeNote(out.join("") + (orphans.length ? `<section class="shown-all"><h2>Shown in class</h2>${orphans.join("")}</section>` : ""));
}

/**
 * Notes are repository content, but they are still untrusted at the browser boundary: an
 * accidental or compromised edit must not become script, an event handler or a javascript:
 * link when React mounts it. DOMPurify keeps the semantic markup and the frame styles while
 * removing executable HTML. Links opened by the app are limited again in onClick below.
 */
export function sanitizeNote(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOW_DATA_ATTR: true,
    ADD_ATTR: ["class", "id", "style", "title", "target", "rel"],
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2025-12-28 as "Dec 28, 2025". */
export const prettyDate = (iso: string) => iso.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y: string, mo: string, d: string) => (+mo >= 1 && +mo <= 12 ? `${MONTHS[+mo - 1]} ${+d}, ${y}` : m));

/**
 * The note's head as an app shows it: the collection and a readable date in the interface
 * face, and the chapters the class opened as a row of chips instead of a dotted run of text.
 */
function tidyHead(html: string): string {
  return html
    .replace(/<p class="taught">([^<]*)<\/p>/, (_m, t: string) => `<p class="note-meta">${prettyDate(t)}</p>`)
    .replace(/<p>\s*<span class="opens">([\s\S]*?)<\/span>\s*<\/p>/, (_m, inner: string) => {
      const refs = [...inner.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => `<a class="note-opens__ref" href="${m[1]}">${m[2]}</a>`).join("");
      const more = /<i>([^<]+)<\/i>/.exec(inner)?.[1];
      return `<div class="note-opens"><span class="note-opens__label">Scriptures opened</span><div class="note-opens__refs">${refs}${more ? `<span class="note-opens__more">${more}</span>` : ""}</div></div>`;
    });
}

/** The first words of a note, for a preview line. */
export function noteLede(md: string, max = 120): string {
  // The front matter line and the "Opens" list come first; the preview starts at the teaching.
  const body = /^##\s/m.test(md) ? md.slice(md.search(/^##\s/m)) : md;
  const plain = body
    .replace(/\*?\[\[(\d{1,2}:\d{2}(?::\d{2})?)\]\([^)]*\)\]\*?/g, " ")  // the "[[1:04:41](youtube…)]" moment markers
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")                              // links keep their words
    .replace(/https?:\/\/\S+/g, " ");
  const withoutHtml = DOMPurify.sanitize(plain, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const text = withoutHtml.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/^#.*$/gm, " ").replace(/[*_`>#[\]]/g, " ").replace(/\(\/[^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}
/** The first moment the note marks in the recording, in seconds, so a preview can offer it apart from the words. */
export function noteFirstMoment(md: string): { t: number; ts: string } | null {
  const body = /^##\s/m.test(md) ? md.slice(md.search(/^##\s/m)) : md;
  const m = /\[\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\(https?:\/\/[^)]*[?&]t=(\d+)s?\)\]/.exec(body);
  if (!m) return null;
  return { t: Number(m[4]), ts: m[3] ? `${m[1]}:${m[2]}:${m[3]}` : `${m[1]}:${m[2]}` };
}

/** The rendered note; its links open in the app when they are the site's, else outside. */
export function NoteBody({ md, video, onSeek }: { md: string; video?: string | null; onSeek?: (t: number) => void }) {
  const go = useGo();
  const board = useBoard(video);
  const visuals = useVisuals(video);
  const html = useMemo(() => renderNote(md, video ? { video, board: board.data, visuals: visuals.data } : undefined), [md, video, board.data, visuals.data]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    // A moment (its frame or its time) plays the recording from there when a player is on the screen.
    const at = el.closest<HTMLElement>("[data-t]");
    if (at && onSeek) { e.preventDefault(); onSeek(Number(at.dataset.t)); return; }
    const a = el.closest("a"); const href = a?.getAttribute("href") ?? "";
    if (!a) return;
    e.preventDefault();
    if (/^https?:/.test(href)) openLink(href); else if (href.startsWith("/")) go(href);
  };
  return <div className="note" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
