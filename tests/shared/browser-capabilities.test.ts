import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  permissions: ["offscreen", "sidePanel"] as string[],
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      getManifest: () => ({ permissions: runtime.permissions }),
    },
  },
}));

import {
  supportsNativeSidePanel,
  supportsOffscreenDocuments,
} from "../../src/shared/browser-capabilities";

afterEach(() => {
  runtime.permissions = ["offscreen", "sidePanel"];
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe("browser capability detection", () => {
  it("requires both permission and API support", () => {
    (globalThis as { chrome?: unknown }).chrome = {
      offscreen: { createDocument: vi.fn() },
      sidePanel: { open: vi.fn() },
    };

    expect(supportsOffscreenDocuments()).toBe(true);
    expect(supportsNativeSidePanel()).toBe(true);

    runtime.permissions = ["storage"];
    expect(supportsOffscreenDocuments()).toBe(false);
    expect(supportsNativeSidePanel()).toBe(false);
  });

  it("reports unsupported when the native API is missing", () => {
    (globalThis as { chrome?: unknown }).chrome = {};

    expect(supportsOffscreenDocuments()).toBe(false);
    expect(supportsNativeSidePanel()).toBe(false);
  });
});
