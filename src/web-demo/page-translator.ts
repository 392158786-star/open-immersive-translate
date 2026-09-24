import type {
  Paragraph,
  ReadingMode,
  Rule,
  LangCode,
} from "../shared/types";
import { extractParagraphs } from "../content/extract/scanner";
import {
  detectPageLanguage,
  detectTextLanguage,
} from "../content/extract/language";
import { findMainContent } from "../content/extract/main-area";
import { decode } from "../content/extract/placeholder";
import {
  renderTranslation,
  removeTranslation,
  removeAll,
  setReadingMode,
  injectStyles,
  setLoading,
  markTranslated,
  isTranslated,
  type RenderTranslationOptions,
} from "../content/render/inject";
import { observeMutations } from "../content/observe/mutation";
import {
  detectAcademicTerms,
  protectAcademicTerms,
  restoreAcademicTerms,
} from "../content/academic/terms";
import { translateText, type CloudDemoConfig, type TranslationMetadata } from "./translator";

export type PageTranslationMode = ReadingMode;

export interface ParagraphTranslationResult {
  paragraphId: string;
  sourceText: string;
  translatedText: string;
  meta: TranslationMetadata;
  terms: string[];
}

export interface PageTranslationReport {
  pageLanguage: LangCode;
  mainContentSelector: string;
  paragraphCount: number;
  results: ParagraphTranslationResult[];
  totalLatencyMs: number;
  cacheLayers: string[];
  fallbackCount: number;
}

const DEFAULT_RULE: Rule = {
  matches: ["*"],
  selectors: ["p", "h1", "h2", "h3", "h4", "li", "blockquote", "td", "article"],
  paragraphMinTextCount: 2,
  enableRichTranslate: true,
};

const PLACEHOLDER_STYLE = { open: "{", close: "}" } as const;

function buildRenderOptions(
  mode: PageTranslationMode,
  theme: string,
  terms: string[],
): RenderTranslationOptions {
  return {
    mode: mode === "quick" ? "translation" : "dual",
    readingMode: mode,
    theme,
    wrapperTag: "font",
    prefix: "smart",
    academicTerms: terms.length > 0 ? terms : undefined,
  };
}

export function createDefaultRule(): Rule {
  return { ...DEFAULT_RULE };
}

export function scanPage(root: Document | Element, rule?: Rule): {
  mainArea: Element | null;
  paragraphs: Paragraph[];
  pageLanguage: LangCode;
} {
  const effectiveRule = rule ?? DEFAULT_RULE;
  const mainArea = findMainContent(root);
  const scanRoot = mainArea ?? (root instanceof Document ? root.body ?? root.documentElement : root);
  const paragraphs = extractParagraphs(scanRoot, effectiveRule);
  const doc = root instanceof Document ? root : root.ownerDocument;
  // Sample the translated scope instead of the whole window: a demo page can
  // host Chinese chrome around an English article, which would otherwise make
  // the source language look identical to the target language.
  const sampleText = (scanRoot.textContent ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
  const detected = detectTextLanguage(sampleText);
  const pageLanguage =
    detected === "auto" && doc ? detectPageLanguage(doc) : detected;
  return { mainArea, paragraphs, pageLanguage };
}

export async function translateParagraph(
  paragraph: Paragraph,
  from: LangCode,
  to: LangCode,
  config: CloudDemoConfig,
  mode: PageTranslationMode,
  theme: string,
  signal?: AbortSignal,
): Promise<ParagraphTranslationResult> {
  const terms = detectAcademicTerms(paragraph.text);
  const { text: protectedText } = protectAcademicTerms(paragraph.text);

  setLoading(paragraph);

  const output = await translateText(protectedText, from, to, config, signal);
  const restoredText = restoreAcademicTerms(output.text, terms);

  const fragment = decode(restoredText, paragraph.placeholders, PLACEHOLDER_STYLE);

  const renderOpts = buildRenderOptions(mode, theme, terms);
  renderTranslation(paragraph, fragment, renderOpts);
  markTranslated(paragraph.container, paragraph.id);

  return {
    paragraphId: paragraph.id,
    sourceText: paragraph.text,
    translatedText: restoredText,
    meta: output.meta,
    terms,
  };
}

export async function translatePage(
  root: Document | Element,
  from: LangCode,
  to: LangCode,
  config: CloudDemoConfig,
  mode: PageTranslationMode,
  theme = "none",
  rule?: Rule,
  signal?: AbortSignal,
): Promise<PageTranslationReport> {
  const { mainArea, paragraphs, pageLanguage } = scanPage(root, rule);

  if (root instanceof Document) {
    injectStyles(root);
  }

  const results: ParagraphTranslationResult[] = [];
  let totalLatencyMs = 0;
  let fallbackCount = 0;
  const cacheLayers = new Set<string>();

  for (const paragraph of paragraphs) {
    if (signal?.aborted) break;
    if (isTranslated(paragraph.container)) continue;

    try {
      const result = await translateParagraph(
        paragraph,
        from === "auto" ? pageLanguage : from,
        to,
        config,
        mode,
        theme,
        signal,
      );
      results.push(result);
      totalLatencyMs += result.meta.latencyMs;
      if (result.meta.fallbackUsed) fallbackCount++;
      cacheLayers.add(result.meta.cacheLayer);
    } catch {
      removeTranslation(paragraph);
    }
  }

  return {
    pageLanguage,
    mainContentSelector: mainArea?.tagName ?? "",
    paragraphCount: paragraphs.length,
    results,
    totalLatencyMs,
    cacheLayers: [...cacheLayers],
    fallbackCount,
  };
}

export function switchMode(
  root: Document | Element,
  mode: PageTranslationMode,
): void {
  setReadingMode(root, mode);
}

export function observeDynamicContent(
  root: Node,
  onChanged: (nodes: Node[]) => void,
): () => void {
  return observeMutations(root, onChanged, {
    debounceMs: 200,
    excludeSelectors: ["[data-imt]", ".imt-target", ".imt-loading", ".imt-error"],
  });
}

export function injectPageStyles(root: Document | ShadowRoot): void {
  injectStyles(root);
}

export function clearPageTranslations(root: Document | Element): void {
  removeAll(root);
}

export function isParagraphTranslated(container: Element): boolean {
  return isTranslated(container);
}

export { detectAcademicTerms, protectAcademicTerms, restoreAcademicTerms };
