/**
 * Links in an answer: only a path inside the app (as Ask's tools give, like /settings/reminders)
 * stays a link, opened in place; any other address (javascript:, another site) is shown as plain
 * text, so nothing the model writes can run script or send the reader elsewhere.
 */
const APP_PATH = /^\/(?![\/\\])[A-Za-z0-9\-._~%/?=&;:,+]*$/;
export function safeLinks(html: string): string {
  return html.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_m, href: string, text: string) => {
    const to = href.replace(/&amp;/g, "&");
    return APP_PATH.test(to) && !/^\/\/|[\\]|^\/.*:\/\//.test(to) ? `<a class="applink" href="${href}">${text}</a>` : text;
  });
}

/**
 * Pictures in an answer: only the app's own pictures (people's portraits, the Timeline's pictures
 * and leaders, the photos an admin set), which Ask's tools name, are shown; any other image is
 * dropped, so nothing the model writes can load from elsewhere.
 */
const APP_PICTURE = /^\/(people|timeline|library|brand)\/[A-Za-z0-9._/-]+\.(webp|png|jpe?g)$|^\/api\/photos\/file\/photos\/[a-z]+\/[a-z0-9-]+\/\d{13}\.(webp|png|jpe?g)$/;
const esc = (s: string) => s.replace(/&(?!amp;|lt;|gt;|quot;|#39;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export function safeImages(html: string, resolve: (path: string) => string): string {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const src = /\bsrc="([^"]*)"/.exec(tag)?.[1]?.replace(/&amp;/g, "&") ?? "";
    const alt = /\balt="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (!APP_PICTURE.test(src) || /\.\./.test(src)) return "";
    const url = src.startsWith("/api/") ? src : resolve(src);
    return `<img class="msg__pic" src="${esc(url)}" alt="${alt}" loading="lazy" decoding="async">`;
  });
}
