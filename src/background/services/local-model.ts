import type {
  LangCode,
  RateLimit,
  TranslateRequest,
} from "../../shared/types";
import type { AssistantRequest } from "../../shared/k-assistant";
import {
  DEFAULT_LOCAL_ACADEMIC_MODEL,
  DEFAULT_LOCAL_TRANSLATION_MODEL,
} from "../../shared/local-models";
import {
  BaseService,
  type ServiceTranslateResult,
  TranslateError,
} from "./base";
import { requestLocalModel } from "../local-model-host";
import { lookupLocalUiPhrase } from "../../shared/local-ui-phrases";

interface LocalModelResponse {
  ok?: boolean;
  ready?: boolean;
  error?: string;
  texts?: unknown;
  text?: unknown;
  status?: unknown;
}

export interface LocalModelServiceOptions {
  id?: string;
  name?: string;
  translationModel?: string;
  academicModel?: string;
  device?: "auto" | "webgpu" | "wasm";
  dtype?: "q4" | "q4f16" | "fp16" | "q8" | "int8";
  maxBatchSize?: number;
  maxBatchChars?: number;
  rateLimit?: Partial<RateLimit>;
}

/** Adapter that delegates to the offscreen Transformers.js model host. */
export class LocalModelService extends BaseService {
  readonly limited = true;
  readonly limitation =
    "The first request downloads and initializes the model in the background.";
  private readonly translationModel: string;
  private readonly academicModel: string;
  private readonly device: "auto" | "webgpu" | "wasm";
  private readonly dtype: "q4" | "q4f16" | "fp16" | "q8" | "int8";

  override supportsPair(from: LangCode, to: LangCode): boolean {
    if (
      this.translationModel.toLowerCase().includes("opus-mt-en-zh")
    ) {
      return (from === "auto" || from === "en") && to.startsWith("zh");
    }
    return super.supportsPair(from, to);
  }

  constructor(options: LocalModelServiceOptions = {}) {
    super({
      id: options.id ?? "local-model",
      name: options.name ?? "本地模型",
      maxBatchSize: options.maxBatchSize ?? 2,
      maxBatchChars: options.maxBatchChars ?? 6_000,
      rateLimit: {
        rps: options.rateLimit?.rps ?? 1,
        concurrency: options.rateLimit?.concurrency ?? 1,
      },
      placeholder: { open: "<b>", close: "</b>" },
    });
    this.translationModel =
      options.translationModel ?? DEFAULT_LOCAL_TRANSLATION_MODEL;
    this.academicModel =
      options.academicModel ?? DEFAULT_LOCAL_ACADEMIC_MODEL;
    this.device = options.device ?? "auto";
    this.dtype = options.dtype ?? "q4";
  }

  async translate(
    request: TranslateRequest,
    signal: AbortSignal,
  ): Promise<ServiceTranslateResult> {
    if (signal.aborted) throw new Error("Translation was cancelled.");

    const texts = new Array<string>(request.texts.length);
    const pending: Array<{ index: number; text: string }> = [];
    request.texts.forEach((text, index) => {
      const known = lookupLocalUiPhrase(text);
      if (known === undefined) pending.push({ index, text });
      else texts[index] = known;
    });

    if (pending.length) {
      const response = await requestLocalModel<LocalModelResponse>({
        action: "translate",
        model: this.translationModel,
        device: this.device,
        dtype: this.dtype,
        texts: pending.map(({ text }) => text),
        from: request.from,
        to: request.to,
      });
      if (response.error) {
        throw new TranslateError("invalid_config", response.error, {
          serviceId: this.id,
          retryable: false,
        });
      }
      if (!response.ready) {
        throw new TranslateError(
          "invalid_config",
          "Local translation model is still loading.",
          { serviceId: this.id, retryable: false },
        );
      }
      if (
        !Array.isArray(response.texts) ||
        response.texts.length !== pending.length ||
        response.texts.some((text) => typeof text !== "string")
      ) {
        throw new TranslateError(
          "parse",
          "Local model returned an invalid translation batch.",
          { serviceId: this.id, retryable: false },
        );
      }
      const translated = response.texts as string[];
      pending.forEach(({ index }, outputIndex) => {
        texts[index] = translated[outputIndex]!;
      });
    }

    return { texts };
  }

  async completePrompt(
    request: AssistantRequest,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) throw new Error("AI request was cancelled.");
    const response = await requestLocalModel<LocalModelResponse>({
      action: "complete",
      model: this.academicModel,
      device: this.device,
      dtype: this.dtype,
      request,
    });
    if (response.error) {
      throw new TranslateError("invalid_config", response.error, {
        serviceId: this.id,
        retryable: false,
      });
    }
    if (!response.ready || typeof response.text !== "string") {
      throw new TranslateError(
        "invalid_config",
        "Local academic model is still loading.",
        { serviceId: this.id, retryable: false },
      );
    }
    return response.text;
  }
}
