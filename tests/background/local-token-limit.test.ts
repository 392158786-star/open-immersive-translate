import { describe, expect, it } from "vitest";

import { translationTokenLimit } from "../../src/local-model/token-limit";

describe("local translation token limit", () => {
  it("scales with the longest source text and stays bounded", () => {
    expect(translationTokenLimit(["short text"])).toBe(64);
    expect(translationTokenLimit(["x".repeat(80)])).toBe(144);
    expect(translationTokenLimit(["x".repeat(500)])).toBe(256);
  });
});
