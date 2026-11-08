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

export const PRIVACY_TEXT = "## Privacy Policy\n\n*Last updated November 7, 2026*\n\nCyberJudah is a free Bible study app for iPhone, Android and the web. This page explains what it collects, why, who else handles it, how long it is kept, and how to delete it.\n\n### Without an account\nYou can read, search and study without an account. Your highlights, notes, bookmarks, studies, reading history and settings then stay on your device.\n\n### With an account\nIf you sign in with email, Google or Apple, we keep:\n- **Your email address, your name and an account ID**, to sign you in.\n- **What you create**: notes, highlights, bookmarks, tags, links and studies, with their earlier versions, so they stay in sync across your devices.\n\nThese are stored with Google Firebase (Authentication and Cloud Firestore). Each account can read only its own data.\n\n### How the app is used\nThe iPhone and Android apps use Google Firebase Analytics to count which screens and features are used, linked to your account ID when you are signed in. We use this only to improve the app. There is no advertising, and we do not track you across other companies' apps or websites.\n\n### Other services\n- **Cloudflare** hosts our server and the study library.\n- **YouTube** plays the videos. When you play one, YouTube receives your device's request, as it does on its own site.\n- **Apple App Attest and Google Play Integrity** confirm that requests come from the real app. They carry no personal information.\n\nWe do not sell your data, and we do not share it with anyone else.\n\n### How long it is kept\nAccount data is kept until you delete it or delete your account.\n\nTechnical logs, statistics, backups and data held by providers have retention periods specific to their services and purposes. Information needed for a legal obligation or dispute may need to be retained separately. Contact us for the retention period applicable to a category of data or to request its deletion.\n\n### Delete your data\nIn the app, go to **More → Delete account**. This deletes your sign-in and your synced data. You can also email privacy@cyberjudah.io. We answer within 30 days.\n\n### Children\nCyberJudah is not directed to children under 13.\n\n### Changes\nWhen this policy changes, we update this page and the date at the top.\n\n### Contact\nprivacy@cyberjudah.io";

export const TERMS_TEXT = "## Terms of Use\n\n*Last updated November 7, 2026*\n\n1. **Free study tool.** CyberJudah is free and non-commercial. Use it for personal Bible study.\n2. **Scripture.** The scripture is the King James Version with the Apocrypha, which is in the public domain.\n3. **Your content.** What you write stays yours.\n4. **No warranty.** The app is provided as it is. As far as the law allows, we are not liable for loss that comes from using it.\n5. **Changes.** We may change or stop features, and we may update these terms. The date at the top shows the latest version.\n6. **Ending.** You can stop using CyberJudah and delete your account at any time from More → Delete account.\n7. **App stores.** If you got the app from the App Store, Apple's standard license agreement also applies.\n\nContact: privacy@cyberjudah.io";

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
