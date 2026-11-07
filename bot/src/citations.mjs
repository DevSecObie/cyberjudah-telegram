/** The server's citation registry, not bracketed source text or a model's claimed registry. */
const referencePattern = () => /\[(-?\d+(?:\.\d+)?(?:\s*,\s*-?\d+(?:\.\d+)?)*)\]/g;
/** Numeric reference tokens, including invalid IDs; no answer text in diagnostics. */
export const citationTokenCount = answer => [...String(answer).matchAll(referencePattern())].reduce((n, match) => n + match[1].split(',').length, 0);
export function citationReport(answer, registry) {
  const allowed = new Set((Array.isArray(registry) ? registry : Array.from({ length: Math.max(0, registry) }, (_, index) => index + 1)).filter(n => Number.isSafeInteger(n) && n > 0));
  const supported = [], unsupported_refs = [];
  for (const match of String(answer).matchAll(referencePattern())) {
    let invalid = false;
    for (const token of match[1].split(/\s*,\s*/)) {
      const n = Number(token);
      if (!/^[1-9]\d*$/.test(token) || !Number.isSafeInteger(n) || !allowed.has(n)) invalid = true;
      else if (!supported.includes(n)) supported.push(n);
    }
    if (invalid && !unsupported_refs.includes(match[0])) unsupported_refs.push(match[0]);
  }
  return { supported, unsupported_refs };
}
