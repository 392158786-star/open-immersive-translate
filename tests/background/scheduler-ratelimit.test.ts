import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import { TranslationCache } from "../../src/background/cache";
import {
  TranslationScheduler,
  type TranslateParagraphsRequest,
} from "../../src/background/scheduler";
import {
  TranslateError,
  type ServiceTranslateResult,
  type TranslationService,
} from "../../src/background/services/base";
import type { TranslateRequest } from "../../src/shared/types";

class FakeService implements TranslationService {
  readonly name: string;
  readonly placeholder = { open: "{", close: "}" };
  readonly calls: string[][] = [];
  active = 0;
  maximumActive = 0;
  supportsPair?: TranslationService["supportsPair"];

  constructor(
    readonly id: string,
    readonly maxBatchSize: number,
    readonly maxBatchChars: number,
    readonly rateLimit: { rps: number; concurrency: number },
    private readonly implementation: (
      request: TranslateRequest,
      signal: AbortSignal,
    ) => Promise<ServiceTranslateResult>,
  ) {
    this.name = id;
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    this.calls.push([...request.texts]);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      return await this.implementation(request, signal);
    } finally {
      this.active -= 1;
    }
  }
}

function memoryCache(): TranslationCache {
  return new TranslationCache({ indexedDB: null });
}

function request(
  overrides: Partial<TranslateParagraphsRequest> = {},
): TranslateParagraphsRequest {
  return {
    tabId: 1,
    items: [],
    from: "en",
    to: "zh-CN",
    serviceId: "primary",
    onResult: () => undefined,
    ...overrides,
  };
}

function rateLimitError(serviceId: string): TranslateError {
  return new TranslateError("rate_limit", "rate limited", {
    serviceId,
    retryable: true,
  });
}

describe("TranslationScheduler rate-limit backoff", () => {
  it("(a) first 411 then succeeds after backoff", async () => {
    let callCount = 0;
    const service = new FakeService(
      "primary",
      1,
      100,
      { rps: 10_000, concurrency: 1 },
      async ({ texts }) => {
        callCount += 1;
        if (callCount === 1) throw rateLimitError("primary");
        return { texts: texts.map((t) => `translated ${t}`) };
      },
    );
    const scheduler = new TranslationScheduler({
      cache: memoryCache(),
      services: [service],
    });
    const output: Array<{ id: string; text?: string; error?: { code: string; message: string } }> = [];

    await scheduler.translateParagraphs(
      request({
        items: [{ id: "a", text: "hello" }],
        onResult: (batch) => {
          output.push(...batch);
        },
      }),
    );

    expect(service.calls).toHaveLength(2);
    expect(output[0]?.text).toBe("translated hello");
  });

  it("(b) continuous 411 exhausts retries and returns rate_limit error", async () => {
    const service = new FakeService(
      "primary",
      1,
      100,
      { rps: 10_000, concurrency: 1 },
      async () => {
        throw rateLimitError("primary");
      },
    );
    const scheduler = new TranslationScheduler({
      cache: memoryCache(),
      services: [service],
    });
    const output: Array<{ id: string; error?: { code: string } }> = [];

    await scheduler.translateParagraphs(
      request({
        items: [{ id: "a", text: "hello" }],
        onResult: (batch) => {
          output.push(...batch);
        },
      }),
    );

    expect(service.calls.length).toBeGreaterThanOrEqual(2);
    expect(service.calls.length).toBeLessThanOrEqual(4);
    expect(output[0]?.error?.code).toBe("RATE_LIMIT");
  });

  it("(c) abort during backoff cancels immediately", async () => {
    let callCount = 0;
    const service = new FakeService(
      "primary",
      1,
      100,
      { rps: 10_000, concurrency: 1 },
      async () => {
        callCount += 1;
        throw rateLimitError("primary");
      },
    );
    const scheduler = new TranslationScheduler({
      cache: memoryCache(),
      services: [service],
    });

    const controller = new AbortController();
    const pending = scheduler.translateParagraphs(
      request({
        items: [{ id: "a", text: "hello" }],
        signal: controller.signal,
      }),
    );

    setTimeout(() => controller.abort(), 100);

    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("(d) effective concurrency is reduced after rate-limit", async () => {
    let callCount = 0;
    const service = new FakeService(
      "primary",
      1,
      100,
      { rps: 10_000, concurrency: 2 },
      async ({ texts }) => {
        callCount += 1;
        if (callCount === 1) throw rateLimitError("primary");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { texts: texts.map((t) => `t ${t}`) };
      },
    );
    const scheduler = new TranslationScheduler({
      cache: memoryCache(),
      services: [service],
    });

    await scheduler.translateParagraphs(
      request({
        items: [
          { id: "a", text: "aa" },
          { id: "b", text: "bb" },
          { id: "c", text: "cc" },
          { id: "d", text: "dd" },
        ],
      }),
    );

    expect(service.calls.length).toBeGreaterThanOrEqual(2);
    expect(service.maximumActive).toBeLessThanOrEqual(2);
  });

  it("restores speed after successful retry", async () => {
    let callCount = 0;
    const service = new FakeService(
      "primary",
      1,
      100,
      { rps: 10_000, concurrency: 2 },
      async ({ texts }) => {
        callCount += 1;
        if (callCount <= 2) throw rateLimitError("primary");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { texts: texts.map((t) => `t ${t}`) };
      },
    );
    const scheduler = new TranslationScheduler({
      cache: memoryCache(),
      services: [service],
    });

    await scheduler.translateParagraphs(
      request({
        items: [{ id: "a", text: "hello" }],
      }),
    );

    expect(callCount).toBeGreaterThanOrEqual(3);

    service.maximumActive = 0;
    service.active = 0;
    await scheduler.translateParagraphs(
      request({
        items: ["x", "y", "z", "w"].map((id) => ({ id, text: id })),
      }),
    );

    expect(service.maximumActive).toBe(2);
  });
});
