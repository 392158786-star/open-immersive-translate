import type { LangCode, RateLimit, TranslateRequest } from "../../shared/types";
import {
  BaseService,
  type ServiceTranslateResult,
  TranslateError,
} from "./base";
import { LANGUAGE_MAPS } from "./language-pairs";
import {
  assertPair,
  fetchJson,
  supportsPair,
} from "./mt-utils";

export interface YoudaoFreeServiceOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxBatchSize?: number;
  maxBatchChars?: number;
  rateLimit?: Partial<RateLimit>;
}

interface YoudaoFreeResponse {
  errorCode?: string;
  translation?: unknown;
}

const BATCH_MARKER_PREFIX = "IMT_SEGMENT";

function batchMarker(texts: readonly string[]): string {
  let marker = `[[[${BATCH_MARKER_PREFIX}]]]`;
  let attempt = 0;
  while (texts.some((text) => text.includes(marker))) {
    attempt += 1;
    marker = `[[[${BATCH_MARKER_PREFIX}_${attempt}]]]`;
  }
  return marker;
}

function placeholderTokens(text: string): string[] {
  return text.match(/\{\/?\d+\}/g) ?? [];
}

function missingPlaceholders(source: string, translation: string): string[] {
  return placeholderTokens(source).filter(
    (token) => !translation.includes(token),
  );
}

/** Youdao's public web demo endpoint. It is fast but may change without notice. */
export class YoudaoFreeService extends BaseService {
  readonly limited = true;
  readonly limitation =
    "Public web demo endpoint; availability and quotas are not guaranteed. Free interface has frequency limits; large pages may be slow.";
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: YoudaoFreeServiceOptions = {}) {
    super({
      id: options.id ?? "youdao-free",
      name: options.name ?? "Youdao Free",
      maxBatchSize: options.maxBatchSize ?? 1,
      maxBatchChars: options.maxBatchChars ?? 700,
      rateLimit: {
        rps: options.rateLimit?.rps ?? 3,
        concurrency: options.rateLimit?.concurrency ?? 1,
      },
      placeholder: { open: "<b>", close: "</b>" },
    });
    this.baseUrl = options.baseUrl ?? "https://aidemo.youdao.com/trans";
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  override supportsPair(from: LangCode, to: LangCode): boolean {
    return supportsPair(from, to, LANGUAGE_MAPS.youdao);
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    if (!request.texts.length) return { texts: [] };
    const { from, to } = assertPair(request, LANGUAGE_MAPS.youdao, this.id);
    const marker = batchMarker(request.texts);
    const source =
      request.texts.length === 1
        ? request.texts[0]
        : request.texts.join(`\n${marker}\n`);
    const form = new URLSearchParams({
      q: source,
      from: from === "auto" ? "Auto" : from,
      to,
    });
    const data = (await fetchJson(
      this.baseUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      },
      signal,
      this.timeoutMs,
      this.id,
    )) as YoudaoFreeResponse;
    if (data.errorCode && data.errorCode !== "0") {
      const rateLimited = data.errorCode === "411";
      throw new TranslateError(
        rateLimited ? "rate_limit" : "parse",
        `Youdao Free returned error ${data.errorCode}.`,
        { serviceId: this.id, retryable: rateLimited },
      );
    }
    const translation = Array.isArray(data.translation)
      ? data.translation[0]
      : undefined;
    if (typeof translation !== "string" || !translation) {
      throw new TranslateError(
        "parse",
        "Youdao Free response has no translation.",
        { serviceId: this.id, retryable: false },
      );
    }
    const missing = missingPlaceholders(source, translation);
    if (missing.length) {
      throw new TranslateError(
        "parse",
        `Youdao Free omitted inline placeholders: ${missing.join(", ")}.`,
        { serviceId: this.id, retryable: false },
      );
    }
    if (request.texts.length === 1) return { texts: [translation] };

    const parts = translation.split(marker);
    if (
      parts.length !== request.texts.length ||
      parts.some((part) => !part.trim())
    ) {
      throw new TranslateError(
        "parse",
        "Youdao Free changed the paragraph separators.",
        { serviceId: this.id, retryable: false },
      );
    }
    return { texts: parts.map((part) => part.trim()) };
  }
}
