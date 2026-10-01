import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "react-router";

import { data } from "@/api/data";
import { haptic } from "@/tg/sdk";

/** Other names the writing uses for books of the 1611 Bible, as our book list names them. */
const ALIASES: Record<string, string> = {
  "Psalm": "Psalms", "Ecclesiasticus": "Sirach", "Wisdom": "Wisdom of Solomon", "Rest of Esther": "Esther (Greek)",
  "Song of the Three Holy Children": "Song of the Three Children", "Prayer of Manasses": "Prayer of Manasseh", "Epistle of Jeremy": "Epistle of Jeremiah",
};

/** Book name -> slug, with the aliases. */
export function useBookSlugs() {
  const books = useQuery({ queryKey: ["books"], queryFn: data.books, staleTime: Infinity });
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const b of books.data ?? []) m.set(b.book, b.slug);
    for (const [alias, name] of Object.entries(ALIASES)) { const s = m.get(name); if (s) m.set(alias, s); }
    return m;
  }, [books.data]);
}

const SEGMENT = /^(\s*)((?:[1-4] )?[A-Z][A-Za-z ]*?)?\s*(\d+):(\d+(?:\s*[-–]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–]\s*\d+)?)*)(\s*)$/;

/**
 * Writing with its scripture references in brackets, "(Genesis 12:1; Isaiah 51:2)", each reference
 * a link that opens the passage in the reader with its verses picked out. A reference that leaves
 * out the book ("Genesis 17:4-6; 35:10") is in the book before it.
 */
export function RefText({ text }: { text: string }) {
  const slugs = useBookSlugs();
  const out: ReactNode[] = [];
  let last = 0, key = 0;
  for (const m of text.matchAll(/\(([^()]*\d+:\d+[^()]*)\)/g)) {
    out.push(text.slice(last, m.index));
    let book = "";
    // "Acts 10:28; Acts 11:2-3" and "Acts 10:28, Acts 11:2-3" alike; "1-4, 7" stays one reference.
    const segs = m[1].split(";").flatMap((seg, i) => seg.split(/,(?=\s*(?:[1-4] )?[A-Z])/).map((x, j) => ({ x, sep: j ? "," : i ? ";" : "" })));
    const parts = segs.map(({ x: seg, sep }, i) => {
      const s = SEGMENT.exec(seg);
      const name = s?.[2]?.trim();
      if (s && name) book = name;
      const slug = s && (name || book) ? slugs.get(name || book) : undefined;
      if (!s || !slug) return <Fragment key={i}>{sep}{seg}</Fragment>;
      const spec = s[4].replace(/\s+/g, "").replace(/–/g, "-");
      // The 1611's Baruch 6 is the Epistle of Jeremiah, a book of its own here.
      const [toSlug, toChapter] = slug === "baruch" && s[3] === "6" ? ["epistle-of-jeremiah", "1"] : [slug, s[3]];
      return <Fragment key={i}>{sep}{s[1]}<Link className="reflink" to={`/read/${toSlug}/${toChapter}?v=${spec}`} onClick={() => haptic("select")}>{`${name ? `${name} ` : ""}${s[3]}:${s[4].trim()}`}</Link>{s[5]}</Fragment>;
    });
    out.push(<span key={key++} className="reftext__refs">({parts})</span>);
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * HTML (an answer) with each scripture reference in its text, "Genesis 12:1", "Romans 4:1-3",
 * made a link to the verse in the reader. Text inside links, buttons and code is left alone.
 */
export function linkRefsInHtml(html: string, slugs: Map<string, string>): string {
  if (!slugs.size || typeof DOMParser === "undefined") return html;
  const names = [...slugs.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`\\b(${names.join("|")})\\s+(\\d+):(\\d+(?:\\s*[-–]\\s*\\d+)?(?:,\\s*\\d+(?:\\s*[-–]\\s*\\d+)?)*)`, "g");
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild!;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement?.closest("a, button, code, pre"))) texts.push(n as Text);
  for (const node of texts) {
    const s = node.data; re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = doc.createDocumentFragment(); let last = 0;
    for (const m of s.matchAll(re)) {
      const slug = slugs.get(m[1]); if (!slug) continue;
      frag.append(s.slice(last, m.index));
      const [toSlug, toChapter] = slug === "baruch" && m[2] === "6" ? ["epistle-of-jeremiah", "1"] : [slug, m[2]];
      const a = doc.createElement("a");
      a.className = "reflink"; a.textContent = m[0];
      a.setAttribute("href", `/read/${toSlug}/${toChapter}?v=${m[3].replace(/\s+/g, "").replace(/–/g, "-")}`);
      frag.append(a); last = (m.index ?? 0) + m[0].length;
    }
    frag.append(s.slice(last));
    node.replaceWith(frag);
  }
  return root.innerHTML;
}
