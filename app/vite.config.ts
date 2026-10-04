import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** A complete release of the shell, including lazy reader chunks, installed as one cache. */
const offlineShell: Plugin = {
  name: "offline-shell", apply: "build",
  generateBundle: { order: "post", handler(_options, bundle) {
    const paths = Object.keys(bundle).filter((p) => /\.(js|css|html)$/.test(p)).sort();
    const revision = createHash("sha256");
    for (const p of paths) { const entry = bundle[p]; revision.update(p); revision.update(entry.type === "chunk" ? entry.code : entry.source); }
    const hash = revision.digest("hex");
    this.emitFile({ type: "asset", fileName: "offline-shell.json", source: JSON.stringify({ revision: hash, paths }) });
    this.emitFile({ type: "asset", fileName: "sw.js", source: readFileSync(new URL("./public/sw.js", import.meta.url), "utf8").replace("__CJ_SHELL_REVISION__", hash) });
  } },
};

/**
 * telegram-ui's Subheadline renders an <h6> by default, and Cell, Chip and Badge use it for
 * subtitles, counts and labels with no way to pass another element. That fills every list with
 * level-six headings. Render it as a <span> (kept block-level in CSS) so headings are only the
 * real section headings; a screen that wants a heading still passes Component explicitly.
 */
const plainSubheadline: Plugin = {
  name: "plain-subheadline",
  enforce: "pre",
  transform(code, id) {
    if (!/telegram-ui[\\/]dist[\\/]components[\\/]Typography[\\/]Subheadline[\\/]Subheadline\.js$/.test(id)) return null;
    const out = code.replace("Component: Component || 'h6'", "Component: Component || 'span'");
    if (out === code) this.warn("Subheadline default element not found; telegram-ui changed");
    return { code: out, map: null };
  },
};

export default defineConfig({
  plugins: [plainSubheadline, react(), offlineShell],
  // The dev server pre-bundles telegram-ui with esbuild, so the same change is made there.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [{
        name: "plain-subheadline",
        setup(build) {
          build.onLoad({ filter: /Typography[\\/]Subheadline[\\/]Subheadline\.js$/ }, async (args) => {
            const { readFile } = await import("node:fs/promises");
            return { contents: (await readFile(args.path, "utf8")).replace("Component: Component || 'h6'", "Component: Component || 'span'"), loader: "js" };
          });
        },
      }],
    },
  },
  // Production serves the app from cyberjudah.io/app, so the build is rooted at /app/
  // (CYBERJUDAH_APP_BASE=/app/ in the deploy workflow). Local dev and the e2e suite keep "/".
  base: process.env.CYBERJUDAH_APP_BASE || "/",
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@shared": new URL("../shared", import.meta.url).pathname,
    },
  },
  server: { port: 5173, allowedHosts: true },
  build: { target: "es2022", sourcemap: false },
});
