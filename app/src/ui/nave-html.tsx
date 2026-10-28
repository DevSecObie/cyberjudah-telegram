import DOMPurify from "dompurify";
import { useMemo, type CSSProperties, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { data } from "@/api/data";
import { navePath } from "@/api/nave";
import { paletteOf, useBibleSettings, webFontFamily } from "@/bible/settings";
import { scaleFontSizeNumber, scaleLineHeight } from "@/bible/typography";
import { cssVars } from "@/bible/theme";
import { useAppTheme } from "./theme";
import { useReferencePreview, verseSpec } from "./refpreview";
import bookRows from "../../../bot/data/bs-books.json";
import "@/styles/screens/nave.css";

export function naveLink(href: string, books: { slug: string; chapters?: number }[]) {
  if (href.startsWith("w=") && href.length > 2) {
    const name = href.slice(2);
    return { kind: "nave" as const, name, path: navePath("en", name) };
  }
  const match = /^v=(\d+)-(\d+)(?:-([\d,]+))?$/.exec(href);
  if (!match) return null;
  const book = bookRows.find((b) => b.id === +match[1]);
  const entry = book && books.find((b) => b.slug === book.slug);
  const slug = entry?.slug;
  if (!slug || +match[2] < 1 || (entry.chapters !== undefined && +match[2] > entry.chapters)) return null;
  const verses = (match[3] ?? "").split(",").filter(Boolean).map(Number);
  if (verses.some((v) => !Number.isSafeInteger(v) || v < 1)) return null;
  return { kind: "bible" as const, slug, chapter: +match[2], verses: verseSpec(verses), path: `/read/${slug}/${+match[2]}${verses.length ? `?v=${verseSpec(verses)}` : ""}` };
}

export function cleanNaveHtml(html: string) {
  const blocked = ["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form", "svg", "math"];
  const clean = DOMPurify.sanitize(html, {
    ADD_TAGS: ["bold"],
    FORBID_TAGS: blocked,
    ADD_FORBID_CONTENTS: blocked,
    FORBID_ATTR: ["style", "id"],
  });
  const doc = new DOMParser().parseFromString(clean, "text/html");
  const nodes = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (nodes.nextNode()) nodes.currentNode.textContent = nodes.currentNode.textContent?.replace(/&(?:nbsp|#0*160|#x0*a0);/giu, "\u00a0") ?? "";
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const target = naveLink(anchor.getAttribute("href") ?? "", bookRows);
    if (target?.kind !== "bible") continue;
    const book = bookRows.find((row) => row.slug === target.slug)!;
    const reference = anchor.textContent?.match(/(?:^|\s)(\d+(?::[\d,\s–—-]+)?)\s*$/u)?.[1];
    const label = reference && Number.parseInt(reference, 10) === target.chapter ? reference : `${target.chapter}${target.verses ? `:${target.verses}` : ""}`;
    anchor.textContent = `${book.name} ${label}`;
  }
  return doc.body.innerHTML;
}

export function naveText(html: string) {
  const doc = new DOMParser().parseFromString(cleanNaveHtml(html), "text/html");
  return (doc.body.textContent ?? "").slice(0, 4000);
}

export function NaveHTML({ html, compact = false }: { html: string; compact?: boolean }) {
  const navigate = useNavigate();
  const preview = useReferencePreview();
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  const [settings] = useBibleSettings();
  const theme = useAppTheme();
  const clean = useMemo(() => cleanNaveHtml(html), [html]);
  const fontSize = compact ? 16 : scaleFontSizeNumber(19, settings.fontSizeScale);
  const lineHeight = compact ? "24px" : scaleLineHeight(32, settings.lineHeight, settings.fontSizeScale);
  const click = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest<HTMLAnchorElement>("a");
    if (!anchor) return;
    event.preventDefault();
    const target = naveLink(anchor.getAttribute("href") ?? "", books.data ?? []);
    if (!target) return;
    const open = () => navigate(target.path);
    if (target.kind === "nave") {
      if (!preview({ kind: "nave", name: target.name, open }, anchor)) open();
    } else if (!preview({ kind: "bible", slug: target.slug, chapter: target.chapter, verses: target.verses, open }, anchor)) open();
  };
  return <div className={`bs-nave-html${compact ? " bs-nave-html--compact" : ""}`} style={{ ...cssVars(paletteOf(theme.name, settings)), "--nave-font-size": `${fontSize}px`, "--nave-line-height": lineHeight, fontFamily: webFontFamily(settings.fontFamily) } as CSSProperties} onClick={click} dangerouslySetInnerHTML={{ __html: clean }} />;
}
