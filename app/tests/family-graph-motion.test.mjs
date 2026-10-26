import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const { outputFiles } = await build({ entryPoints: [new URL("../src/screens/family-graph-motion.ts", import.meta.url).pathname], bundle: true, write: false, format: "esm", platform: "node" });
const { createLayers, transitionLayers, finishLayers, springProgress, advanceMotion, nodeFrame, avatarFrame, connectionFrame, layerFrame } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const center = { x: 165, y: 188 }, at = { x: 54, y: 92 };
const camera = (id, progress = 0) => ({ id, kind: "camera", selectedId: "next", departingId: "root", selectedPosition: 3, progress, elapsed: 0 });
const pagination = (progress, direction = 1) => ({ id: 1, kind: "pagination", progress, direction, elapsed: progress * 350 });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("camera keeps source and target alive in a bounded three-layer pool", () => {
  let layers = transitionLayers(createLayers("root"), "next", camera(1), 1);
  assert.equal(layers.length, 3); assert.equal(layers.filter(l => l.visible).length, 2);
  assert.equal(layers.find(l => l.current).scene, "next");
  layers = finishLayers(layers, 1); assert.equal(layers.filter(l => l.visible).length, 1);
  assert.equal(layers.find(l => l.current).scene, "next");
});
test("overlapping cameras carry unfinished entries, reuse the oldest non-current layer and ignore old completions", () => {
  const m1 = camera(1, .3), m2 = camera(2, .2), m3 = camera(3);
  let layers = transitionLayers(createLayers("root"), "one", m1, 1);
  layers = transitionLayers(layers, "two", m2, 2);
  layers = transitionLayers(layers, "three", m3, 3);
  assert.equal(layers.length, 3); assert.equal(layers.find(l => l.current).scene, "three");
  assert.deepEqual(layers.find(l => l.current).carry.map(m => m.id), [1, 2]);
  layers = finishLayers(layers, 1); assert.equal(layers.find(l => l.current).scene, "three");
  layers = finishLayers(layers, 2); layers = finishLayers(layers, 3);
  assert.equal(layers.filter(l => l.visible).length, 1); assert.deepEqual(layers.find(l => l.current).carry, []);
});
test("camera translates toward the selection, preserves inherited offsets and fades both layers", () => {
  const m = camera(1, .25), layers = transitionLayers(createLayers("root"), "next", m, 1);
  const source = layerFrame(layers.find(l => l.exit), center, () => at);
  const target = layerFrame(layers.find(l => l.current), center, () => at);
  near(source.x, 111 * .25); near(source.y, 96 * .25); near(source.opacity, .75);
  near(target.x, -111 * .75); near(target.y, -96 * .75); near(target.opacity, .25);
  const carrying = { ...layers.find(l => l.current), carry: [camera(2, .5)] };
  near(layerFrame(carrying, center, () => at).x, target.x - 111 * .5);
});
test("camera node roles use the pinned .71,1.42,.3 scales without moving node positions", () => {
  near(nodeFrame(camera(1), undefined, "center", "next", center, center).scale, .71);
  near(nodeFrame(camera(1), undefined, "previous", "root", at, center).scale, 1.42);
  near(nodeFrame(camera(1), undefined, "relation", "other", at, center).scale, .3);
  near(nodeFrame(undefined, camera(1, 1), "relation", "next", at, center).scale, 1.42);
  near(nodeFrame(undefined, camera(1, 1), "center", "root", center, center).scale, .71);
});
test("camera avatar borders transfer the selected color and one-to-two-pixel width without changing the palette", () => {
  for (const progress of [0, .25, .5, .75, 1]) {
    const selected = avatarFrame("selected", progress), center = avatarFrame("center", progress);
    near(selected.primary, progress); near(selected.width, 1 + progress);
    near(center.primary, 1 - progress); near(center.width, 2 - progress);
  }
});
test("pagination exits in150ms, enters after200ms and completes at350ms without stagger or scaling", () => {
  for (const elapsed of [0, 75, 150, 200, 275, 350]) {
    const m = pagination(elapsed / 350);
    const entry = nodeFrame(m, undefined, "relation", "next", at, center), exit = nodeFrame(undefined, m, "relation", "old", at, center);
    near(entry.opacity, Math.max(0, Math.min(1, (elapsed - 200) / 150)));
    near(exit.opacity, Math.max(0, 1 - elapsed / 150));
    near(entry.scale, 1); near(exit.scale, 1);
    near(nodeFrame(m, undefined, "previous", "root", at, center).opacity, 1);
    near(nodeFrame(m, undefined, "center", "next", center, center).scale, 1);
  }
});
test("pagination rotates node radii and matching connector endpoints in both directions", () => {
  for (const direction of [-1, 1]) {
    const m = pagination(0, direction), node = nodeFrame(m, undefined, "relation", "next", at, center), line = connectionFrame(m, undefined, at, center);
    near(node.x + at.x, line.x2); near(node.y + at.y, line.y2);
    near(Math.hypot(line.x2 - center.x, line.y2 - center.y), Math.hypot(at.x - center.x, at.y - center.y));
    const startAngle = Math.atan2(at.y - center.y, at.x - center.x), endAngle = Math.atan2(line.y2 - center.y, line.x2 - center.x);
    near(endAngle - startAngle, direction * 10 * Math.PI / 180);
  }
});
test("duration400 means Reanimated4.7's600ms critical spring, not a400ms CSS ease", () => {
  assert.equal(springProgress(0), 0); assert.ok(springProgress(400) > .99 && springProgress(400) < 1);
  assert.equal(springProgress(650), 1);
  let previous = 0; for (let t = 0; t <= 650; t += 10) { const p = springProgress(t); assert.ok(p >= previous && p <= 1); previous = p; }
});
test("motion driver caps dropped frames at64ms like Reanimated and completes linear pagination", () => {
  const m = pagination(0); advanceMotion(m, 100); advanceMotion(m, 1000); assert.equal(m.elapsed, 64);
  for (let now = 1016; now < 1400; now += 16) advanceMotion(m, now);
  assert.equal(m.progress, 1);
});
