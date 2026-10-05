/** Rewrite only changed JSON values. Unchanged records, key order, escapes and
 * whitespace survive CMS saves, even when a record moves between lists. */
type Node = { start: number; end: number; value: any; children?: { key: string; start: number; node: Node }[] };
function tree(text: string): Node {
  let at = 0;
  const ws = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => { const start = at++; while (at < text.length) { if (text[at++] === '"') break; if (text[at - 1] === '\\') at++; } return JSON.parse(text.slice(start, at)) as string; };
  const read = (): Node => {
    ws(); const start = at, open = text[at];
    if (open === '[' || open === '{') {
      at++; ws(); const children: NonNullable<Node['children']> = [], value: any = open === '[' ? [] : {};
      while (text[at] !== (open === '[' ? ']' : '}')) {
        const childStart = at, key = open === '[' ? String(children.length) : string();
        if (open === '{') { ws(); at++; }
        const node = read(); children.push({ key, start: childStart, node }); value[key] = node.value; ws();
        if (text[at] !== ',') break;
        at++; ws();
      }
      at++; return { start, end: at, value, children };
    }
    if (open === '"') string(); else while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    return { start, end: at, value: JSON.parse(text.slice(start, at)) };
  };
  JSON.parse(text); // Reject invalid source before scanning it.
  return read();
}
const same = (a: any, b: any): boolean => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && same(a[k], b[k])));
export function rewriteJson(text: string, value: unknown): string {
  const root = tree(text), indent = /\n([ \t]+)\S/.exec(text)?.[1] ?? '';
  const render = (node: Node, next: any, depth: number): string => {
    if (same(node.value, next)) return text.slice(node.start, node.end);
    const format = (v: any) => JSON.stringify(v, null, indent).replaceAll('\n', '\n' + indent.repeat(depth));
    if (!node.children || !next || typeof next !== 'object' || Array.isArray(next) !== Array.isArray(node.value)) return format(next);
    const children = node.children, array = Array.isArray(next);
    const identity = (v: any) => v && typeof v === 'object' ? v.slug ?? v.id : undefined;
    const keyed = array && children.length > 0 && children.every(c => typeof identity(c.node.value) === 'string') && next.every((v: any) => typeof identity(v) === 'string');
    const byKey = new Map(children.map(c => [keyed ? identity(c.node.value) : c.key, c]));
    const keys = array ? next.map((_: unknown, i: number) => String(i)) : [...children.map(c => c.key).filter(k => Object.hasOwn(next, k)), ...Object.keys(next).filter(k => !byKey.has(k))];
    const pairs = keys.map((key: string) => ({ key, old: byKey.get(keyed ? identity((next as any)[key]) : key) }));
    // No insertion/removal/move: preserve every byte between changed values.
    if (pairs.length === children.length && pairs.every((p: any, i: number) => p.old === children[i])) {
      let result = '', pos = node.start;
      for (const { key, old } of pairs) { result += text.slice(pos, old!.node.start) + render(old!.node, next[key], depth + 1); pos = old!.node.end; }
      return result + text.slice(pos, node.end);
    }
    const multiline = text.slice(node.start, node.end).includes('\n');
    const before = children.length ? text.slice(node.start + 1, children[0].start) : multiline ? '\n' + indent.repeat(depth + 1) : '';
    const after = children.length ? text.slice(children.at(-1)!.node.end, node.end - 1) : multiline ? '\n' + indent.repeat(depth) : '';
    const between = children.length > 1 ? text.slice(children[0].node.end, children[1].start) : ',' + before;
    const entries = pairs.map(({ key, old }: any) => old
      ? text.slice(old.start, old.node.start) + render(old.node, next[key], depth + 1)
      : (array ? '' : JSON.stringify(key) + (multiline ? ': ' : ':')) + JSON.stringify(next[key], null, multiline ? indent : '').replaceAll('\n', '\n' + indent.repeat(depth + 1)));
    return text[node.start] + (entries.length ? before + entries.join(between) + after : '') + text[node.end - 1];
  };
  return text.slice(0, root.start) + render(root, value, 0) + text.slice(root.end);
}
