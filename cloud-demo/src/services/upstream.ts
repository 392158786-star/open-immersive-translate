import type { UpstreamConfig } from "../config.ts";

export interface UpstreamTranslateInput {
  texts: readonly string[];
  from: string;
  to: string;
}

/** Translation provider contract used by the orchestrator. */
export interface TranslationUpstream {
  readonly id: string;
  translate(
    input: UpstreamTranslateInput,
    signal?: AbortSignal,
  ): Promise<string[]>;
}

export const MOCK_UPSTREAM_ID = "mock";
export const HTTP_UPSTREAM_ID = "http";

/**
 * Deterministic offline translation used by the demo and tests.
 * The marker makes it obvious that no third-party provider was called.
 */
export function mockTranslate(text: string, from: string, to: string): string {
  if (text.length === 0) return text;
  return `[${from}->${to}] ${text}`;
}

export class MockUpstream implements TranslationUpstream {
  readonly id: string = MOCK_UPSTREAM_ID;

  async translate(input: UpstreamTranslateInput): Promise<string[]> {
    return input.texts.map((text) => mockTranslate(text, input.from, input.to));
  }
}

/** Injection point that keeps the HTTP upstream testable without a network. */
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpUpstreamOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

interface HttpUpstreamPayload {
  translations?: unknown;
}

/** Configurable HTTP upstream kept ready for a real provider. */
export class HttpUpstream implements TranslationUpstream {
  readonly id: string = HTTP_UPSTREAM_ID;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: HttpUpstreamOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async translate(
    input: UpstreamTranslateInput,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal =
      signal === undefined
        ? timeoutSignal
        : AbortSignal.any([signal, timeoutSignal]);

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey !== undefined) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/translate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        texts: [...input.texts],
        from: input.from,
        to: input.to,
      }),
      signal: requestSignal,
    });

    if (!response.ok) {
      throw new Error(`上游翻译服务返回 HTTP ${response.status}。`);
    }

    const payload = (await response.json()) as HttpUpstreamPayload;
    const translations = payload.translations;
    if (
      !Array.isArray(translations) ||
      translations.some((item) => typeof item !== "string")
    ) {
      throw new Error("上游翻译服务返回的 translations 字段无效。");
    }
    if (translations.length !== input.texts.length) {
      throw new Error("上游翻译服务返回的译文数量与请求不一致。");
    }
    return translations as string[];
  }
}

/** Build the upstream selected by validated configuration. */
export function createUpstream(config: UpstreamConfig): TranslationUpstream {
  if (config.kind === HTTP_UPSTREAM_ID) {
    if (config.baseUrl === undefined) {
      throw new Error("UPSTREAM_KIND=http 时必须提供 UPSTREAM_BASE_URL。");
    }
    return new HttpUpstream({
      baseUrl: config.baseUrl,
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
      timeoutMs: config.timeoutMs,
    });
  }
  return new MockUpstream();
}