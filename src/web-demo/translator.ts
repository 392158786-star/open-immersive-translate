import type { LangCode } from "../shared/types";
import { detectLang } from "../shared/lang";
import { removeDuplicateTranslation } from "../shared/deduplicate";
import {
  detectAcademicTerms,
  protectAcademicTerms,
  restoreAcademicTerms,
} from "../content/academic/terms";
import { splitTranslationText } from "../content/controller/translation-segments";
import { MockService } from "../background/services/mock";
import { CloudService } from "../background/services/cloud";
import type { TranslationService } from "../background/services/base";
import {
  parseSrt,
  parseWebVtt,
  serializeSrt,
  serializeWebVtt,
} from "../content/features/subtitle/parsers";
import type { SubtitleCue } from "../shared/subtitle-types";

export interface CloudDemoConfig {
  baseUrl: string;
  apiKey: string;
}

export interface TranslationMetadata {
  requestId: string;
  cacheLayer: string;
  latencyMs: number;
  serviceUsed: string;
  fallbackUsed: boolean;
  error?: string;
}

export interface TranslationOutput {
  text: string;
  meta: TranslationMetadata;
}

export interface HealthReport {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  checks: {
    api: { status: string };
    rds: { status: string; latencyMs?: number; detail?: string };
    redis: { status: string; latencyMs?: number; detail?: string };
  };
}

export interface StatsReport {
  totalMemory: number;
  totalHits: number;
  totalRequests: number;
  redisHits: number;
  rdsHits: number;
  upstreamRequests: number;
}

export interface AcademicTermResult {
  terms: string[];
  protectedText: string;
}

export interface SubtitleTranslationResult {
  cues: SubtitleCue[];
  translatedCues: SubtitleCue[];
  serialized: string;
  meta: TranslationMetadata;
}

function buildHeaders(config: CloudDemoConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  return headers;
}

async function fetchHealth(
  config: CloudDemoConfig,
): Promise<HealthReport | null> {
  try {
    const resp = await fetch(`${config.baseUrl}/health`);
    if (!resp.ok) return null;
    return (await resp.json()) as HealthReport;
  } catch {
    return null;
  }
}

async function fetchStats(
  config: CloudDemoConfig,
): Promise<StatsReport | null> {
  try {
    const resp = await fetch(`${config.baseUrl}/v1/stats`, {
      headers: buildHeaders(config),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as StatsReport;
  } catch {
    return null;
  }
}

async function translateViaCloud(
  text: string,
  from: string,
  to: string,
  config: CloudDemoConfig,
  signal?: AbortSignal,
): Promise<TranslationOutput> {
  const resp = await fetch(`${config.baseUrl}/v1/translate`, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({ text, from, to }),
    signal,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${body}`);
  }
  const data = (await resp.json()) as {
    requestId: string;
    targetText: string;
    cacheLayer: string;
    latencyMs: number;
  };
  return {
    text: data.targetText,
    meta: {
      requestId: data.requestId,
      cacheLayer: data.cacheLayer,
      latencyMs: data.latencyMs,
      serviceUsed: "cloud",
      fallbackUsed: false,
    },
  };
}

async function translateViaFallback(
  text: string,
  from: LangCode,
  to: LangCode,
  signal?: AbortSignal,
): Promise<TranslationOutput> {
  const mock = new MockService();
  const result = await mock.translate(
    { texts: [text], from, to },
    signal ?? new AbortController().signal,
  );
  return {
    text: result.texts[0] ?? "",
    meta: {
      requestId: "fallback",
      cacheLayer: "disabled",
      latencyMs: 0,
      serviceUsed: "mock",
      fallbackUsed: true,
    },
  };
}

export async function translateText(
  text: string,
  from: LangCode,
  to: LangCode,
  config: CloudDemoConfig,
  signal?: AbortSignal,
): Promise<TranslationOutput> {
  if (!text.trim()) {
    return {
      text: "",
      meta: {
        requestId: "",
        cacheLayer: "none",
        latencyMs: 0,
        serviceUsed: "none",
        fallbackUsed: false,
      },
    };
  }
  try {
    return await translateViaCloud(text, from, to, config, signal);
  } catch (err) {
    const fallback = await translateViaFallback(text, from, to, signal);
    return {
      ...fallback,
      meta: {
        ...fallback.meta,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

export function detectLanguage(text: string): LangCode {
  return detectLang(text);
}

export function detectTerms(text: string): AcademicTermResult {
  const terms = detectAcademicTerms(text);
  const { text: protectedText } = protectAcademicTerms(text);
  return { terms, protectedText };
}

export function restoreTerms(
  text: string,
  terms: string[],
): string {
  return restoreAcademicTerms(text, terms);
}

export function segmentText(text: string, maxChars = 480): string[] {
  return splitTranslationText(text, maxChars);
}

export function deduplicateTranslation(
  source: string,
  translation: string,
  terms: string[] = [],
): string {
  return removeDuplicateTranslation(source, translation, terms);
}

export function parseSubtitleContent(
  content: string,
  format: "srt" | "vtt",
): SubtitleCue[] {
  return format === "srt" ? parseSrt(content) : parseWebVtt(content);
}

export function serializeSubtitle(
  cues: SubtitleCue[],
  format: "srt" | "vtt",
): string {
  return format === "srt" ? serializeSrt(cues) : serializeWebVtt(cues);
}

export async function translateSubtitle(
  content: string,
  format: "srt" | "vtt",
  from: LangCode,
  to: LangCode,
  config: CloudDemoConfig,
): Promise<SubtitleTranslationResult> {
  const cues = parseSubtitleContent(content, format);
  const translatedCues: SubtitleCue[] = [];
  for (const cue of cues) {
    const result = await translateText(cue.text, from, to, config);
    translatedCues.push({ ...cue, text: result.text });
  }
  const serialized = serializeSubtitle(translatedCues, format);
  return {
    cues,
    translatedCues,
    serialized,
    meta: {
      requestId: "batch",
      cacheLayer: "mixed",
      latencyMs: 0,
      serviceUsed: "cloud+fallback",
      fallbackUsed: translatedCues.some((_, i) => i >= 0),
    },
  };
}

export function createCloudService(config: CloudDemoConfig): TranslationService {
  return new CloudService({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });
}

export function createFallbackService(): TranslationService {
  return new MockService();
}

export async function checkHealth(
  config: CloudDemoConfig,
): Promise<HealthReport | null> {
  return fetchHealth(config);
}

export async function getStats(
  config: CloudDemoConfig,
): Promise<StatsReport | null> {
  return fetchStats(config);
}