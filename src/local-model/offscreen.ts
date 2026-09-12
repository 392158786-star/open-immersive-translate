import {
  env,
  pipeline,
  type TextGenerationPipeline,
  type TranslationPipeline,
} from "@huggingface/transformers";
import browser from "webextension-polyfill";

import type { AssistantRequest } from "../shared/k-assistant";
import { translationTokenLimit } from "./token-limit";

type LocalDevice = "auto" | "webgpu" | "wasm";
type LocalDtype = "q4" | "q4f16" | "fp16" | "q8" | "int8";

interface LocalRequest {
  localModelRequest?: boolean;
  action: "status" | "load" | "translate" | "complete";
  model?: string;
  target?: "translation" | "academic" | "all";
  device?: LocalDevice;
  dtype?: LocalDtype;
  texts?: string[];
  from?: string;
  to?: string;
  request?: AssistantRequest;
}

interface ProgressEvent {
  status?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
}

const progress = new Map<string, ProgressEvent>();
const translationPipelines = new Map<string, TranslationPipeline>();
const academicPipelines = new Map<string, TextGenerationPipeline>();
const loadingTranslation = new Map<
  string,
  Promise<TranslationPipeline | undefined>
>();
const loadingAcademic = new Map<
  string,
  Promise<TextGenerationPipeline | undefined>
>();

const LANGUAGE_CODES: Record<string, string> = {
  auto: "eng_Latn",
  en: "eng_Latn",
  "zh-CN": "zho_Hans",
  "zh-TW": "zho_Hant",
  ja: "jpn_Jpan",
  ko: "kor_Hang",
  fr: "fra_Latn",
  de: "deu_Latn",
  es: "spa_Latn",
  ru: "rus_Cyrl",
  pt: "por_Latn",
  it: "ita_Latn",
  ar: "arb_Arab",
  vi: "vie_Latn",
  th: "tha_Thai",
};

const M2M_LANGUAGE_CODES: Record<string, string> = {
  auto: "en",
  en: "en",
  "zh-CN": "zh",
  "zh-TW": "zh",
  ja: "ja",
  ko: "ko",
  fr: "fr",
  de: "de",
  es: "es",
  ru: "ru",
  pt: "pt",
  it: "it",
  ar: "ar",
  vi: "vi",
  th: "th",
};

function languageCode(
  model: string,
  language: string,
  target: boolean,
): string {
  const mapping = model.toLowerCase().includes("m2m100")
    ? M2M_LANGUAGE_CODES
    : LANGUAGE_CODES;
  const fallback = target ? "zh" : "en";
  return mapping[language] ?? mapping[language.split("-")[0] ?? ""] ?? fallback;
}

function selectedDevice(device: LocalDevice = "auto"): "webgpu" | "wasm" {
  if (device !== "auto") return device;
  const gpuAvailable =
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    navigator.gpu !== undefined;
  return gpuAvailable ? "webgpu" : "wasm";
}

function modelKey(
  model: string,
  device: LocalDevice,
  dtype: LocalDtype,
): string {
  return `${model}:${selectedDevice(device)}:${dtype}`;
}

function emitProgress(model: string): void {
  const event = progress.get(model) ?? {};
  void browser.runtime
    .sendMessage({
      type: "localModelProgress",
      model,
      progress: event.progress ?? 0,
      loaded: event.loaded ?? 0,
      total: event.total ?? 0,
      file: event.file,
      status: event.status ?? "loading",
    })
    .catch(() => undefined);
}

function progressCallback(model: string) {
  return (event: ProgressEvent): void => {
    progress.set(model, event);
    emitProgress(model);
  };
}

async function loadTranslation(
  model: string,
  device: LocalDevice,
  dtype: LocalDtype,
): Promise<TranslationPipeline | undefined> {
  const key = modelKey(model, device, dtype);
  const cached = translationPipelines.get(key);
  if (cached) return cached;
  const pending = loadingTranslation.get(key);
  if (pending) return pending;

  const load = async (targetDevice: "webgpu" | "wasm") =>
    pipeline("translation", model, {
      device: targetDevice,
      dtype,
      progress_callback: progressCallback(model),
    } as never);
  const loading = load(selectedDevice(device))
    .catch((error: unknown) => {
      if (selectedDevice(device) !== "webgpu") throw error;
      return load("wasm");
    })
    .then((instance) => {
      translationPipelines.set(key, instance as TranslationPipeline);
      progress.set(key, { status: "ready", progress: 100 });
      emitProgress(key);
      return translationPipelines.get(key);
    })
    .catch((error: unknown) => {
      progress.set(key, {
        status: error instanceof Error ? error.message : String(error),
      });
      emitProgress(key);
      return undefined;
    })
    .finally(() => loadingTranslation.delete(key));
  loadingTranslation.set(key, loading);
  return loading;
}

