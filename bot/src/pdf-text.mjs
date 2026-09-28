import { parseDocument } from 'htmlparser2';
import { decodeHTML } from 'entities';

const hidden = new Set(['script', 'style', 'iframe', 'object', 'template']);

/** Remove web-only nodes by parser offsets. Keep the original markdown and entity spelling
 * of everything else: serializing HTML here would corrupt markdown or decode it twice. */
export function prepare(md) {
  const source = String(md ?? '');
  const tree = parseDocument(source, { decodeEntities: false, withStartIndices: true, withEndIndices: true });
  const ranges = [];
  const visit = node => {
    const classes = new Set((node.attribs?.class ?? '').split(/\s+/));
    if (node.type === 'comment' || hidden.has(node.name) || node.name === 'figure' || classes.has('class-video-mount') || classes.has('shown-all')) {
      if (node.startIndex !== null && node.endIndex !== null) ranges.push([node.startIndex, node.endIndex + 1]);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  let result = '', offset = 0;
  for (const [start, end] of ranges) { result += source.slice(offset, start) + '\n'; offset = end; }
  result += source.slice(offset);
  return result.replace(/[ \t]+taught in \[[^\]]+\]\(\/study\/[^)]+\)/g, '');
}

/** Extract inert PDF text, decoding entities once as part of parsing. Decoded angle
 * brackets stay text and are never fed back into an HTML parser or browser sink. */
export function stripTags(html) {
  const tree = parseDocument(String(html), { decodeEntities: true });
  const text = node => {
    if (hidden.has(node.name) || node.type === 'comment') return '';
    if (node.type === 'text') return node.data;
    return (node.children ?? []).map(text).join(' ');
  };
  return text(tree).replace(/\s+/g, ' ').trim();
}

/** Single-pass decoding preserves literal entity examples such as &amp;lt;. */
export const unescape = value => decodeHTML(String(value));
