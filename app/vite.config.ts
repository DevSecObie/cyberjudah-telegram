import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The reader shell includes lazy reader chunks; admin editors load only after authorization. */
let assetBase = "/";
const offlineShell: Plugin = {
  name: "offline-shell", apply: "build",
  configResolved(config) { assetBase = config.base; },
  generateBundle: { order: "post", handler(_options, bundle) {
    const reader = new Set<string>(['index.html']);
    const visit = (name: string) => {
      if (reader.has(name)) return;
      const chunk = bundle[name];
      if (!chunk || chunk.type !== 'chunk') return;
      // Do not let service-worker installation bypass the runtime admin gate.
      if (/\/src\/(?:admin\/(?:Admin|TimelineEditor|ResourceAdmin|ClassEditor|PeopleEditor|PreceptEditor)|ui\/(?:photo-editor|note-edit))\./.test(chunk.facadeModuleId ?? '')) return;
      reader.add(name);
      const css = (chunk as typeof chunk & { viteMetadata?: { importedCss: Set<string> } }).viteMetadata?.importedCss;
      css?.forEach(name => reader.add(name));
      [...chunk.imports, ...chunk.dynamicImports].forEach(visit);
    };
    Object.values(bundle).forEach(chunk => { if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName); });
    const paths = [...reader].sort();
    const revision = createHash("sha256");
    for (const p of paths) { const entry = bundle[p]; revision.update(p); revision.update(entry.type === "chunk" ? entry.code : entry.source); }
    const hash = revision.digest("hex");
    this.emitFile({ type: "asset", fileName: "offline-shell.json", source: JSON.stringify({ revision: hash, base: assetBase, paths }) });
    this.emitFile({ type: "asset", fileName: "sw.js", source: readFileSync(new URL("./public/sw.js", import.meta.url), "utf8").replace("__CJ_SHELL_REVISION__", hash).replace('"__CJ_ASSET_BASE__"', JSON.stringify(assetBase)) });
  } },
};

/**
 * The reading face (src/fonts/fonts.css) is self-hosted with a hashed name, so its preload is
 * added once the build knows that name: the home verse and the Bible ask for it first.
 */
const preloadReadingFace: Plugin = {
  name: "preload-reading-face", apply: "build",
  transformIndexHtml: { order: "post", handler(_html, ctx) {
    const face = Object.values(ctx.bundle ?? {}).find((a) => a.type === "asset" && a.originalFileNames.some((n) => n.endsWith("newsreader-latin-opsz-normal.woff2")));
    if (!face) { this.warn?.("reading face not found in the bundle; no font preload"); return; }
    return [{ tag: "link", attrs: { rel: "preload", href: assetBase + face.fileName, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" }];
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
  plugins: [plainSubheadline, react(), offlineShell, preloadReadingFace],
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
  build: {
    target: "es2022", sourcemap: false,
    // React, the router and React Query change far less often than the app: in a chunk of their
    // own they stay cached across deploys. Only libraries the first paint needs go here.
    rollupOptions: { output: { manualChunks(id) {
      if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|@tanstack[\\/](query-core|react-query))[\\/]/.test(id)) return "vendor";
    } } },
  },
});
