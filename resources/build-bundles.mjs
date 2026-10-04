#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rename, lstat, copyFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CatalogSchema, sha256 } from "../shared/resources.ts";
import { buildBundle, writeBundle } from "./bundle.mjs";
import { convertBook, convertStrongs, upstreamHeader } from "./convert.mjs";

/** Cache files are trusted only after checking the pinned hash, including on repeat builds. */
export async function sourceBytes(source, cache, download = true) {
  const file = path.join(cache, source.sha256);
  let bytes;
  try { bytes = new Uint8Array(await readFile(file)); }
  catch (error) {
    if (error.code !== "ENOENT" || !download) throw error;
    const temp = `${file}.${process.pid}.download`;
    execFileSync("curl", ["--fail", "--location", "--retry", "2", "--max-time", "180", "--proto", "=https", "--proto-redir", "=https", "--output", temp, source.url], { stdio: ["ignore", "ignore", "inherit"] });
    bytes = new Uint8Array(await readFile(temp));
    if (await sha256(bytes) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.path}`);
    await rename(temp, file);
  }
  if (await sha256(bytes) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.path}`);
  return bytes;
}

export async function buildApproved({ output, cache, download = true }) {
  // Never replace user files or reuse stale bundle output.
  try { await lstat(output); throw new Error("Output already exists; choose a new directory"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
  const lock = JSON.parse(await readFile(new URL("./sources.lock.json", import.meta.url), "utf8"));
  const shared = new Map();
  for (const source of lock.bible) shared.set(source.path, JSON.parse(new TextDecoder().decode(await sourceBytes(source, cache, download))));
  const books = shared.get("data/bible/index.json"), bible = Object.fromEntries(books.map((b) => [b.slug, shared.get(`data/bible/${b.slug}.json`).chapters]));
  const catalog = { schemaVersion: 1, revision: 1, resources: [] }, inventory = { schemaVersion: 1, objects: [] }, reports = {};
  for (const resource of lock.resources) {
    const inputs = new Map();
    for (const source of resource.inputs) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await sourceBytes(source, cache, download));
      inputs.set(source.path, source.path.endsWith(".js") ? text : JSON.parse(text));
    }
    const strongs = resource.id === "strongs", book = inputs.get(`data/library/${resource.id}/book.json`);
    const licenses = strongs ? resource.inputs.filter((s) => s.path.startsWith("upstream/")).map((s) => ({ id: "CC-BY-SA-unversioned", url: s.url, attribution: upstreamHeader(inputs.get(s.path)), modifications: "Converted the pinned upstream JSON through the existing CyberJudah field mapping, verified without corrections. Added existing KJV concordance results, checksummed NDJSON shards and a key-to-shard index. The converted lexicon remains a separate share-alike resource under the same unversioned notice." })) : [{ id: "public-domain", url: book.source, attribution: `${book.title}. ${book.author}. ${book.publisher}. ${book.year}. Source scans: ${book.items.map((i) => `https://archive.org/details/${i.id}`).join("; ")}. Historic edition approved by the owner; source assertions and OCR limitations are recorded in docs/resources.md.`, modifications: "Repackaged the pinned existing library transcription without changing its text. That earlier importer joined wrapped words/lines and removed running heads and chapter headings; this converter makes no OCR corrections. Added verified scripture-link annotations, search postings and a key-to-shard index." }];
    const converted = strongs ? convertStrongs(inputs, books, bible) : convertBook(resource.id, inputs, books, bible);
    const metadata = {
      id: resource.id, kind: strongs ? "lexicon" : resource.id === "smiths-dictionary-of-the-bible" ? "dictionary" : "reference",
      title: strongs ? "Strong's Hebrew and Greek lexicon" : `${book.title} (${resource.id === "jewish-encyclopedia" ? "1901–1906, 12 volumes" : book.year})`, language: "en",
      source: [...resource.inputs, ...lock.bible].map(({ url, revision, sha256 }) => ({ url, revision, sha256 })), license: licenses,
      approval: { reference: "https://github.com/DevSecObie/cyberjudah-telegram/blob/codex/bible-resource-bundles-phase2/docs/resources.md", approvedBy: "Owner: adopted Phase 2 instructions, 2026-10-04" },
    };
    const bundle = await buildBundle(metadata, converted.records);
    inventory.objects.push(...await writeBundle(output, bundle)); catalog.resources.push(bundle.entry);
    reports[resource.id] = { ...converted.report, release: bundle.entry.release, records: converted.records.length, size: [...bundle.files.values()].reduce((n, b) => n + b.length, 0), indexBuckets: bundle.manifest.index.buckets.length, dataShards: bundle.manifest.parts.length };
    console.log(`${resource.id}: ${converted.records.length} records, ${bundle.manifest.parts.length} shards, ${bundle.entry.release}`);
  }
  CatalogSchema.parse(catalog);
  await writeFile(path.join(output, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n", { flag: "wx" });
  await writeFile(path.join(output, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n", { flag: "wx" });
  await writeFile(path.join(output, "conversion-report.json"), JSON.stringify(reports, null, 2) + "\n", { flag: "wx" });
  for (const file of ["sources.lock.json", "ocr-samples.json"]) await copyFile(new URL(file, import.meta.url), path.join(output, file));
  return { catalog, reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), value = (name) => args[args.indexOf(name) + 1];
  if (!args.includes("--out") || !args.includes("--cache")) throw new Error("Usage: node resources/build-bundles.mjs --out NEW_DIRECTORY --cache SOURCE_CACHE [--offline]");
  await buildApproved({ output: path.resolve(value("--out")), cache: path.resolve(value("--cache")), download: !args.includes("--offline") });
}
