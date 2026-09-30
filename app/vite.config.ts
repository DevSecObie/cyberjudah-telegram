import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
