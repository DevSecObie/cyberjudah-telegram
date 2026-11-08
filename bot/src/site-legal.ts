/**
 * cyberjudah.io/privacy and cyberjudah.io/terms: the privacy policy and terms of use that the
 * CyberJudah app's store listing links to. Plain static HTML, readable without JavaScript.
 * The text is pasted verbatim from the approved legal text (Data Security, t1x); nothing here is
 * written or reworded. The Mini App's own /app/privacy and /app/terms are separate and unchanged.
 *
 * Text format, exactly as pasted from the approved file: markdown headings ("## ", "### ";
 * the highest level present becomes the page title), "- " bullet items, "1. " numbered items,
 * **bold** and *italic*, blank lines between blocks. Everything is HTML-escaped first.
 */

/** Marks text not yet supplied. A test fails while either page still holds it. */
export const LEGAL_TEXT_PENDING = "LEGAL TEXT PENDING";

export const PRIVACY_TEXT = `## Privacy Policy

${LEGAL_TEXT_PENDING}`;

export const TERMS_TEXT = `## Terms of Use

${LEGAL_TEXT_PENDING}`;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inline = (s: string) => escape(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(\S(?:.*?\S)?)\*/g, "<em>$1</em>");
const HEADING = /^(#{1,6}) (.*)$/;

/** The pasted text as HTML, line by line: a heading line or a list item starts its own block even
 *  without a blank line before it; other lines join into paragraphs. Every character escaped. */
export function legalHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  const levels = lines.flatMap((l) => HEADING.test(l) ? [HEADING.exec(l)![1].length] : []);
  const base = levels.length ? Math.min(...levels) : 1;
  const out: string[] = [];
  let para: string[] = [], list: { tag: "ul" | "ol"; start: number; items: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}${list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : ""}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    para = []; list = null;
  };
  for (const line of lines) {
    const heading = HEADING.exec(line), bullet = /^- (.*)$/.exec(line), numbered = /^(\d+)\. (.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (heading) { flush(); const level = Math.min(3, heading[1].length - base + 1); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (para.length || (list && list.tag !== tag)) flush();
      if (!list) list = { tag, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push(bullet ? bullet[1] : numbered![2]);
    } else { if (list) flush(); para.push(line); }
  }
  flush();
  return out.join("\n");
}

const PAGES = {
  privacy: { title: "Privacy Policy", text: () => PRIVACY_TEXT, other: { href: "/terms", label: "Terms of Use" } },
  terms: { title: "Terms of Use", text: () => TERMS_TEXT, other: { href: "/privacy", label: "Privacy Policy" } },
} as const;

/** The full page for /privacy or /terms. */
export function legalPage(which: keyof typeof PAGES): string {
  const page = PAGES[which];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CyberJudah: ${page.title}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,sans-serif;max-width:46rem;margin:0 auto;padding:1.5rem 1rem;color:#1a1a1a;background:#fff}@media (prefers-color-scheme:dark){body{color:#e8e8e8;background:#111}a{color:#8ab4f8}}h1{font-size:1.6rem}h2{font-size:1.2rem;margin-top:1.6rem}nav{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #8884}</style>
</head>
<body>
<main>
${legalHtml(page.text())}
</main>
<nav><a href="${page.other.href}">${page.other.label}</a></nav>
</body>
</html>
`;
}

/** Headers for both pages: HTML, cached at the edge for an hour, never framed or sniffed. */
export const LEGAL_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=3600",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
} as const;
