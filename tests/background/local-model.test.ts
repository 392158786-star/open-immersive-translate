import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import { LocalModelService } from "../../src/background/services/local-model";

describe("LocalModelService", () => {
  it("limits the default English-Chinese model to its supported pair", () => {
    const service = new LocalModelService({
      translationModel: "Xenova/opus-mt-en-zh",
    });

    expect(service.supportsPair("en", "zh-CN")).toBe(true);
    expect(service.supportsPair("auto", "zh-CN")).toBe(true);
    expect(service.supportsPair("ja", "zh-CN")).toBe(false);
    expect(service.supportsPair("en", "ja")).toBe(false);
  });

  it("uses stable Chinese wording for common website interface phrases", async () => {
    const service = new LocalModelService();
    const result = await service.translate(
      {
        texts: ["Explore content", "Log in", "Accept all cookies"],
        from: "en",
        to: "zh-CN",
      },
      new AbortController().signal,
    );

    expect(result.texts).toEqual([
      "探索内容",
      "登录",
      "接受全部 Cookie",
    ]);
  });
});
