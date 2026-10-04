#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sourceBytes } from "./build-bundles.mjs";

export function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row.push(Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    previous = row;
  }
  return previous[b.length];
}
const normalize = (s) => s.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
const words = (s) => s.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
export function errorRate(expected, actual) {
  const reference = normalize(expected), ocr = normalize(actual), tokens = words(reference);
  return { characters: [...reference].length, characterErrors: editDistance([...reference], [...ocr]), words: tokens.length, wordErrors: editDistance(tokens, words(ocr)) };
}
export async function reportOCR(cache) {
  const sample = JSON.parse(await readFile(new URL("./ocr-samples.json", import.meta.url), "utf8")), rows = [];
  for (const s of sample.samples) {
    const pages = JSON.parse(new TextDecoder().decode(await sourceBytes(s.source, cache, false)));
    const page = pages.find((p) => p.vol === s.volume && p.img === s.image);
    if (!page || page.page !== s.page || s.end > page.text.length) throw new Error("OCR sample no longer matches its pinned source");
    const text = page.text.slice(s.start, s.end), measured = errorRate(s.transcription, text);
    rows.push({ resource: s.resource, volume: s.volume, page: s.page, scan: s.url, ...measured, needsProofreader: measured.wordErrors > 0 || measured.characterErrors > 0 });
  }
  return { assessed: sample.assessed, selection: sample.selection, rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cache, out] = process.argv.slice(2);
  if (!cache || !out) throw new Error("Usage: node resources/ocr-report.mjs SOURCE_CACHE REPORT.json");
  await writeFile(out, JSON.stringify(await reportOCR(cache), null, 2) + "\n", { flag: "wx" });
}
