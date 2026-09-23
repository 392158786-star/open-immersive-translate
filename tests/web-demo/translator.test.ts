import { afterEach, describe, expect, it, vi } from "vitest";
import {
  translateText,
  detectLanguage,
  detectTerms,
  segmentText,
  deduplicateTranslation,
  parseSubtitleContent,
  serializeSubtitle,
  createCloudService,
  createFallbackService,
  type CloudDemoConfig,
} from "../../src/web-demo/translator";

afterEach(() => {
  vi.unstubAllGlobals();
});

const config: CloudDemoConfig = {
  baseUrl: "http://localhost:8787",
  apiKey: "test-token",
};

describe("translateText", () => {
  it("returns cloud translation with cache layer metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "req-1",
            sourceText: "hello",
            targetText: "你好",
            cacheLayer: "redis",
            latencyMs: 3,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const result = await translateText("hello", "en", "zh-CN", config);
    expect(result.text).toBe("你好");
    expect(result.meta.cacheLayer).toBe("redis");
    expect(result.meta.latencyMs).toBe(3);
    expect(result.meta.serviceUsed).toBe("cloud");
    expect(result.meta.fallbackUsed).toBe(false);
  });

  it("falls back to mock service when cloud is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );
    const result = await translateText("hello", "en", "zh-CN", config);
    expect(result.meta.fallbackUsed).toBe(true);
    expect(result.meta.serviceUsed).toBe("mock");
    expect(result.meta.error).toContain("Connection refused");
  });

  it("falls back when cloud returns non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const result = await translateText("hello", "en", "zh-CN", config);
    expect(result.meta.fallbackUsed).toBe(true);
  });

  it("returns empty result for empty input", async () => {
    const result = await translateText("", "en", "zh-CN", config);
    expect(result.text).toBe("");
    expect(result.meta.serviceUsed).toBe("none");
  });
});

describe("detectLanguage", () => {
  it("detects English text", () => {
    expect(detectLanguage("Hello world, this is English text.")).toBe("en");
  });

  it("detects Chinese text", () => {
    expect(detectLanguage("你好世界，这是中文文本。")).toBe("zh-CN");
  });
});

describe("detectTerms", () => {
  it("detects academic terms in text", () => {
    const result = detectTerms("The BRICS nations are exploring AI alternatives.");
    expect(result.terms.length).toBeGreaterThan(0);
    expect(result.terms).toContain("BRICS");
    expect(result.protectedText).not.toContain("BRICS");
  });

  it("returns empty terms for plain text", () => {
    const result = detectTerms("This is a simple sentence about cats and dogs.");
    expect(result.terms.length).toBe(0);
  });
});

describe("segmentText", () => {
  it("splits text into segments", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const segments = segmentText(text);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.join("")).toContain("First");
  });
});

describe("deduplicateTranslation", () => {
  it("removes duplicate content from translation", () => {
    const result = deduplicateTranslation("hello world", "你好世界 你好世界", []);
    expect(typeof result).toBe("string");
  });
});

describe("subtitle parsing", () => {
  it("parses and serializes SRT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello\n\n";
    const cues = parseSubtitleContent(srt, "srt");
    expect(cues.length).toBe(1);
    expect(cues[0].text).toBe("Hello");
    const serialized = serializeSubtitle(cues, "srt");
    expect(serialized).toContain("Hello");
  });

  it("parses WebVTT", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello\n";
    const cues = parseSubtitleContent(vtt, "vtt");
    expect(cues.length).toBe(1);
  });
});

describe("service factories", () => {
  it("creates a CloudService with config", () => {
    const service = createCloudService(config);
    expect(service.id).toBe("cloud");
    expect(service.maxBatchSize).toBe(20);
  });

  it("creates a MockService as fallback", () => {
    const service = createFallbackService();
    expect(service.id).toBe("mock");
    expect(service.maxBatchSize).toBe(100);
  });
});
