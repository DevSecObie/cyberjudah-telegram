import { Parser } from "htmlparser2";

/** HTML from the app's own feeds as plain text: a parser, never a tag-stripping regex. */
export function htmlToText(html: string): string {
  let out = "";
  const parser = new Parser({
    ontext: (t) => { out += t; },
    onclosetag: (name) => { if (/^(?:p|h[1-6]|li|blockquote|div|br)$/.test(name)) out += "\n"; },
  }, { decodeEntities: true });
  parser.write(html);
  parser.end();
  return out.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
