import browser from "webextension-polyfill";

import { loadConfig } from "../shared/config";
import type { AssistantRequest } from "../shared/k-assistant";
import type {
  AcademicSource,
  AcademicTermKnowledge,
  Config,
  ServiceConfig,
  ServiceKind,
} from "../shared/types";
import { createService } from "./services";

const CACHE_KEY = "academicKnowledgeCache";
const SEARCH_TIMEOUT_MS = 8_000;
const LOCAL_TECHNICAL_TRANSLATIONS: Record<string, string> = {
  api: "应用程序编程接口",
  "artificial intelligence": "人工智能",
  brics: "金砖国家",
  css: "层叠样式表",
  eu: "欧盟",
  dom: "文档对象模型",
  ecmascript: "ECMAScript 标准",
  fyp: "五年规划",
  "global south": "全球南方",
  html: "超文本标记语言",
  http: "超文本传输协议",
  javascript: "一种脚本语言",
  nato: "北大西洋公约组织",
  "node.js": "Node.js 运行时",
  typescript: "TypeScript 语言",
  url: "统一资源定位符",
  "world bank": "世界银行",
  xml: "可扩展标记语言",
};
const AI_KINDS = new Set<ServiceKind>([
  "openai-compatible",
  "chatgpt",
  "claude",
  "gemini",
  "azure-openai",
  "local-model",
]);

interface AcademicResolveInput {
  term: string;
  context: string;
  title?: string;
  url?: string;
  domain?: string;
  service?: string;
}

interface CacheEntry {
  expiresAt: number;
  knowledge: AcademicTermKnowledge;
}

type Cache = Record<string, CacheEntry>;

function normalizeTerm(term: string): string {
  return term.trim().replace(/\s+/g, " ");
}

function termId(term: string): string {
  return normalizeTerm(term)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function clip(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > max
    ? `${normalized.slice(0, max).trimEnd()}...`
    : normalized;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function authors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const author = stringValue(entry.author);
    const name = stringValue(entry.name);
    const displayName = stringValue(entry.display_name);
    return [author ?? name ?? displayName].filter(
      (item): item is string => Boolean(item),
    );
  });
}

async function fetchJson(url: string): Promise<unknown | undefined> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

function openAlexAbstract(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const positions: Array<{ position: number; word: string }> = [];
  for (const [word, rawPositions] of Object.entries(value)) {
    if (!Array.isArray(rawPositions)) continue;
    for (const position of rawPositions) {
      if (typeof position === "number") positions.push({ position, word });
    }
  }
  if (!positions.length) return undefined;
  return positions
    .sort((left, right) => left.position - right.position)
    .slice(0, 90)
    .map((item) => item.word)
    .join(" ");
}

async function searchOpenAlex(term: string): Promise<AcademicSource[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", term);
  url.searchParams.set("per-page", "5");
  const data = await fetchJson(url.toString());
  if (!isRecord(data) || !Array.isArray(data.results)) return [];

  return data.results.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const title = stringValue(entry.display_name);
    const id = stringValue(entry.id);
    if (!title || !id) return [];
    const primary = isRecord(entry.primary_location)
      ? entry.primary_location
      : undefined;
    const venueContainer = isRecord(primary?.source)
      ? primary.source
      : undefined;
    const snippet = openAlexAbstract(entry.abstract_inverted_index);
    return [
      {
        id: `openalex:${id}:${index}`,
        title,
        url: stringValue(entry.doi) ?? id,
        source: "openalex" as const,
        year: numberValue(entry.publication_year),
        authors: authors(entry.authorships).slice(0, 6),
        venue: stringValue(venueContainer?.display_name),
        snippet: snippet ? clip(snippet, 500) : undefined,
      },
    ];
  });
}

async function searchCrossref(term: string): Promise<AcademicSource[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", term);
  url.searchParams.set("rows", "5");
  const data = await fetchJson(url.toString());
  if (!isRecord(data) || !isRecord(data.message)) return [];
  const items = data.message.items;
  if (!Array.isArray(items)) return [];

  return items.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const title = Array.isArray(entry.title)
      ? stringValue(entry.title[0])
      : undefined;
    const doi = stringValue(entry.DOI);
    const urlValue = stringValue(entry.URL);
    if (!title || (!doi && !urlValue)) return [];
    const published = isRecord(entry.published)
      ? entry.published["date-parts"]
      : undefined;
    const year =
      Array.isArray(published) &&
      Array.isArray(published[0]) &&
      typeof published[0][0] === "number"
        ? published[0][0]
        : undefined;
    const container = Array.isArray(entry["container-title"])
      ? stringValue(entry["container-title"][0])
      : undefined;
    const abstract = stringValue(entry.abstract);
    return [
      {
        id: `crossref:${doi ?? urlValue}:${index}`,
        title,
        url: doi ? `https://doi.org/${doi}` : (urlValue as string),
        source: "crossref" as const,
        year,
        authors: authors(entry.author).slice(0, 6),
        venue: container,
        snippet: abstract ? clip(stripHtml(abstract), 500) : undefined,
      },
    ];
  });
}

