import { ClaudeService } from "./claude";
import { CloudService } from "./cloud";
import { CustomHttpService } from "./custom-http";
import { DeepLXService } from "./deeplx";
import { GoogleService } from "./google";
import { MyMemoryService } from "./mymemory";
import { LocalModelService } from "./local-model";
import { OpenAICompatibleService } from "./openai-compatible";
import { ChatgptOauthService } from "./chatgpt-oauth/service";
import { MockService } from "./mock";
import { TranslateError, type TranslationService } from "./base";
import type { ServiceConfig, ServiceKind } from "../../shared/types";
import { createPhase3Service, registerPhase3Services } from "./phase3";

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
export {
  getModels,
  serviceFields,
  type ServiceFieldDescriptor,
} from "./service-fields";
export { DEFAULT_PROMPTS } from "./prompts";
export { OPENAI_PROVIDER_PRESETS } from "./presets";

const services: TranslationService[] = [
  new OpenAICompatibleService(),
  new ChatgptOauthService(),
  new ClaudeService(),
  new GoogleService(),
  new MyMemoryService(),
  new LocalModelService(),
  new DeepLXService(),
  new CustomHttpService(),
  new CloudService(),
  new MockService(),
];

const servicesById = new Map(services.map((service) => [service.id, service]));

/** Return a registered service by stable id. */
export function getService(id: string): TranslationService | undefined {
  return servicesById.get(id);
}

/** Return all registered translation service adapters. */
export function listServices(): readonly TranslationService[] {
  return [...services];
}

/** Add phase-3 adapters to the registry. Safe to call more than once. */
export function initTranslationServices(): void {
  registerPhase3Services((service) => {
    if (servicesById.has(service.id)) return;
    services.push(service);
    servicesById.set(service.id, service);
  });
}

/** Build an adapter from persisted settings while preserving its configured id. */
export function createService(
  id: string,
  config: ServiceConfig,
): TranslationService {
  const phase3Service = createPhase3Service(id, config);
  if (phase3Service) return phase3Service;

  const common = {
    id,

    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    prompt: config.prompt,
    maxBatchSize: config.maxBatchSize,
    maxBatchChars: config.maxBatchChars,
    rateLimit: config.rateLimit,
    headers: config.headers,
    timeoutMs: config.timeoutMs,
    promptSystem: config.promptSystem,
    promptUser: config.promptUser,
    stream: config.stream,
  };

  switch (config.kind) {
    case "openai-compatible":
      return withKind(
        new OpenAICompatibleService({
          ...common,
          apiPath: config.apiPath,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          ignoreResRegexs: config.ignoreResRegexs,
        }),
        config.kind,
      );
    case "chatgpt":
      return withKind(
        new ChatgptOauthService({
          model: config.model,
          prompt: config.prompt,
          promptSystem: config.promptSystem,
          promptUser: config.promptUser,
          timeoutMs: config.timeoutMs,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
          ignoreResRegexs: config.ignoreResRegexs,
          reasoningEffort: config.reasoningEffort,
          reasoningEffortAssistant: config.reasoningEffortAssistant,
        }),
        config.kind,
      );
    case "claude":
      return withKind(
        new ClaudeService({
          ...common,
          apiPath: config.apiPath,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          ignoreResRegexs: config.ignoreResRegexs,
        }),
        config.kind,
      );
    case "google":
      return withKind(
        new GoogleService({
          id,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
          timeoutMs: config.timeoutMs,
        }),
        config.kind,
      );
    case "mymemory":
      return withKind(
        new MyMemoryService({
          id,
          email: config.apiKey,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
          timeoutMs: config.timeoutMs,
        }),
        config.kind,
      );
    case "local-model":
      return withKind(
        new LocalModelService({
          id,
          translationModel: config.model,
          academicModel: config.models?.[0],
          device: config.localDevice,
          dtype: config.localDtype,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
        }),
        config.kind,
      );
    case "deeplx":
      return withKind(new DeepLXService(common), config.kind);
    case "custom-http":
      return withKind(
        new CustomHttpService({
          ...common,
          url: config.baseUrl,
          method: config.method,
          requestBodyTemplate: config.requestBodyTemplate,
          responseJsonPath: config.responseJsonPath,
        }),
        config.kind,
      );
    case "cloud":
      return withKind(
        new CloudService({
          id,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          headers: config.headers,
          timeoutMs: config.timeoutMs,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
        }),
        config.kind,
      );
    case "mock":
      return withKind(
        new MockService({
          id,
          maxBatchSize: config.maxBatchSize,
          maxBatchChars: config.maxBatchChars,
          rateLimit: config.rateLimit,
        }),
        config.kind,
      );
    default:
      throw new TranslateError(
        "invalid_config",
        `Unknown translation service kind: ${String(config.kind)}.`,
        { serviceId: id, retryable: false },
      );
  }
}
