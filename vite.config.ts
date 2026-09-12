import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import manifest from "./src/manifest.ts";

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    rollupOptions: {
      input: {
        academic: fileURLToPath(
          new URL("./src/academic/index.html", import.meta.url),
        ),
        localModel: fileURLToPath(
          new URL("./src/local-model/index.html", import.meta.url),
        ),
        pdf: fileURLToPath(new URL("./src/pdf/index.html", import.meta.url)),
        subtitleFile: fileURLToPath(
          new URL("./src/subtitle-file/index.html", import.meta.url),
        ),
      },
    },
  },
});
