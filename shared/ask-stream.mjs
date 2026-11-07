/** Apply incremental research previews by citation number; later readings can extend a source. */
export function mergePassages(current = [], updates = []) {
  const sources = new Map(current.map(source => [source.n, source]));
  for (const source of updates) sources.set(source.n, { ...sources.get(source.n), ...source });
  return [...sources.values()].sort((a, b) => a.n - b.n);
}
