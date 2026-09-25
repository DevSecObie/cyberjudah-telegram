import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@shared": new URL("../shared", import.meta.url).pathname,
    },
  },
  server: { port: 5173, allowedHosts: true },
  build: { target: "es2022", sourcemap: false },
});
