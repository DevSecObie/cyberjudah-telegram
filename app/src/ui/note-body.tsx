import { marked } from "marked";
import { useMemo, type MouseEvent } from "react";

import { openLink } from "@/tg/sdk";
import { useGo } from "@/ui/ui";

marked.setOptions({ gfm: true, breaks: false });

/** The note's markdown as HTML, with the video mount dropped (the app has its own player). */
export function renderNote(md: string): string {
  const src = md.replace(/<!--\s*truncate\s*-->/g, "").replace(/[ \t]+taught in \[[^\]]+\]\(\/study\/[^)]+\)/g, "").replace(/<div class="class-video-mount"[^>]*><\/div>/g, "");
  const slug = (t: string) => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Headings carry an id from their text, so a search hit opens the class at its section.
  return (marked.parse(src) as string).replace(/<(li|p)>\s*<strong>([A-Z][^<:]{1,40}):<\/strong>\s*/g, '<$1><span class="who">$2</span>').replace(/<h([2-4])>(.*?)<\/h\1>/g, (_m, l: string, t: string) => `<h${l} id="${slug(t)}">${t}</h${l}>`);
}

/** The first words of a note, for a preview line. */
export function noteLede(md: string, max = 120): string {
  // The front matter line and the "Opens" list come first; the preview starts at the teaching.
  const body = /^##\s/m.test(md) ? md.slice(md.search(/^##\s/m)) : md;
  const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/^#.*$/gm, " ").replace(/[*_`>#[\]]/g, " ").replace(/\(\/[^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

/** The rendered note; its links open in the app when they are the site's, else outside. */
export function NoteBody({ md }: { md: string }) {
  const go = useGo();
  const html = useMemo(() => renderNote(md), [md]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a"); const href = a?.getAttribute("href") ?? "";
    if (!a) return;
    e.preventDefault();
    if (/^https?:/.test(href)) openLink(href); else if (href.startsWith("/")) go(href);
  };
  return <div className="note" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
