import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    outDir: "dist-web-demo",
    rollupOptions: {
      input: "src/web-demo/index.html",
    },
  },
});