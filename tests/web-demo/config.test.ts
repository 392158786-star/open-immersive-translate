import { describe, expect, it } from "vitest";
import {
  resolveApiBaseUrl,
  readApiBaseUrlFromLocation,
  DEFAULT_CLOUD_API_BASE,
} from "../../src/web-demo/config";

describe("resolveApiBaseUrl", () => {
  it("returns URL param when valid", () => {
    expect(resolveApiBaseUrl("https://api.example.com", "https://build.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("falls back to build var when URL param is invalid", () => {
    expect(resolveApiBaseUrl("not-a-url", "https://build.example.com")).toBe(
      "https://build.example.com",
    );
  });

  it("falls back to build var when URL param is empty", () => {
    expect(resolveApiBaseUrl("", "https://build.example.com")).toBe(
      "https://build.example.com",
    );
  });

  it("falls back to build var when URL param is null", () => {
    expect(resolveApiBaseUrl(null, "https://build.example.com")).toBe(
      "https://build.example.com",
    );
  });

  it("falls back to default when both are invalid", () => {
    expect(resolveApiBaseUrl("bad", "also-bad")).toBe(DEFAULT_CLOUD_API_BASE);
  });

  it("falls back to default when both are empty", () => {
    expect(resolveApiBaseUrl("", "")).toBe(DEFAULT_CLOUD_API_BASE);
  });

  it("falls back to default when both are null", () => {
    expect(resolveApiBaseUrl(null, null)).toBe(DEFAULT_CLOUD_API_BASE);
  });

  it("trims whitespace from URL param", () => {
    expect(resolveApiBaseUrl("  https://api.example.com  ", null)).toBe(
      "https://api.example.com",
    );
  });

  it("trims whitespace from build var", () => {
    expect(resolveApiBaseUrl(null, "  https://build.example.com  ")).toBe(
      "https://build.example.com",
    );
  });

  it("default is http://localhost:8787", () => {
    expect(DEFAULT_CLOUD_API_BASE).toBe("http://localhost:8787");
  });
});

describe("readApiBaseUrlFromLocation", () => {
  it("reads ?api= from search string", () => {
    expect(readApiBaseUrlFromLocation("?api=https://cloud.example.com", null)).toBe(
      "https://cloud.example.com",
    );
  });

  it("falls back to build var when ?api= is absent", () => {
    expect(readApiBaseUrlFromLocation("", "https://build.example.com")).toBe(
      "https://build.example.com",
    );
  });

  it("falls back to default when neither is present", () => {
    expect(readApiBaseUrlFromLocation("", null)).toBe(DEFAULT_CLOUD_API_BASE);
  });

  it("handles multiple query params", () => {
    expect(
      readApiBaseUrlFromLocation("?foo=bar&api=https://cloud.example.com&baz=qux", null),
    ).toBe("https://cloud.example.com");
  });
});