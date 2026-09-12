import { crx, type ManifestV3Export } from "@crxjs/vite-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig, type ConfigEnv } from "vite";

import chromeManifest from "./src/manifest.ts";

interface ExtensionManifestLike {
  manifest_version: number;
  name: string;
  version: string;
  [key: string]: unknown;
}

function stringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    return undefined;
  }
  return [...value];
}

/**
 * Domestic Chromium browsers often reject unknown permission names even when
 * they otherwise support the extension. Runtime code falls back to an
 * extension host tab and a normal side-panel page when these APIs are absent.
 */
export function transformChromiumCompatManifest(
  manifest: ExtensionManifestLike,
): ExtensionManifestLike {
  const transformed = { ...manifest };
  delete transformed.side_panel;

  for (const key of ["permissions", "optional_permissions"] as const) {
    const permissions = stringArray(transformed[key]);
    if (!permissions) continue;
    transformed[key] = permissions.filter(
      (permission) => permission !== "offscreen" && permission !== "sidePanel",
    );
  }

  return transformed;
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
      outDir: "dist-chromium-compat",
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
