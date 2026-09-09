import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Stamped into the bundle so a tab left open across an upgrade can notice. */
const appVersion = JSON.parse(readFileSync(path.resolve(here, "package.json"), "utf8")).version;

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      "@": path.resolve(here, "src"),
    },
  },
  server: {
    port: 5273,
    proxy: {
      "/api": { target: "http://localhost:4800", changeOrigin: true },
      "/live": { target: "ws://localhost:4800", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
