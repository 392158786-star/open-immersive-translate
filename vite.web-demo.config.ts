import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web-demo",
  base: "./",
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  build: {
    outDir: "../../dist-web-demo",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html",
    },
  },
});
