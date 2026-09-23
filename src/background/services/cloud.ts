import type { RateLimit, TranslateRequest } from "../../shared/types";
import {
  BaseService,
  type ServiceTranslateResult,
  TranslateError,
  fetchWithTimeout,
  mapWithConcurrency,
  parseJsonResponse,
  responseError,
} from "./base";

export interface CloudServiceOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBatchSize?: number;
  maxBatchChars?: number;
  rateLimit?: Partial<RateLimit>;
}

interface CloudTranslateResponse {
  targetText?: unknown;
}

/**
 * Optional adapter that delegates to the cloud-demo `/v1/translate` endpoint.
 * Failures throw retryable errors so the scheduler falls back to
 * `fallbackService` (e.g. youdao-free → transmart → local-model).
 */
export class CloudService extends BaseService {
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: CloudServiceOptions = {}) {
    super({
      id: options.id ?? "cloud",
      name: options.name ?? "Cloud",
      // 云端支持一次提交多段（批量接口），这也是它比免费公共接口快的主要原因。
      maxBatchSize: options.maxBatchSize ?? 20,
      maxBatchChars: options.maxBatchChars ?? 4_000,
      rateLimit: {
        rps: options.rateLimit?.rps ?? 5,
        concurrency: options.rateLimit?.concurrency ?? 4,
      },
      placeholder: { open: "{", close: "}" },
    });
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    if (!this.baseUrl) {
      throw new TranslateError(
        "invalid_config",
        "Cloud baseUrl is required.",
        { serviceId: this.id, retryable: false },
      );
    }
    const url = `${this.baseUrl.replace(/\/+$/, "")}/v1/translate`;
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.headers,
    };
    if (this.apiKey) {
      authHeaders.Authorization = `Bearer ${this.apiKey}`;
    }

    // 多段时走一次批量请求：云端再分别查 Redis/RDS 并对未命中段做一次模型调用。
    if (request.texts.length > 1) {
      const response = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            texts: [...request.texts],
            from: request.from,
            to: request.to,
          }),
        },
        signal,
        this.timeoutMs,
        this.id,
      );
      if (!response.ok) throw await responseError(response, this.id);
      const data = (await parseJsonResponse(response, this.id)) as {
        translations?: unknown;
        results?: unknown;
      };
      const batchTexts = Array.isArray(data.translations)
        ? data.translations
        : Array.isArray(data.results)
          ? (data.results as Array<{ targetText?: unknown }>).map(
              (item) => item?.targetText,
            )
          : undefined;
      if (
        !batchTexts ||
        batchTexts.length !== request.texts.length ||
        batchTexts.some((text) => typeof text !== "string")
      ) {
        throw new TranslateError(
          "parse",
          "Cloud batch response item count does not match the request.",
          { serviceId: this.id, retryable: false },
        );
      }
      return { texts: batchTexts as string[] };
    }

    const results = await mapWithConcurrency(
      request.texts,
      this.rateLimit.concurrency,
      async (text) => {
        const response = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              text,
              from: request.from,
              to: request.to,
            }),
          },
          signal,
          this.timeoutMs,
          this.id,
        );
        if (!response.ok) throw await responseError(response, this.id);
        const data = (await parseJsonResponse(
          response,
          this.id,
        )) as CloudTranslateResponse;
        if (typeof data.targetText !== "string") {
          throw new TranslateError(
            "parse",
            "Cloud response has no targetText.",
            { serviceId: this.id, retryable: false },
          );
        }
        return data.targetText;
      },
    );

    return { texts: results };
  }
}
