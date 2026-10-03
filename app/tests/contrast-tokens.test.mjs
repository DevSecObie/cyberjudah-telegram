import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("every shared UI color has an explicit increased-contrast variant in all three themes", () => {
  const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8").split('html[data-theme="light"]')[0];
  const colors = new Set([...tokens.matchAll(/--([\w-]+):\s*([^;]+);/g)].filter(([, key]) => /^(canvas|surface-|fill-|text-|accent|on-accent|danger|success|warning|gold|violet|sky|hairline|control-edge|rim|shadow-|card-edge|state-|focus-ring|mat-(base$|nav$|elevated$|overlay$|edge$|highlight$|shadow$|selected$|glow$)|media-|widget-|scrim-|switch-(thumb$|shadow$)|control-lift-shadow$)/.test(key)).map(([, key]) => key));
  const css = readFileSync(new URL("../src/styles/contrast.css", import.meta.url), "utf8");
  const variants = [...css.matchAll(/\n  (?:[^\n]+) \{\n([\s\S]*?)\n  \}/g)].slice(0, 3);
  assert.equal(variants.length, 3);
  assert.ok(colors.size > 50, "the inventory must include all semantic UI colors");
  for (const [i, [, block]] of variants.entries()) for (const color of colors) {
    assert.match(block, new RegExp(`--${color}: [^;]+ !important;`), `${["dark", "light", "sepia"][i]}: ${color} must beat a saved inline color`);
  }
});