async function searchSemanticScholar(term: string): Promise<AcademicSource[]> {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", term);
  url.searchParams.set("limit", "5");
  url.searchParams.set(
    "fields",
    "title,abstract,year,url,venue,authors",
  );
  const data = await fetchJson(url.toString());
  if (!isRecord(data) || !Array.isArray(data.data)) return [];

  return data.data.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const title = stringValue(entry.title);
    const urlValue = stringValue(entry.url);
    if (!title || !urlValue) return [];
    const abstract = stringValue(entry.abstract);
    return [
      {
        id: `semantic-scholar:${urlValue}:${index}`,
        title,
        url: urlValue,
        source: "semantic-scholar" as const,
        year: numberValue(entry.year),
        authors: authors(entry.authors).slice(0, 6),
        venue: stringValue(entry.venue),
        snippet: abstract ? clip(abstract, 500) : undefined,
      },
    ];
  });
}

async function searchAcademicSources(
  term: string,
  config: Config,
): Promise<AcademicSource[]> {
  const requests: Array<Promise<AcademicSource[]>> = [];
  if (config.academic.searchSources.includes("openalex")) {
    requests.push(searchOpenAlex(term));
  }
  if (config.academic.searchSources.includes("crossref")) {
    requests.push(searchCrossref(term));
  }
  if (config.academic.searchSources.includes("semantic-scholar")) {
    requests.push(searchSemanticScholar(term));
  }
  const groups = await Promise.all(requests);
  const seen = new Set<string>();
  return groups
    .flat()
    .filter((source) => {
      const key = source.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function firstAiService(config: Config, preferred?: string): string | undefined {
  const preferredConfig = preferred ? config.services[preferred] : undefined;
  if (preferredConfig?.enabled && AI_KINDS.has(preferredConfig.kind)) {
    return preferred;
  }
  const candidates = Object.entries(config.services).filter(
    ([, service]) => service.enabled && AI_KINDS.has(service.kind),
  );
  return (
    candidates.find(([, service]) => service.kind !== "local-model")?.[0] ??
    candidates.find(([, service]) => service.kind === "local-model")?.[0]
  );
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

async function translateFallback(
  term: string,
  config: Config,
): Promise<string> {
  const seen = new Set<string>();
  let serviceId: string | undefined = config.service;
  while (serviceId && !seen.has(serviceId)) {
    seen.add(serviceId);
    const serviceConfig: ServiceConfig | undefined =
      config.services[serviceId];
    if (!serviceConfig || serviceConfig.enabled === false) {
      serviceId = serviceConfig?.fallbackService;
      continue;
    }
    try {
      const service = createService(serviceId, serviceConfig);
      const result = await service.translate(
        {
          texts: [term],
          from: config.sourceLanguage,
          to: config.targetLanguage,
          context: { title: term },
        },
        new AbortController().signal,
      );
      const translated = result.texts[0]?.trim() ?? "";
      if (translated) return translated;
    } catch {
      // Try the configured fallback service.
    }
    serviceId = serviceConfig.fallbackService;
  }
  return "";
}

async function resolveWithAi(
  input: AcademicResolveInput,
  config: Config,
  sources: AcademicSource[],
): Promise<Partial<AcademicTermKnowledge> | undefined> {
  const serviceId = firstAiService(config, input.service);
  if (!serviceId) return undefined;
  const serviceConfig = config.services[serviceId];
  if (!serviceConfig) return undefined;
  const service = createService(serviceId, serviceConfig);
  if (!service.completePrompt) return undefined;

  const prompt = [
    `Domain: ${input.domain ?? "unspecified"}`,
    "你是中文学术术语助手。请严格结合给定上下文和检索结果，判断术语在本文中的含义。",
    `术语：${input.term}`,
    `文章标题：${input.title ?? "未提供"}`,
    `上下文：${clip(input.context, 2200) || "未提供"}`,
    `公开文献结果：${JSON.stringify(
      sources.map((source) => ({
        title: source.title,
        year: source.year,
        venue: source.venue,
        snippet: source.snippet,
        url: source.url,
      })),
    )}`,
    "只返回 JSON，不要 Markdown：",
    '{"translation":"当前语境中的中文译名","definition":"中文定义","domain":"学科或领域","partOfSpeech":"词性","aliases":["别名"],"summary":"结合上下文和文献的一句话总结","confidence":0.0}',
    "confidence 范围为 0 到 1。若证据不足，降低 confidence，不得编造文献内容。",
  ].join("\n");
  const request: AssistantRequest = {
    kind: "dictionary",
    service: serviceId,
    text: prompt,
    instruction: "严格输出可解析 JSON，不使用代码块。",
  };
  try {
    const response = await service.completePrompt(
      request,
      new AbortController().signal,
    );
    const parsed = extractJson(response);
    if (!parsed) return undefined;
    return {
      translation: stringValue(parsed.translation) ?? "",
      definition: stringValue(parsed.definition) ?? "",
      domain: stringValue(parsed.domain) ?? "",
      partOfSpeech: stringValue(parsed.partOfSpeech) ?? "",
      aliases: stringArray(parsed.aliases),
      summary: stringValue(parsed.summary) ?? "",
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.6,
    };
  } catch {
    return undefined;
  }
}

async function readCache(): Promise<Cache> {
  const stored = await browser.storage.local.get(CACHE_KEY);
  const value = stored[CACHE_KEY];
  return isRecord(value) ? (value as Cache) : {};
}

async function writeCache(cache: Cache): Promise<void> {
  const entries = Object.entries(cache)
    .sort(([, left], [, right]) => right.knowledge.updatedAt - left.knowledge.updatedAt)
    .slice(0, 120);
  await browser.storage.local.set({ [CACHE_KEY]: Object.fromEntries(entries) });
}

export async function getAcademicKnowledge(
  term: string,
  options: {
    refresh?: boolean;
    context?: string;
    title?: string;
    url?: string;
    domain?: string;
    service?: string;
  } = {},
): Promise<AcademicTermKnowledge | undefined> {
  const normalized = normalizeTerm(term);
  if (!normalized) return undefined;
  const id = termId(normalized);
  const config = await loadConfig();
  const cache = await readCache();
  const cached = cache[id];
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.knowledge;
  }

  const hasAiService = firstAiService(config, options.service) !== undefined;
  const sources = hasAiService
    ? await searchAcademicSources(normalized, config)
    : [];
  const ai = hasAiService
    ? await resolveWithAi(
        {
          term: normalized,
          context: options.context ?? "",
          title: options.title,
          url: options.url,
          domain: options.domain,
          service: options.service,
        },
        config,
        sources,
      )
    : undefined;
  const fallbackTranslationText = ai?.translation
    ? ai.translation
    : (LOCAL_TECHNICAL_TRANSLATIONS[normalized.toLowerCase()] ??
      (await translateFallback(normalized, config)));
  if (
    !fallbackTranslationText ||
    fallbackTranslationText.toLowerCase() === normalized.toLowerCase()
  ) {
    return undefined;
  }
  const firstSnippet = sources.find((source) => source.snippet)?.snippet;
  const knowledge: AcademicTermKnowledge = {
    id,
    term: normalized,
    translation: fallbackTranslationText,
    definition:
      ai?.definition ||
      (firstSnippet
        ? `检索到相关文献，但未配置学术 AI，仅显示公开摘要：${firstSnippet}`
        : "未配置学术 AI，暂时无法进行上下文语义分析。"),
    domain: ai?.domain || "未确定",
    partOfSpeech: ai?.partOfSpeech ?? "",
    aliases: ai?.aliases ?? [],
    summary:
      ai?.summary ||
      (sources.length
        ? `公开学术检索返回 ${sources.length} 条相关结果。`
        : "暂时没有找到可靠的公开学术来源。"),
    confidence: ai?.confidence ?? (sources.length ? 0.35 : 0.15),
    sources,
    contexts: options.context ? [clip(options.context, 1000)] : [],
    updatedAt: Date.now(),
  };
  const previousContexts = cached?.knowledge.contexts ?? [];
  knowledge.contexts = [
    ...new Set([...knowledge.contexts, ...previousContexts]),
  ].slice(0, 8);
  cache[id] = {
    knowledge,
    expiresAt: Date.now() + config.academic.cacheDays * 24 * 60 * 60 * 1000,
  };
  await writeCache(cache);
  return knowledge;
}

export async function openAcademicKnowledge(term: string): Promise<boolean> {
  const normalized = normalizeTerm(term);
  if (!normalized) return false;
  const url = new URL(browser.runtime.getURL("src/academic/index.html"));
  url.searchParams.set("term", normalized);
  await browser.tabs.create({ url: url.toString() });
  return true;
}
