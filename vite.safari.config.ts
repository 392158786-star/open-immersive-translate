import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig, type ConfigEnv } from "vite";

import chromeManifest from "./src/manifest.ts";
import { transformChromiumCompatManifest } from "./vite.chromium-compat.config.ts";

interface ExtensionManifestLike {
  manifest_version: number;
  name: string;
  version: string;
  [key: string]: unknown;
}

async function resolveChromeManifest(
  env: ConfigEnv,
): Promise<ExtensionManifestLike> {
  const resolved = await (typeof chromeManifest === "function"
    ? chromeManifest(env)
    : chromeManifest);
  return resolved as unknown as ExtensionManifestLike;
}

export default defineConfig(async (env) => {
  const sourceManifest = await resolveChromeManifest(env);
  const manifest = transformChromiumCompatManifest(sourceManifest);

  return {
    plugins: [
      crx({
        browser: "chrome",
        manifest: manifest as unknown as ManifestV3Export,
      }),
    ],
    build: {
      outDir: "dist-safari",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          academic: fileURLToPath(
            new URL("./src/academic/index.html", import.meta.url),
          ),
          localModel: fileURLToPath(
            new URL("./src/local-model/index.html", import.meta.url),
          ),
          pdf: fileURLToPath(
            new URL("./src/pdf/index.html", import.meta.url),
          ),
          sidePanel: fileURLToPath(
            new URL("./src/ui/sidepanel/index.html", import.meta.url),
          ),
          subtitleFile: fileURLToPath(
            new URL("./src/subtitle-file/index.html", import.meta.url),
          ),
        },
      },
    },
  };
});
