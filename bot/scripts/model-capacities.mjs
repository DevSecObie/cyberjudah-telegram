// Record published capacities separately from catalog routing/price metadata.
// node bot/scripts/model-capacities.mjs <cloudflare-docs/src/content> <commit>
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import catalog from '../../shared/ask-models.json' with { type: 'json' };

const [directory, commit] = process.argv.slice(2);
if (!directory || !/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('Supply the Cloudflare content directory and its commit SHA');
const selected = new Map(catalog.models.map(model => [model.id, model]));
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
function maxima(node) {
  if (!node || typeof node !== 'object') return [];
  const here = positive(node.properties?.max_tokens?.maximum);
  return [...(here ? [here] : []), ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(maxima) : maxima(value))];
}
const models = {};
for (const folder of ['workers-ai-models', 'catalog-models']) {
  for (const file of fs.readdirSync(path.join(directory, folder)).filter(file => file.endsWith('.json')).sort()) {
    const bytes = fs.readFileSync(path.join(directory, folder, file));
    const data = JSON.parse(bytes.toString('utf8'));
    const id = data.model_id ?? data.name, model = selected.get(id);
    if (!model || folder === 'catalog-models' && model.maxOutput !== null) continue;
    const properties = Object.fromEntries((data.properties ?? []).map(property => [property.property_id, property.value]));
    const limits = maxima(data.schema?.input);
    models[id] = { contextWindow: positive(properties.context_window ?? data.context_length), maxOutput: positive(data.max_output_tokens) ?? (limits.length ? Math.min(...limits) : null), sourceBlob: createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex') };
  }
}
for (const model of catalog.models.filter(model => model.id.startsWith('@cf/'))) {
  if (!models[model.id]?.contextWindow) throw new Error(`No published context window for ${model.id}`);
}
const output = { source: 'cloudflare/cloudflare-docs src/content/workers-ai-models and src/content/catalog-models', commit, models };
fs.writeFileSync(new URL('../../shared/model-capacities.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(`Recorded capacities for ${Object.keys(models).length} models`);
