import { escapeHtml } from "./data";

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

export const PRIVACY_TEXT = "## Privacy Policy\n\n*Last updated November 7, 2026*\n\nThis policy describes processing associated with the CyberJudah website, mobile application and web application. CyberJudah is the data controller. The data used depends on the features you use and whether you sign in to an account.\n\nThe CyberJudah Telegram bot and Mini App (cyberjudah.io/app) have their own privacy policy at cyberjudah.io/app/privacy. In this policy, the web application is the one at web.cyberjudah.io.\n\n### Account and study data\nAn account lets you access your synchronized data. Depending on your sign-in method, we process your account identifier, email address, verification status, display name, profile picture and sign-in provider. Google Firebase handles authentication.\n\nNotes, highlights, annotations, bookmarks, tags, links, studies and workspace settings associated with your account may be stored and synchronized. Data created without an account stays in local storage; it may be associated with a new account when you create one. Downloaded Bible resources are also stored on your device.\n\n### Published studies and sharing\nWhen you publish a study, its content and associated author information become accessible on a public page. Anyone with the link can view and share them. Avoid including private information about yourself or others.\n\nUnpublishing removes public access to the study within CyberJudah. It does not remove copies or exports already saved by others. Deleting your account also triggers deletion of its private and published studies and their previews hosted by CyberJudah.\n\n### Searches\nOnline search sends your query to the search service to find resources. Semantic search may send the query to Cloudflare Workers AI to compute a numerical text representation.\n\n### Usage measurement and diagnostics\nThe application uses Google Analytics for Firebase to measure events such as sign-in, registration, note creation, reading progress and screen views. These events may be associated with your account identifier. Note-creation events measure a count, not note text.\n\nThere is no advertising, and we do not track you across other companies' apps or websites.\n\nSentry-compatible error reporting at errors.cyberjudah.io receives error reports and technical information about the application. Reports may be associated with your identifier. Hosting and security services also process information needed for connections, such as IP addresses, browsers, request times and requests.\n\nError reports keep only your account identifier: no email address, name or IP address, and no screenshots.\n\n### External services\nOpening links, videos or content hosted by third parties may send connection information to them. Their privacy rules apply to their own services.\n\n**YouTube** plays the videos. When you play one, YouTube receives your device's request, as it does on its own site. Class thumbnails also load from YouTube when a list of classes is shown.\n\n### Why the data is used\nAccount management, synchronization and handling your requests provide the features you ask for. Security, abuse prevention and incident resolution keep the service operational. Statistics help us understand usage.\n\nPerformance of the requested service, legal obligations, legitimate interests in securing the service and consent where required are distinct grounds for processing. Accepting the terms of use or reading this policy does not constitute consent to non-essential trackers.\n\nNotes, studies or messages may reveal religious beliefs or other sensitive information. Share only what is necessary. Processing sensitive data requires an additional condition under applicable law; creating an account alone does not constitute explicit consent to every use of that data.\n\n### Who may receive data\nCyberJudah and the providers needed for the features you use may receive the corresponding data: Google Firebase for accounts, synchronization, usage measurement and abuse protection; Sentry-compatible error reporting at errors.cyberjudah.io for errors; Cloudflare for hosting the public website, resource delivery and search services.\n\nIn the web application, Firebase App Check uses reCAPTCHA Enterprise to protect resource access against abuse. Some providers may process data outside the European Economic Area. You can ask us about recipients, processing locations and safeguards applicable to your use.\n\n- [Firebase privacy and security](https://firebase.google.com/support/privacy)\n- [Google privacy policy](https://policies.google.com/privacy)\n- [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/)\n\n### Local storage, cookies and retention\nDevice or browser storage maintains your session, preferences, working data and downloaded resources. You can clear site data in your browser or application data on your device. This may delete unsynchronized data and does not delete your remote account.\n\nAccount data is retained to support account use and synchronization until deletion. Private and published studies are also deleted when the account is deleted.\n\nTechnical logs, statistics, backups and data held by providers have retention periods specific to their services and purposes. Information needed for a legal obligation or dispute may need to be retained separately. Contact us for the retention period applicable to a category of data or to request its deletion.\n\n### Delete your data\nIn the app, go to **More → Delete account**. This deletes your sign-in, your synced data and your published studies. You can also email privacy@cyberjudah.io.\n\n### Your rights and requests\nYou can request access, correction or erasure of your data and, where the conditions are met, portability, restriction of processing or object to processing. Where processing relies on consent, you can withdraw it for the future.\n\nWrite to privacy@cyberjudah.io, preferably from your account email address, explaining your request. A proportionate identity check may be needed. Do not send your password. We normally respond within one month; the GDPR permits a justified extension of two further months in certain cases, with notice during the first month.\n\nYou may also complain to your competent data protection authority.\n\n### Children\nCyberJudah is not directed to children under 13.\n\n### Policy updates\nThis page shows the text revision date. Changes to features or processing may require updates. Updating this policy does not replace obtaining consent where required.";

