// Moves every changelog entry in changes/*.md into the Unreleased section of CHANGELOG.md, in file
// name order, and deletes the files. Run when cutting a release; see changes/README.md.
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const dir = join(root, "changes");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .sort();
if (!files.length) {
  console.log("No changelog entries waiting.");
  process.exit(0);
}

const lines = [];
for (const f of files) {
  const text = readFileSync(join(dir, f), "utf8").trim();
  const entries = text.split("\n").filter((l) => l.startsWith("- "));
  if (!entries.length) throw new Error(`changes/${f}: no lines starting with "- "`);
  lines.push(...entries);
}

const path = join(root, "CHANGELOG.md");
const log = readFileSync(path, "utf8");
const heading = "## [Unreleased]\n";
const at = log.indexOf(heading);
if (at < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] heading");
const insert = at + heading.length;
writeFileSync(path, `${log.slice(0, insert)}\n${lines.join("\n")}\n${log.slice(insert).replace(/^\n/, "")}`);
for (const f of files) unlinkSync(join(dir, f));
console.log(`Moved ${lines.length} line(s) from ${files.length} file(s) into Unreleased.`);
