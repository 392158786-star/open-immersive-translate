import {
  cp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface ExtensionManifestLike {
  manifest_version: number;
  name: string;
  version: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function mv2Resources(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const resources = value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (!isRecord(entry)) return [];
    return stringArray(entry.resources) ?? [];
  });
  return [...new Set(resources)];
}

/** Convert the built MV3 compatibility manifest to a persistent MV2 package. */
export function transformChromiumMv2Manifest(
  manifest: ExtensionManifestLike,
): ExtensionManifestLike {
  const transformed: ExtensionManifestLike = {
    ...manifest,
    manifest_version: 2,
  };

  const permissions = new Set(stringArray(manifest.permissions) ?? []);
  for (const permission of stringArray(manifest.host_permissions) ?? []) {
    permissions.add(permission);
  }
  permissions.delete("offscreen");
  permissions.delete("scripting");
  permissions.delete("sidePanel");
  permissions.add("webRequestBlocking");
  transformed.permissions = [...permissions];
  delete transformed.host_permissions;

  transformed.background = {
    page: "background.html",
    persistent: true,
  };

  if (isRecord(manifest.action)) {
    transformed.browser_action = manifest.action;
  }
  delete transformed.action;
  delete transformed.side_panel;
  transformed.web_accessible_resources = mv2Resources(
    manifest.web_accessible_resources,
  );
  transformed.content_security_policy =
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";

  return transformed;
}

async function buildMv2(): Promise<void> {
  const root = process.cwd();
  const sourceDir = path.join(root, "dist-chromium-compat");
  const outputDir = path.join(root, "dist-chromium-mv2");

  await rm(outputDir, { recursive: true, force: true });
  await cp(sourceDir, outputDir, { recursive: true });

  const manifestPath = path.join(outputDir, "manifest.json");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ExtensionManifestLike;
  await writeFile(
    manifestPath,
    `${JSON.stringify(transformChromiumMv2Manifest(manifest), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(outputDir, "background.html"),
    [
      "<!doctype html>",
      '<html lang="zh-CN">',
      "  <head><meta charset=\"UTF-8\"><title>双语翻译助手后台</title></head>",
      "  <body><script type=\"module\" src=\"service-worker-loader.js\"></script></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await buildMv2();
}
