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
