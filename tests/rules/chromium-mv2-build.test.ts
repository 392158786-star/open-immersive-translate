import { describe, expect, it } from "vitest";

import { transformChromiumMv2Manifest } from "../../scripts/build-mv2";

describe("legacy Chromium MV2 manifest", () => {
  it("moves host permissions and uses a persistent background page", () => {
    const source = {
      manifest_version: 3,
      name: "test",
      version: "1.0.0",
      permissions: ["storage", "offscreen", "scripting", "sidePanel"],
      host_permissions: ["<all_urls>"],
      background: {
        service_worker: "src/background/worker.ts",
        type: "module",
      },
      action: { default_popup: "popup.html" },
      side_panel: { default_path: "sidepanel.html" },
      web_accessible_resources: [
        {
          resources: ["pdf.html", "assets/*"],
          matches: ["<all_urls>"],
        },
      ],
      content_security_policy: { extension_pages: "script-src 'self'" },
    };

    const transformed = transformChromiumMv2Manifest(source);

    expect(transformed.manifest_version).toBe(2);
    expect(transformed.permissions).toEqual([
      "storage",
      "<all_urls>",
      "webRequestBlocking",
    ]);
    expect(transformed.host_permissions).toBeUndefined();
    expect(transformed.background).toEqual({
      page: "background.html",
      persistent: true,
    });
    expect(transformed.browser_action).toEqual({
      default_popup: "popup.html",
    });
    expect(transformed).not.toHaveProperty("action");
    expect(transformed).not.toHaveProperty("side_panel");
    expect(transformed.web_accessible_resources).toEqual([
      "pdf.html",
      "assets/*",
    ]);
    expect(transformed.content_security_policy).toContain("wasm-unsafe-eval");
  });
});