export const TERMS_TEXT = "## Terms of Use\n\n*Last updated November 10, 2026*\n\n1. **Free study tool.** CyberJudah is free and non-commercial. Use it for personal Bible study.\n2. **Scripture.** The scripture is the King James Version with the Apocrypha, which is in the public domain.\n3. **Your notes and shared studies.** You retain your rights in content you create. You authorize CyberJudah to store and process it as needed for the features you request, including synchronization. If you publish a study, this authorization includes displaying and sharing it on a public page.\n\n   Only publish content you are authorized to share. Respect copyright and privacy; do not publish unlawful content. You can unpublish a study. Copies already downloaded or made by third parties are outside our control.\n\n   To report content, email our contact address with its link and the reasons for your report. Content that breaches the law or these terms may have its access restricted.\n4. **No warranty.** The app is provided as it is. As far as the law allows, we are not liable for loss that comes from using it.\n5. **Changes.** We may change or stop features, and we may update these terms. The date at the top shows the latest version.\n6. **Ending.** You can stop using CyberJudah and delete your account at any time from More → Delete account.\n7. **App stores.** If you got the app from the App Store, Apple's standard license agreement also applies.\n\nContact: privacy@cyberjudah.io";

// Markdown emphasis to tags, the site's own email addresses as mailto links, and [text](https://…)
// as links (https only; one level of parentheses allowed in the URL). The words stay as written.
// Links are set aside first, so emphasis and mailto never reach inside a link's URL or words.
const LINK = /\[([^\]]+)\]\((https:\/\/(?:[^\s()]|\([^\s()]*\))+)\)/g;
const emphasis = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(\S(?:.*?\S)?)\*/g, "<em>$1</em>");
const inline = (s: string) => {
  const links: string[] = [];
  const text = escapeHtml(s).replace(LINK, (_m, words: string, url: string) => `\u0000${links.push(`<a href="${url}">${emphasis(words)}</a>`) - 1}\u0000`);
  return emphasis(text).replace(/\b([A-Za-z0-9._%+-]+@cyberjudah\.io)\b/g, '<a href="mailto:$1">$1</a>').replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)]);
};
const HEADING = /^(#{1,6}) (.*)$/;

/** The pasted text as HTML, line by line: a heading line or a list item starts its own block even
 *  without a blank line before it; other lines join into paragraphs. An indented paragraph right
 *  after a list item (blank line between) belongs to that item. Every character escaped. */
export function legalHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd());
  const levels = lines.flatMap((l) => HEADING.test(l) ? [HEADING.exec(l)![1].length] : []);
  const base = levels.length ? Math.min(...levels) : 1;
  const out: string[] = [];
  let para: string[] = [], list: { tag: "ul" | "ol"; start: number; items: string[][] } | null = null;
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    if (list) out.push(`<${list.tag}${list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : ""}>${list.items.map(([first, ...more]) => `<li>${inline(first)}${more.map((m) => `<p>${m.split("\n").map(inline).join("<br>")}</p>`).join("")}</li>`).join("")}</${list.tag}>`);
    para = []; list = null;
  };
  const indented = (l: string | undefined) => !!l && /^ {2,}\S/.test(l);
  for (const [i, line] of lines.entries()) {
    const heading = HEADING.exec(line), bullet = /^- (.*)$/.exec(line), numbered = /^(\d+)\. (.*)$/.exec(line);
    if (!line.trim()) {
      // Keep the list open over a blank line when the next text is an indented paragraph of its last item.
      if (list && !para.length && indented(lines.slice(i + 1).find((l) => l.trim()))) continue;
      flush();
    }
    else if (list && !para.length && indented(line) && i > 0 && (!lines[i - 1].trim() || (indented(lines[i - 1]) && list.items[list.items.length - 1].length > 1))) {
      // A new paragraph of the item after a blank line; a wrapped line of that paragraph otherwise.
      const item = list.items[list.items.length - 1];
      if (!lines[i - 1].trim()) item.push(line.trim()); else item[item.length - 1] += `\n${line.trim()}`;
    }
    else if (heading) { flush(); const level = Math.min(3, heading[1].length - base + 1); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (bullet || numbered) {
      const tag = bullet ? "ul" : "ol";
      if (para.length || (list && list.tag !== tag)) flush();
      if (!list) list = { tag, start: numbered ? Number(numbered[1]) : 1, items: [] };
      list.items.push([bullet ? bullet[1] : numbered![2]]);
    } else { if (list) flush(); para.push(line); }
  }
  flush();
  return out.join("\n");
}

const PAGES = {
  privacy: { title: "Privacy Policy", text: PRIVACY_TEXT, other: { href: "/terms", label: "Terms of Use" } },
  terms: { title: "Terms of Use", text: TERMS_TEXT, other: { href: "/privacy", label: "Privacy Policy" } },
} as const;

/** The full page for /privacy or /terms. */
function buildPage(which: keyof typeof PAGES): string {
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
${legalHtml(page.text)}
</main>
<nav><a href="${page.other.href}">${page.other.label}</a></nav>
</body>
</html>
`;
}

/** Both pages, built once when the Worker starts: the text never changes between deploys. */
const BUILT = { privacy: buildPage("privacy"), terms: buildPage("terms") };
export const legalPage = (which: keyof typeof PAGES): string => BUILT[which];

/** Only on the site itself: on workers.dev and staging these paths stay the Mini App's own screens. */
export const LEGAL_HOST = "cyberjudah.io";

/** Headers for both pages: HTML, cached at the edge for an hour, never framed or sniffed. */
export const LEGAL_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=3600",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
} as const;