async function loadAcademic(
  model: string,
  device: LocalDevice,
  dtype: LocalDtype,
): Promise<TextGenerationPipeline | undefined> {
  const key = modelKey(model, device, dtype);
  const cached = academicPipelines.get(key);
  if (cached) return cached;
  const pending = loadingAcademic.get(key);
  if (pending) return pending;

  const load = async (targetDevice: "webgpu" | "wasm") =>
    pipeline("text-generation", model, {
      device: targetDevice,
      dtype,
      progress_callback: progressCallback(model),
    } as never);
  const loading = load(selectedDevice(device))
    .catch((error: unknown) => {
      if (selectedDevice(device) !== "webgpu") throw error;
      return load("wasm");
    })
    .then((instance) => {
      academicPipelines.set(key, instance as TextGenerationPipeline);
      progress.set(key, { status: "ready", progress: 100 });
      emitProgress(key);
      return academicPipelines.get(key);
    })
    .catch((error: unknown) => {
      progress.set(key, {
        status: error instanceof Error ? error.message : String(error),
      });
      emitProgress(key);
      return undefined;
    })
    .finally(() => loadingAcademic.delete(key));
  loadingAcademic.set(key, loading);
  return loading;
}

async function handle(request: LocalRequest): Promise<unknown> {
  const model = request.model ?? "";
  const device = request.device ?? "auto";
  const dtype = request.dtype ?? "q4";
  const key = modelKey(model, device, dtype);

  if (request.action === "status") {
    return {
      ok: true,
      host: "local-model",
      ready:
        translationPipelines.has(key) || academicPipelines.has(key),
      status: progress.get(key) ?? { status: "idle", progress: 0 },
    };
  }

  if (request.action === "load") {
    if (request.target === "academic") {
      void loadAcademic(model, device, dtype);
    } else if (request.target === "all") {
      void loadTranslation(model, device, dtype);
    } else {
      void loadTranslation(model, device, dtype);
    }
    return { ok: true, ready: translationPipelines.has(key) };
  }

  if (request.action === "translate") {
    const texts = request.texts ?? [];
    const instance =
      translationPipelines.get(key) ?? (await loadTranslation(model, device, dtype));
    if (!instance) {
      return {
        ok: false,
        ready: false,
        error:
          progress.get(key)?.status ?? "Local translation model failed to load.",
        status: progress.get(key),
      };
    }
    const source = languageCode(model, request.from ?? "auto", false);
    const target = languageCode(model, request.to ?? "zh-CN", true);
    const output = await instance(texts.length === 1 ? texts[0]! : texts, {
      src_lang: source,
      tgt_lang: target,
      max_new_tokens: translationTokenLimit(texts),
    });
    const rows = Array.isArray(output) ? output : [output];
    return {
      ok: true,
      ready: true,
      texts: rows.map((row) => {
        const value = row as { translation_text?: unknown };
        return typeof value.translation_text === "string"
          ? value.translation_text
          : "";
      }),
    };
  }

  if (request.action === "complete") {
    const instance =
      academicPipelines.get(key) ?? (await loadAcademic(model, device, dtype));
    if (!instance) {
      return {
        ok: false,
        ready: false,
        error:
          progress.get(key)?.status ?? "Local academic model failed to load.",
        status: progress.get(key),
      };
    }
    const assistant = request.request;
    if (!assistant) return { ok: false, ready: false, error: "Missing request." };
    const output = await instance(
      [
        {
          role: "system",
          content:
            assistant.instruction ||
            "你是中文学术助手。回答必须准确、简洁，并说明证据不足的情况。",
        },
        { role: "user", content: assistant.text },
      ],
      {
        max_new_tokens: 128,
        do_sample: false,
        return_full_text: false,
      },
    );
    const first = Array.isArray(output) ? output[0] : output;
    const generated = (
      first as {
        generated_text?: unknown;
      }
    )?.generated_text;
    const text = Array.isArray(generated)
      ? String(
          (generated.at(-1) as { content?: unknown } | undefined)?.content ??
            "",
        )
      : typeof generated === "string"
        ? generated
        : "";
    return { ok: true, ready: true, text };
  }

  return { ok: false, ready: false, error: "Unknown local model action." };
}

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.remoteHost = "https://hf-mirror.com";
env.remotePathTemplate = "{model}/resolve/{revision}/";
env.useBrowserCache = true;
const onnxBackend = (
  env.backends as unknown as {
    onnx?: {
      wasm?: {
        numThreads?: number;
        proxy?: boolean;
        wasmPaths?: string;
      };
    };
  }
).onnx;
if (onnxBackend?.wasm) {
  onnxBackend.wasm.numThreads = 1;
  onnxBackend.wasm.proxy = false;
  onnxBackend.wasm.wasmPaths = browser.runtime.getURL("ort/");
}

(
  browser.runtime.onMessage.addListener as (
    listener: (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => unknown,
  ) => void
)((message, _sender, sendResponse) => {
  if (
    typeof message !== "object" ||
    message === null ||
    !(message as LocalRequest).localModelRequest
  ) {
    return undefined;
  }
  void handle(message as LocalRequest)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        ready: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  return true;
});
