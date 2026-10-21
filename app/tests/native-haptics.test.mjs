import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const load = async () => {
  const result = await build({ entryPoints: [new URL("../src/native/haptics.ts", import.meta.url).pathname], bundle: true, format: "esm", write: false });
  return import(`data:text/javascript,${encodeURIComponent(result.outputFiles[0].text)}`);
};

const plugin = (calls, fail = new Set()) => ({
  Haptics: Object.fromEntries(["selectionStart", "selectionChanged", "impact", "notification"].map((name) =>
    [name, async (options) => { calls.push(options ? [name, options] : [name]); if (fail.has(name)) throw new Error(name); }])),
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("each haptic kind plays the native feedback Telegram plays for it, with selection started once", async () => {
  const { nativeHaptics } = await load();
  const calls = [];
  const haptic = nativeHaptics(async () => plugin(calls));
  for (const kind of ["select", "select", "tap", "heavy", "success", "warning", "error"]) haptic(kind);
  await settle();
  assert.deepEqual(calls, [
    ["selectionStart"], ["selectionChanged"], ["selectionChanged"],
    ["impact", { style: "LIGHT" }], ["impact", { style: "MEDIUM" }],
    ["notification", { type: "SUCCESS" }], ["notification", { type: "WARNING" }], ["notification", { type: "ERROR" }],
  ]);
});

test("a plugin that fails to load or to play never throws to the screen", async () => {
  const { nativeHaptics } = await load();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  nativeHaptics(async () => { throw new Error("not implemented"); });
  await settle();
  process.off("unhandledRejection", onUnhandled);
  assert.deepEqual(unhandled, [], "a plugin that fails to load before any haptic is asked for");
  const missing = nativeHaptics(async () => { throw new Error("not implemented"); });
  assert.doesNotThrow(() => missing("tap"));
  const calls = [];
  const failing = nativeHaptics(async () => plugin(calls, new Set(["selectionStart", "impact"])));
  failing("tap");
  failing("select");
  await settle();
  assert.deepEqual(calls.map(([name]) => name), ["selectionStart", "impact", "selectionChanged"]);
});
