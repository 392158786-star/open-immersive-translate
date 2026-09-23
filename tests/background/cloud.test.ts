import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudService } from "../../src/background/services/cloud";
import { TranslateError } from "../../src/background/services/base";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CloudService", () => {
  it("posts each text to /v1/translate with Bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "req-1",
          sourceText: "Hello",
          targetText: "你好",
          cacheLayer: "upstream",
          latencyMs: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({
      baseUrl: "https://cloud.example/",
      apiKey: "test-token",
    });

    await expect(
      service.translate(
        { texts: ["Hello"], from: "en", to: "zh-CN" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ texts: ["你好"] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://cloud.example/v1/translate");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      text: "Hello",
      from: "en",
      to: "zh-CN",
    });
  });

  it("sends one batched request for multiple texts", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { texts: string[] };
      return new Response(
        JSON.stringify({
          results: body.texts.map((text) => ({
            targetText: `[zh] ${text}`,
          })),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({
      baseUrl: "https://cloud.example",
      apiKey: "tok",
    });

    const result = await service.translate(
      { texts: ["a", "b", "c"], from: "en", to: "zh-CN" },
      new AbortController().signal,
    );
    expect(result.texts).toEqual(["[zh] a", "[zh] b", "[zh] c"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string),
    ).toEqual({
      texts: ["a", "b", "c"],
      from: "en",
      to: "zh-CN",
    });
  });

  it("throws a parse error when batch response count does not match", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ targetText: "[zh] a" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({
      baseUrl: "https://cloud.example",
      apiKey: "tok",
    });

    await expect(
      service.translate(
        { texts: ["a", "b"], from: "en", to: "zh-CN" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("throws invalid_config when baseUrl is missing", async () => {
    const service = new CloudService({ apiKey: "tok" });
    await expect(
      service.translate(
        { texts: ["hi"], from: "en", to: "zh-CN" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(TranslateError);
  });

  it("throws on non-ok response so scheduler can fall back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({
      baseUrl: "https://cloud.example",
      apiKey: "bad",
    });

    await expect(
      service.translate(
        { texts: ["hi"], from: "en", to: "zh-CN" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(TranslateError);
  });

  it("throws parse error when targetText is missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: "r" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({
      baseUrl: "https://cloud.example",
      apiKey: "tok",
    });

    await expect(
      service.translate(
        { texts: ["hi"], from: "en", to: "zh-CN" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(TranslateError);
  });

  it("omits Authorization header when apiKey is not set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ targetText: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new CloudService({ baseUrl: "https://cloud.example" });

    await service.translate(
      { texts: ["hi"], from: "en", to: "zh-CN" },
      new AbortController().signal,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
