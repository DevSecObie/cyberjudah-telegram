/**
 * The reader's last screen, kept so the Bible opens at once. Bible Strong's reader needs a few
 * seconds to start; meanwhile the app shows a still copy of exactly what the reader last showed
 * (its own markup and styles) and swaps the live reader in when it is ready. The reader reopens
 * its last chapter at the top, so the copy is shown at the top too and the swap does not show.
 *
 * The copy is taken from the reader's frame (same origin) when the Bible is left or the app is
 * hidden, and kept on this device only (localStorage). Scripts are never copied, and the copy is
 * shown in a sandboxed frame without scripts, so it can only be looked at.
 */
export type ReaderSnapshot = { v: 2; chapter: string; html: string; scroll: number; width: number; at: number };

const KEY = "cj:bible-snapshot";
const MAX = 1_500_000; // characters; a chapter with its styles is far below this
const SCROLL_MARK = "data-cj-snapshot-scroll";

/** The scrolling element that holds the verses, if the reader is showing a chapter. */
function scroller(doc: Document): HTMLElement | null {
  let el = doc.querySelector<HTMLElement>("[data-verse-key]");
  while (el && el !== doc.body) {
    const s = getComputedStyle(el);
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

/** A still copy of the reader as it is now, or null if it is not showing a chapter. */
export function takeSnapshot(frame: HTMLIFrameElement | null): ReaderSnapshot | null {
  try {
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    // The chapter it shows, from its verses' keys ("43-3-16" is John 3).
    const key = doc?.querySelector("[data-verse-key]")?.getAttribute("data-verse-key") ?? "";
    const chapter = /^(\d+-\d+)-\d+$/.exec(key)?.[1];
    if (!doc || !win || !chapter) return null;
    const scroll = scroller(doc);
    scroll?.setAttribute(SCROLL_MARK, "");
    // The rules in force, read from the style sheets: the reader adds most of its styles from script
    // (insertRule), so a <style> tag's own text would miss them.
    // Only the rules the page uses: the reader's sheets hold every style the whole app needs, and
    // parsing all of them made the copy slower to show than it should be.
    const used = (rule: CSSRule): string => {
      if (rule instanceof CSSStyleRule) {
        try { return doc.querySelector(rule.selectorText) ? rule.cssText : ""; } catch { return rule.cssText; }
      }
      if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
        const inner = Array.from(rule.cssRules).map(used).join("");
        return inner ? `@${rule instanceof CSSMediaRule ? "media" : "supports"} ${rule.conditionText}{${inner}}` : "";
      }
      return rule.cssText; // @font-face, @keyframes, :root variables and the like
    };
    const css = Array.from(doc.styleSheets).map((sheet) => {
      try { return Array.from(sheet.cssRules).map(used).join("\n"); } catch { return sheet.href ? `@import url("${sheet.href}");` : ""; }
    }).join("\n");
    const styles = `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`;
    const body = doc.body.cloneNode(true) as HTMLElement;
    scroll?.removeAttribute(SCROLL_MARK);
    body.querySelectorAll("script, noscript, iframe, video, audio").forEach((n) => n.remove());
    // The header and buttons slide away as the chapter scrolls; the copy shows the top of the
    // chapter, so put them back where they sit there.
    const text = body.querySelector(`[${SCROLL_MARK}]`);
    body.querySelectorAll<HTMLElement>("[style*=transform], [style*=opacity]").forEach((el) => {
      if (text?.contains(el)) return;
      el.style.removeProperty("transform");
      el.style.removeProperty("opacity");
    });
    const html = `<!doctype html><html lang="${doc.documentElement.lang || "en"}" style="${doc.documentElement.getAttribute("style") ?? ""}"><head><meta charset="utf-8"><base href="${win.location.origin}/app/strong/">${styles}</head>${body.outerHTML}</html>`;
    if (html.length > MAX) return null;
    return { v: 2, chapter, html, scroll: scroll?.scrollTop ?? 0, width: win.innerWidth, at: Date.now() };
  } catch {
    return null;
  }
}

export function saveSnapshot(s: ReaderSnapshot | null) {
  if (!s) return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage full or blocked: the lion shows instead */ }
}

export function loadSnapshot(): ReaderSnapshot | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as ReaderSnapshot | null;
    return s && s.v === 2 && typeof s.html === "string" ? s : null;
  } catch {
    return null;
  }
}

/** Whether the copy shows what is about to open: the reader's own last place (requested is null), or the same chapter ("43-3"). */
export function snapshotFits(s: ReaderSnapshot, requested: string | null, width: number): boolean {
  if (Math.abs(s.width - width) > 2) return false; // a different layout would jump
  return requested === null || requested === s.chapter;
}

/** Shows the copy from the top of the chapter, as the reader reopens it. */
export function restoreScroll(frame: HTMLIFrameElement) {
  try {
    const el = frame.contentDocument?.querySelector<HTMLElement>(`[${SCROLL_MARK}]`);
    if (el) el.scrollTop = 0;
  } catch { /* nothing to restore */ }
}
