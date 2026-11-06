import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Publish the tested native release's files and metadata together, retaining extra dictionaries.
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error("Expected source and destination offline directories");
const release = JSON.parse(fs.readFileSync(path.join(source, "catalog.json"), "utf8"));
const target = path.join(destination, "catalog.json");
const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, "utf8")) : release;
const verify = (root, resource) => {
  const file = path.resolve(root, resource.file);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid archive path");
  const data = fs.readFileSync(file);
  if (data.length !== resource.archiveBytes || crypto.createHash("sha256").update(data).digest("hex") !== resource.archiveSha256)
    throw new Error(resource.file + " does not match its catalog");
};
for (const resource of Object.values(release.resources)) verify(source, resource);
fs.mkdirSync(destination, { recursive: true });
for (const resource of Object.values(release.resources)) {
  const targetFile = path.join(destination, resource.file);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(path.join(source, resource.file), targetFile);
}
const resources = { ...previous.resources, ...release.resources };
for (const resource of Object.values(resources)) verify(destination, resource);
fs.writeFileSync(target, JSON.stringify({ ...release, resources, resourceCount: Object.keys(resources).length }));
console.log(`Verified ${Object.keys(resources).length} native offline resources`);
