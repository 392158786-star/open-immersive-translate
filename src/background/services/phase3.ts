import type { ServiceConfig, ServiceKind } from "../../shared/types";
import { AliyunService } from "./aliyun";
import { AzureOpenAIService } from "./azure-openai";
import { AzureTranslatorService } from "./azure-translator";
import { BaiduService } from "./baidu";
import type { TranslationService } from "./base";
import { BingService } from "./bing";
import { CaiyunService } from "./caiyun";
import { DeepLService } from "./deepl";
import { GeminiService } from "./gemini";
import { NiuTransService } from "./niutrans";
import { OpenLService } from "./openl";
import { PapagoService } from "./papago";
import {
  createPresetService,
  getPreset,
  OPENAI_PROVIDER_PRESETS,
} from "./presets";
import { phase3Config } from "./service-config";
import { TencentService } from "./tencent";
import { TransmartService } from "./transmart";
import { VolcService } from "./volc";
import { YandexFreeService } from "./yandex-free";
import { YoudaoService } from "./youdao";
import { YoudaoFreeService } from "./youdao-free";

function withKind(
  service: TranslationService,
  kind: ServiceKind,
): TranslationService {
  Object.defineProperty(service, "kind", {
    value: kind,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  return service;
}

export function phase3Services(): TranslationService[] {
  const presets = OPENAI_PROVIDER_PRESETS.flatMap((preset) => {
    const service = createPresetService(preset.id);
    return service ? [service] : [];
  });
  return [
    new GeminiService(),
    new DeepLService(),
    new DeepLService({ id: "deepl-pro", name: "DeepL Pro", pro: true }),
    new BingService(),
    new AzureTranslatorService(),
    new VolcService(),
    new TencentService(),
    new BaiduService(),
    new YoudaoService(),
    new YoudaoFreeService(),
    new CaiyunService(),
    new AliyunService(),
    new PapagoService(),
    new YandexFreeService(),
    new TransmartService(),
    new NiuTransService(),
    new OpenLService(),
    new AzureOpenAIService(),
    ...presets,
  ];
}

/** Register all phase-3 adapters through one integration call. */
export function registerPhase3Services(
  register: (service: TranslationService) => void,
): void {
  for (const service of phase3Services()) register(service);
}

export function createPhase3Service(
  id: string,
  config: ServiceConfig,
): TranslationService | undefined {
  const settings = phase3Config(config);
  const kind = settings.kind;
  const common = {
    id,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    timeoutMs: settings.timeoutMs,
    maxBatchSize: settings.maxBatchSize,
    maxBatchChars: settings.maxBatchChars,
    rateLimit: settings.rateLimit,
    clientKey: "browser-edge-extension",
  };
  const preset = getPreset(id) ?? getPreset(kind);
  if (preset) {
    const presetService = createPresetService(preset.id, {
      ...common,
      id,
      model: settings.model,
      prompt: settings.prompt,
      promptSystem: settings.promptSystem,
      promptUser: settings.promptUser,
      headers: settings.headers,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      ignoreResRegexs: settings.ignoreResRegexs,
      stream: settings.stream,
    });
    if (presetService) return withKind(presetService, config.kind);
  }

  switch (kind) {
    case "gemini":
      return withKind(
        new GeminiService({
          ...common,
          model: settings.model,
          prompt: settings.prompt,
          promptSystem: settings.promptSystem,
          promptUser: settings.promptUser,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          ignoreResRegexs: settings.ignoreResRegexs,
          stream: settings.stream,
        }),
        config.kind,
      );
    case "deepl":
    case "deepl-pro":
      return withKind(
        new DeepLService({
          ...common,
          pro: kind === "deepl-pro",
          formality: settings.formality,
        }),
        config.kind,
      );
    case "bing":
      return withKind(new BingService(common), config.kind);
    case "azure":
    case "azure-translator":
      return withKind(
        new AzureTranslatorService({ ...common, region: settings.region }),
        config.kind,
      );
    case "volc":
      return withKind(
        new VolcService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
          region: settings.region,
        }),
        config.kind,
      );
    case "tencent":
      return withKind(
        new TencentService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
          region: settings.region,
        }),
        config.kind,
      );
    case "baidu":
      return withKind(
        new BaiduService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
        }),
        config.kind,
      );
    case "youdao":
      return withKind(
        new YoudaoService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
        }),
        config.kind,
      );
    case "youdao-free":
      return withKind(new YoudaoFreeService(common), config.kind);
    case "caiyun":
      return withKind(new CaiyunService(common), config.kind);
    case "aliyun":
      return withKind(
        new AliyunService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
          region: settings.region,
        }),
        config.kind,
      );
    case "papago":
      return withKind(
        new PapagoService({
          ...common,
          appId: settings.appId,
          secret: settings.secret,
        }),
        config.kind,
      );
    case "yandex-free":
      return withKind(new YandexFreeService(common), config.kind);
    case "transmart":
      return withKind(new TransmartService(common), config.kind);
    case "niu":
    case "niutrans":
      return withKind(new NiuTransService(common), config.kind);
    case "openl":
      return withKind(new OpenLService(common), config.kind);
    case "azure-openai":
      return withKind(
        new AzureOpenAIService({
          ...common,
          deployment: settings.deployment,
          apiVersion: settings.apiVersion,
          model: settings.model,
          prompt: settings.prompt,
          promptSystem: settings.promptSystem,
          promptUser: settings.promptUser,
          headers: settings.headers,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
          ignoreResRegexs: settings.ignoreResRegexs,
          stream: settings.stream,
        }),
        config.kind,
      );
    default:
      return undefined;
  }
}
