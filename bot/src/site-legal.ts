/**
 * cyberjudah.io/privacy and cyberjudah.io/terms: the privacy policy and terms of use that the
 * CyberJudah app's store listing links to. Plain static HTML, readable without JavaScript.
 * The text is pasted verbatim from the approved legal text (Data Security, t1x); nothing here is
 * written or reworded. The Mini App's own /app/privacy and /app/terms are separate and unchanged.
 *
 * Text format, as pasted: lines starting "# " or "## " are headings, lines starting "- " are list
 * items, blank lines separate paragraphs. Everything is HTML-escaped.
 */

/** Marks text not yet supplied. A test fails while either page still holds it. */
export const LEGAL_TEXT_PENDING = "LEGAL TEXT PENDING";

export const PRIVACY_TEXT = `# Privacy Policy

${LEGAL_TEXT_PENDING}`;

export const TERMS_TEXT = `# Terms of Use

${LEGAL_TEXT_PENDING}`;

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The pasted text as HTML blocks: headings, lists and paragraphs, every character escaped. */
export function legalHtml(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.length === 1 && /^#{1,2} /.test(lines[0])) {
      const level = lines[0].startsWith("## ") ? 2 : 1;
      out.push(`<h${level}>${escape(lines[0].replace(/^#{1,2} /, ""))}</h${level}>`);
    } else if (lines.every((l) => l.startsWith("- "))) {
      out.push(`<ul>${lines.map((l) => `<li>${escape(l.slice(2))}</li>`).join("")}</ul>`);
    } else {
      out.push(`<p>${lines.map(escape).join("<br>")}</p>`);
    }
  }
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
