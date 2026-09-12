import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import { TranslationCache } from "../../src/background/cache";
import { TranslationScheduler } from "../../src/background/scheduler";
import type {
  ServiceTranslateResult,
  TranslationService,
} from "../../src/background/services/base";
import type { TranslateRequest } from "../../src/shared/types";

class EchoService implements TranslationService {
  readonly name = "echo";
  readonly placeholder = { open: "{", close: "}" };
  readonly maxBatchSize = 10;
  readonly maxBatchChars = 1_000;
  readonly rateLimit = { rps: 10_000, concurrency: 1 };

  constructor(
    readonly id: string,
    private readonly response: (
      request: TranslateRequest,
    ) => ServiceTranslateResult,
  ) {}

  async translate(
    request: TranslateRequest,
  ): Promise<ServiceTranslateResult> {
    return this.response(request);
  }
}

function cache(): TranslationCache {
  return new TranslationCache({ indexedDB: null });
}

describe("TranslationScheduler duplicate cleanup", () => {
  it("cleans every translated result before delivery and caching", async () => {
    const source =
      "The source sentence should not be echoed after its translation.";
    const service = new EchoService("echo", ({ texts }) => ({
      texts: texts.map(
        (text) => `${text} \u8fd9\u662f\u8bd1\u6587\u3002\u8fd9\u662f\u8bd1\u6587\u3002`,
      ),
    }));
    const scheduler = new TranslationScheduler({
      cache: cache(),
      services: [service],
    });
    const delivered: string[] = [];

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: source }],
      from: "en",
      to: "zh-CN",
      serviceId: "echo",
      removeDuplicateTranslations: true,
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual(["\u8fd9\u662f\u8bd1\u6587\u3002"]);

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: source }],
      from: "en",
      to: "zh-CN",
      serviceId: "echo",
      removeDuplicateTranslations: true,
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual([
      "\u8fd9\u662f\u8bd1\u6587\u3002",
      "\u8fd9\u662f\u8bd1\u6587\u3002",
    ]);
  });

  it("keeps the configured term when duplicate-looking output contains it", async () => {
    const service = new EchoService("echo", () => ({
      texts: ["BRICS BRICS"],
    }));
    const scheduler = new TranslationScheduler({
      cache: cache(),
      services: [service],
    });
    const delivered: string[] = [];

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: "BRICS BRICS", protectedTerms: ["BRICS"] }],
      from: "en",
      to: "zh-CN",
      serviceId: "echo",
      removeDuplicateTranslations: true,
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual(["BRICS BRICS"]);
  });

  it("enables cleanup when an older caller omits the setting", async () => {
    const service = new EchoService("echo", () => ({
      texts: ["\u8fd9\u662f\u8bd1\u6587\u3002\u8fd9\u662f\u8bd1\u6587\u3002"],
    }));
    const scheduler = new TranslationScheduler({
      cache: cache(),
      services: [service],
    });
    const delivered: string[] = [];

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: "A source sentence." }],
      from: "en",
      to: "zh-CN",
      serviceId: "echo",
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual(["\u8fd9\u662f\u8bd1\u6587\u3002"]);
  });

  it("keeps the service output untouched when the setting is disabled", async () => {
    const service = new EchoService("echo", () => ({
      texts: ["\u8fd9\u662f\u8bd1\u6587\u3002\u8fd9\u662f\u8bd1\u6587\u3002"],
    }));
    const scheduler = new TranslationScheduler({
      cache: cache(),
      services: [service],
    });
    const delivered: string[] = [];

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: "A source sentence." }],
      from: "en",
      to: "zh-CN",
      serviceId: "echo",
      removeDuplicateTranslations: false,
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual([
      "\u8fd9\u662f\u8bd1\u6587\u3002\u8fd9\u662f\u8bd1\u6587\u3002",
    ]);
  });

  it("rejects corrupted output and uses the fallback service", async () => {
    const primary = new EchoService("primary", () => ({
      texts: ["________ corrupted output ________"],
    }));
    const fallback = new EchoService("fallback", () => ({
      texts: ["\u6b63\u5e38\u8bd1\u6587\u3002"],
    }));
    const scheduler = new TranslationScheduler({
      cache: cache(),
      services: [primary, fallback],
      fallbackServices: { primary: "fallback" },
    });
    const delivered: string[] = [];

    await scheduler.translateParagraphs({
      tabId: 1,
      items: [{ id: "a", text: "A normal source sentence." }],
      from: "en",
      to: "zh-CN",
      serviceId: "primary",
      translationIntegrityMode: true,
      onResult: (results) => {
        delivered.push(...results.map((result) => result.text ?? ""));
      },
    });

    expect(delivered).toEqual(["\u6b63\u5e38\u8bd1\u6587\u3002"]);
  });
});
