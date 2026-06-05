import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import fs from "node:fs";
import { APP_VERSION } from "./src/version";

function emitVersionedHtml() {
  return {
    name: "emit-versioned-html",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      const src = path.join(outDir, "index.html");
      if (fs.existsSync(src)) {
        const dst = path.join(outDir, `lm-4z-init-${APP_VERSION}.html`);
        fs.copyFileSync(src, dst);
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), tsconfigPaths(), viteSingleFile(), emitVersionedHtml()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    host: "::",
    port: 8080,
  },
});
