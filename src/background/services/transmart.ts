import type { LangCode, RateLimit, TranslateRequest } from "../../shared/types";
import {
  BaseService,
  type ServiceTranslateResult,
  TranslateError,
} from "./base";
import { LANGUAGE_MAPS } from "./language-pairs";
import { assertPair, fetchJson, supportsPair } from "./mt-utils";

export interface TransmartServiceOptions {
  id?: string;
  name?: string;
  baseUrl?: string;
  clientKey?: string;
  timeoutMs?: number;
  maxBatchSize?: number;
  maxBatchChars?: number;
  rateLimit?: Partial<RateLimit>;
}

interface TransmartResponse {
  auto_translation?: unknown;
  target?: { text_list?: unknown };
  message?: string;
}

const PLACEHOLDER_PATTERN = /\{\s*\/?\s*\d+\s*\}/g;

/**
 * 统计内联占位符个数（容忍 `{ 0 }` 这类带空格的写法）。
 * 只比较数量：译文里的占位符顺序可能变化，但数量必须一致，
 * 否则说明上游吞掉了内联元素，渲染会错位。
 */
function placeholderCount(text: string): number {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].length;
}

/** Tencent Transmart's public web endpoint; no stability guarantee is provided. */
export class TransmartService extends BaseService {
  readonly limited = true;
  readonly limitation =
    "Public web endpoint; may require site-side changes without notice.";
  private readonly baseUrl: string;
  private readonly clientKey: string;
  private readonly timeoutMs: number;

  constructor(options: TransmartServiceOptions = {}) {
    super({
      id: options.id ?? "transmart",
      name: options.name ?? "Transmart (limited)",
      maxBatchSize: options.maxBatchSize ?? 15,
      maxBatchChars: options.maxBatchChars ?? 2_500,
      rateLimit: {
        rps: options.rateLimit?.rps ?? 16,
        concurrency: options.rateLimit?.concurrency ?? 8,
      },
      placeholder: { open: "#", close: "#" },
    });
    this.baseUrl = options.baseUrl ?? "https://transmart.qq.com/api/imt";
    this.clientKey = options.clientKey ?? "browser-edge-extension";
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  override supportsPair(from: LangCode, to: LangCode): boolean {
    return supportsPair(from, to, LANGUAGE_MAPS.transmart);
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    if (!request.texts.length) return { texts: [] };
    const { from, to } = assertPair(request, LANGUAGE_MAPS.transmart, this.id);
    const data = (await fetchJson(
      this.baseUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          header: {
            fn: "auto_translation",
            client_key: this.clientKey,
            session: "",
          },
          type: "plain",
          model_category: "normal",
          source: { lang: from, text_list: request.texts },
          target: { lang: to },
        }),
      },
      signal,
      this.timeoutMs,
      this.id,
    )) as TransmartResponse;
    const values = data.target?.text_list ?? data.auto_translation;
    const texts = Array.isArray(values)
      ? values.map((value) =>
          typeof value === "string"
            ? value
            : ((value as { text?: unknown; translation?: unknown })
                ?.translation ?? (value as { text?: unknown })?.text),
        )
      : undefined;
    if (
      !texts ||
      texts.length !== request.texts.length ||
      texts.some((text) => typeof text !== "string")
    ) {
      throw new TranslateError(
        "parse",
        data.message ?? "Transmart response item count does not match.",
        {
          serviceId: this.id,
          retryable: false,
        },
      );
    }
    // 富文本占位符数量必须一致，否则内联元素会错位；顺序变化可以接受。
    const mismatches = request.texts.flatMap((source, index) => {
      const expected = placeholderCount(source);
      if (expected === 0) return [];
      const actual = placeholderCount(texts[index] as string);
      return actual === expected
        ? []
        : [`paragraph ${index + 1}: expected ${expected}, got ${actual}`];
    });
    if (mismatches.length > 0) {
      throw new TranslateError(
        "parse",
        `Transmart changed inline placeholder count (${mismatches.join("; ")}).`,
        { serviceId: this.id, retryable: false },
      );
    }
    return { texts: texts as string[] };
  }
}
