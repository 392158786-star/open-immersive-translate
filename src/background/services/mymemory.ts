import type { RateLimit, TranslateRequest } from "../../shared/types";
import { normalizeLang } from "../../shared/lang";
import {
  BaseService,
  type ServiceTranslateResult,
  TranslateError,
  fetchWithTimeout,
  mapWithConcurrency,
  parseJsonResponse,
  responseError,
} from "./base";

export interface MyMemoryServiceOptions {
  id?: string;
  name?: string;
  endpoint?: string;
  email?: string;
  timeoutMs?: number;
  maxBatchSize?: number;
  maxBatchChars?: number;
  maxQueryChars?: number;
  rateLimit?: Partial<RateLimit>;
}

interface MyMemoryResponse {
  responseData?: {
    translatedText?: unknown;
    detectedLanguage?: unknown;
  };
  responseStatus?: unknown;
  responseDetails?: unknown;
  quotaFinished?: unknown;
}

function myMemoryLang(code: string): string {
  if (code === "auto") return "Autodetect";
  if (code === "zh-CN") return "zh-CN";
  if (code === "zh-TW") return "zh-TW";
  return code;
}

function splitForQuery(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const boundaries = [
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    ].filter((index) => index >= Math.floor(maxChars * 0.55));
    const boundary = boundaries.length
      ? Math.max(...boundaries) + 1
      : maxChars;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

/**
 * No-key translation fallback that is reachable from more networks than
 * Google's endpoint. Anonymous use has a small daily quota; users can supply
 * a contact email to request the service's higher allowance.
 */
export class MyMemoryService extends BaseService {
  private readonly endpoint: string;
  private readonly email?: string;
  private readonly timeoutMs: number;
  private readonly maxQueryChars: number;

  constructor(options: MyMemoryServiceOptions = {}) {
    super({
      id: options.id ?? "mymemory",
      name: options.name ?? "MyMemory",
      maxBatchSize: options.maxBatchSize ?? 1,
      maxBatchChars: options.maxBatchChars ?? 450,
      rateLimit: {
        rps: options.rateLimit?.rps ?? 1,
        concurrency: options.rateLimit?.concurrency ?? 1,
      },
      placeholder: { open: "<b>", close: "</b>" },
    });
    this.endpoint =
      options.endpoint ?? "https://api.mymemory.translated.net/get";
    this.email = options.email?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxQueryChars = Math.min(
      500,
      Math.max(100, options.maxQueryChars ?? this.maxBatchChars),
    );
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    const results = await mapWithConcurrency(
      request.texts,
      this.rateLimit.concurrency,
      async (text) => {
        const chunks = splitForQuery(text, this.maxQueryChars);
        const translatedChunks: string[] = [];
        let detectedLanguage: string | undefined;
        for (const chunk of chunks) {
          const url = new URL(this.endpoint);
          url.searchParams.set("q", chunk);
          url.searchParams.set(
            "langpair",
            `${myMemoryLang(request.from)}|${myMemoryLang(request.to)}`,
          );
          if (this.email) url.searchParams.set("de", this.email);

          const response = await fetchWithTimeout(
            url.toString(),
            { method: "GET" },
            signal,
            this.timeoutMs,
            this.id,
          );
          if (!response.ok) throw await responseError(response, this.id);
          const data = (await parseJsonResponse(
            response,
            this.id,
          )) as MyMemoryResponse;
          const status = Number(data.responseStatus);
          if (
            data.quotaFinished === true ||
            status === 429 ||
            status === 403
          ) {
            throw new TranslateError(
              "rate_limit",
              "MyMemory's free daily quota or query limit was exceeded.",
              {
                serviceId: this.id,
                details: {
                  status,
                  ...(typeof data.responseDetails === "string"
                    ? { responseDetails: data.responseDetails }
                    : {}),
                },
              },
            );
          }
          if (status !== 200) {
            throw new TranslateError(
              "parse",
              `MyMemory returned status ${String(data.responseStatus ?? "unknown")}.`,
              {
                serviceId: this.id,
                retryable: false,
                details: {
                  status,
                  ...(typeof data.responseDetails === "string"
                    ? { responseDetails: data.responseDetails }
                    : {}),
                },
              },
            );
          }

          const translated = data.responseData?.translatedText;
          if (typeof translated !== "string" || (!translated && chunk)) {
            throw new TranslateError(
              "parse",
              "MyMemory response has no translation.",
              {
                serviceId: this.id,
                retryable: false,
              },
            );
          }
          translatedChunks.push(translated);
          if (
            !detectedLanguage &&
            typeof data.responseData?.detectedLanguage === "string"
          ) {
            detectedLanguage = data.responseData.detectedLanguage;
          }
        }
        const separator = request.to.startsWith("zh") ? "" : " ";
        return {
          text: translatedChunks.join(separator),
          detectedLanguage: detectedLanguage
            ? normalizeLang(detectedLanguage)
            : undefined,
        };
      },
    );

    const detectedLanguage = results.find(
      (result) => result.detectedLanguage,
    )?.detectedLanguage;
    return {
      texts: results.map((result) => result.text),
      ...(detectedLanguage ? { detectedLanguage } : {}),
    };
  }
}
