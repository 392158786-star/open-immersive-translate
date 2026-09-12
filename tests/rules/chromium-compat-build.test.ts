import { describe, expect, it } from "vitest";

import { transformChromiumCompatManifest } from "../../vite.chromium-compat.config";

describe("Chromium compatibility manifest", () => {
  it("removes permissions rejected by domestic Chromium browsers", () => {
    const source = {
      manifest_version: 3,
      name: "test",
      version: "1.0.0",
      permissions: [
        "storage",
        "offscreen",
        "tabs",
        "sidePanel",
        "webRequest",
      ],
      optional_permissions: ["offscreen"],
      side_panel: { default_path: "src/ui/sidepanel/index.html" },
    };

    const transformed = transformChromiumCompatManifest(source);

    expect(transformed.permissions).toEqual([
      "storage",
      "tabs",
      "webRequest",
    ]);
    expect(transformed.optional_permissions).toEqual([]);
    expect(transformed).not.toHaveProperty("side_panel");
    expect(source.permissions).toContain("offscreen");
  });
});
