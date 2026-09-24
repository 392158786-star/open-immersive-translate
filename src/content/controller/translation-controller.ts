import type {
  AdvancedPageConfig,
  AdvancedPageRule,
  AdvancedParagraph,
  PageTranslationState,
} from "../../shared/j-types";
import {
  connectTranslatePort,
  sendToBackground,
  type ContentTranslatePort,
  type ParagraphTranslationResult,
  type TranslatePortMessage,
  type TranslateResultMessage,
} from "../../shared/messages";
import { normalizeLang } from "../../shared/lang";
import { lookupLocalUiPhrase } from "../../shared/local-ui-phrases";
import type {
  AcademicTermKnowledge,
  Config,
  Paragraph,
  ReadingMode,
  Rule,
  TranslationMode,
  TranslationPriority,
} from "../../shared/types";
import {
  detectPageLanguage,
  detectTextLanguage,
  isParagraphTargetLanguage,
} from "../extract/language";
import { findMainContent } from "../extract/main-area";
import { joinPreLikeTranslation, splitPreLikeText } from "../extract/pre-like";
import { extractParagraphs, extractTitle } from "../extract/scanner";
import { observeMutations } from "../observe/mutation";
import { translateImmediately } from "../observe/immediate";
import { observeViewport, type ViewportObserver } from "../observe/viewport";
import { decodePlaceholders } from "../extract/placeholder";
import {
  protectAcademicTerms,
  restoreAcademicTerms,
} from "../academic/terms";
import {
  captureRenderedScrollAnchor,
  injectStyles,
  markTranslated,
  removeAll as removeRenderedTranslations,
  removeTranslation,
  renderTranslation,
  restoreRenderedScrollAnchor,
  setScrollAnchorSuppression,
  setTranslationScrollActive,
  setMask as setRenderedMask,
  setReadingMode as setRenderedReadingMode,
} from "../render/inject";
import {
  installEditableTranslations,
  TranslationOverrideStore,
} from "./editable";
import {
  installDirectHoverTranslation,
  type HoverContextRequest,
} from "./hover-directly";
import { buildPageContext } from "./page-context";
import {
  removeDuplicateTranslation,
  translationLooksGarbled,
} from "../../shared/deduplicate";
import {
  splitTranslationSentences,
  splitTranslationText,
} from "./translation-segments";
import {
  glossaryForDomain,
  resolveTranslationMode,
  resolveTranslationTheme,
  shouldAutoTranslatePage,
} from "./patterns";
import { pageTranslationState } from "./page-state";
import type { PageControllerActions } from "./commands";

const PLACEHOLDER_STYLE = { open: "{", close: "}" } as const;
const RECONNECT_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
/** 段落翻译失败后的自动重试上限（普通模式）。 */
const MAX_AUTOMATIC_RETRIES = 3;
/** 完整性模式下允许更多重试，但必须同样有上限，避免页面永远停在“翻译中”。 */
const MAX_INTEGRITY_RETRIES = 5;
export const TRANSLATION_SESSION_ACTIVE_KEY = "imt-translation-session-active";
export const TRANSLATION_SESSION_MODE_KEY = "imt-translation-session-mode";
export const READING_SESSION_MODE_KEY = "imt-reading-session-mode";
interface PendingRequest {
  message: TranslatePortMessage;
  remaining: Set<string>;
  resolve(): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface TextWaiter {
  resolve(text: string): void;
  reject(error: Error): void;
}

interface ParagraphSegmentState {
  total: number;
  results: Map<number, ParagraphTranslationResult>;
}

interface SegmentTarget {
  paragraphId: string;
  index: number;
}

export interface TranslationControllerOptions {
  reportState?(state: PageTranslationState): void;
}

function isReadingMode(value: unknown): value is ReadingMode {
  return (
    value === "quick" || value === "professional" || value === "research"
  );
}

/** Owns page extraction, scheduling, rendering, runtime modes, and state. */
export class TranslationController implements PageControllerActions {
  config: AdvancedPageConfig;
  rule: AdvancedPageRule;

  private active = false;
  private scope: "main" | "whole";
  private immediate: boolean;
  private mask: boolean;
  private hoverDirectly: boolean;
  private readingMode: ReadingMode;
  private videoSubtitlePreTranslation: boolean;
  private runtimeService?: string;
  private runtimeMode?: TranslationMode;
  private runtimeReadingMode?: ReadingMode;
  private destroyed = false;
  private sequence = 0;
  private generation = 0;
  private pageLanguage = detectPageLanguage(document);
  private port?: ContentTranslatePort;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private viewport?: ViewportObserver;
  private stopMutation?: () => void;
  private stopScroll?: () => void;
  private scrollTimer?: ReturnType<typeof setTimeout>;
  private renderFlushTimer?: ReturnType<typeof setTimeout>;
  private stopEditing?: () => void;
  private stopDirectHover?: () => void;
  private scrollActive = false;
  private readonly paragraphs = new Map<string, AdvancedParagraph>();
  private readonly pendingIds = new Set<string>();
  private readonly renderedIds = new Set<string>();
  private readonly errorIds = new Set<string>();
  private readonly requests = new Map<string, PendingRequest>();
  private readonly textWaiters = new Map<string, TextWaiter>();
  private readonly paragraphSegments = new Map<
    string,
    ParagraphSegmentState
  >();
  private readonly segmentTargets = new Map<string, SegmentTarget>();
  private readonly cachedTranslations = new Map<string, string>();
  private readonly plainFallbackAttempted = new WeakSet<Element>();
  private readonly retryAttempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly retryBatchIds = new Set<string>();
  private retryBatchTimer?: ReturnType<typeof setTimeout>;
  private readonly secondaryAttempted = new Set<string>();
  private readonly secondaryBatchIds = new Set<string>();
  private secondaryBatchTimer?: ReturnType<typeof setTimeout>;
  private readonly deferredResults: ParagraphTranslationResult[] = [];
  /** 仅中文模式下被隐藏原文的段落，切回原文/双语时需要恢复。 */
  private readonly hiddenSources = new Set<Element>();
  private overrideStore = new TranslationOverrideStore(
    window.location.hostname,
  );
  private readonly reportState?: (state: PageTranslationState) => void;

  constructor(
    config: Config,
    rule: Rule,
    options: TranslationControllerOptions = {},
  ) {
    this.config = config as AdvancedPageConfig;
    this.rule = rule as AdvancedPageRule;
    try {
      const readingMode = window.sessionStorage.getItem(
        READING_SESSION_MODE_KEY,
      );
      if (isReadingMode(readingMode)) {
        this.config = { ...this.config, readingMode };
      }
      const sessionMode =
        window.sessionStorage.getItem(TRANSLATION_SESSION_MODE_KEY) ??
        window.localStorage.getItem(TRANSLATION_SESSION_MODE_KEY);
      if (sessionMode === "dual" || sessionMode === "translation") {
        this.config = { ...this.config, translationMode: sessionMode };
      }
    } catch {
      // Fall back to the persisted configuration.
    }
    this.scope = this.config.translateMainOnly === false ? "whole" : "main";
    this.immediate = this.config.translateToPageEndImmediately === true;
    this.mask = this.config.translationMask === true;
    this.readingMode = this.config.readingMode;
    this.hoverDirectly = this.readingMode !== "quick";
    this.videoSubtitlePreTranslation = this.config.subtitle.preTranslation;
    this.reportState = options.reportState;
    this.injectPageStyles();
    setRenderedMask(document, this.mask);
    this.connect();
    this.installMutationObserver();
    this.installScrollTranslation();
    this.installEditing();
    this.installDirectHover();
    this.emitState();
  }

  isTranslated(): boolean {
    return this.active;
  }

  shouldAutoTranslate(): boolean {
    try {
      if (
        window.sessionStorage.getItem(TRANSLATION_SESSION_ACTIVE_KEY) === "1" ||
        window.localStorage.getItem(TRANSLATION_SESSION_ACTIVE_KEY) === "1"
      ) {
        return true;
      }
    } catch {
      // Session storage may be unavailable on restricted pages.
    }
    return shouldAutoTranslatePage(
      this.config,
      this.rule,
      window.location.hostname,
      this.pageLanguage,
    );
  }

  toggleTranslate(scope: "main" | "whole" = this.scope): void {
    if (this.active) {
      this.setSessionAutoTranslate(false);
      this.removeAll();
    } else {
      this.setSessionAutoTranslate(true);
      this.start(scope);
    }
  }

  togglePage(): void {
    this.toggleTranslate(this.scope);
  }

  toggleWholePage(): void {
    this.toggleTranslate("whole");
  }

  toggleMainPage(): void {
    this.toggleTranslate("main");
  }

  start(scope: "main" | "whole" = this.scope): void {
    if (this.active || this.destroyed) return;
    this.active = true;
    this.scope = scope;
    setScrollAnchorSuppression(true);
    this.injectPageStyles();
    if (!this.immediate) {
      this.viewport = observeViewport([], (ids) => {
        void this.translateParagraphIds(ids, "viewport");
      });
    }
    void this.rescan();
  }

  setMode(mode: TranslationMode): void {
    this.setReadingMode(mode === "translation" ? "quick" : "professional");
  }

  setReadingMode(mode: ReadingMode): void {
    const translationMode: TranslationMode =
      mode === "quick" ? "translation" : "dual";
    this.runtimeReadingMode = mode;
    this.readingMode = mode;
    this.runtimeMode = translationMode;
    this.config = {
      ...this.config,
      readingMode: mode,
      translationMode,
      hoverTranslateDirectly: mode !== "quick",
    };
    this.hoverDirectly = mode !== "quick";
    try {
      window.sessionStorage.setItem(READING_SESSION_MODE_KEY, mode);
      window.sessionStorage.setItem(
        TRANSLATION_SESSION_MODE_KEY,
        translationMode,
      );
    } catch {
      // Mode still applies for the current document without session storage.
    }
    try {
      window.localStorage.setItem(READING_SESSION_MODE_KEY, mode);
      window.localStorage.setItem(
        TRANSLATION_SESSION_MODE_KEY,
        translationMode,
      );
    } catch {
      // Mode still applies for the current document without local storage.
    }
    void sendToBackground({
      type: "setConfig",
      patch: {
        readingMode: mode,
        translationMode,
        hoverTranslateDirectly: mode !== "quick",
      },
    }).catch(() => undefined);
    setRenderedReadingMode(document, mode);
    if (translationMode !== "translation") this.restoreHiddenSources();
    this.installDirectHover();
  }

  toggleOnlyTranslation(): void {
    this.setReadingMode(
      this.currentReadingMode() === "quick" ? "professional" : "quick",
    );
  }

  togglePageEndImmediately(): void {
    if (this.active && this.immediate) {
      this.setSessionAutoTranslate(false);
      this.removeAll();
      return;
    }
    this.immediate = true;
    this.viewport?.disconnect();
    this.viewport = undefined;
    if (!this.active) this.start(this.scope);
    else void this.translateAllPending();
  }

  toggleMask(): void {
    this.mask = !this.mask;
    setRenderedMask(document, this.mask);
  }

  toggleHoverDirectly(): void {
    this.setReadingMode(
      this.currentReadingMode() === "quick" ? "professional" : "quick",
    );
  }

  toggleVideoSubtitlePreTranslation(): void {
    this.videoSubtitlePreTranslation = !this.videoSubtitlePreTranslation;
    document.dispatchEvent(
      new CustomEvent("imt:video-subtitle-pretranslation", {
        detail: { enabled: this.videoSubtitlePreTranslation },
      }),
    );
  }

  translateWithService(serviceId: string): void {
    const scope = this.scope;
    this.removeAll();
    this.runtimeService = serviceId;
    this.start(scope);
  }

  update(config: Config, rule: Rule): void {
    const wasActive = this.active;
    const scope = this.scope;
    this.removeAll();
    this.config = config as AdvancedPageConfig;
    this.rule = rule as AdvancedPageRule;
    this.overrideStore = new TranslationOverrideStore(window.location.hostname);
    this.pageLanguage = detectPageLanguage(document);
    this.immediate = this.config.translateToPageEndImmediately === true;
    this.mask = this.config.translationMask === true;
    this.readingMode = this.config.readingMode;
    this.hoverDirectly = this.readingMode !== "quick";
    this.videoSubtitlePreTranslation = this.config.subtitle.preTranslation;
    this.runtimeMode = undefined;
    this.runtimeReadingMode = undefined;
    this.runtimeService = undefined;
    this.injectPageStyles();
    setRenderedMask(document, this.mask);
    this.installMutationObserver();
    this.installScrollTranslation();
    this.installEditing();
    this.installDirectHover();
    if (wasActive) this.start(scope);
  }

  async translateParagraph(container: Element): Promise<void> {
    const paragraph = extractParagraphs(container, this.extractionRule()).find(
      (candidate) => candidate.container === container,
    ) as AdvancedParagraph | undefined;
    if (!paragraph || !this.registerParagraph(paragraph)) return;
    const override = await this.overrideStore.get(paragraph.id);
    if (!this.paragraphs.has(paragraph.id)) return;
    if (override !== undefined) {
      this.renderText(paragraph, override, false);
      return;
    }
    await this.translateParagraphIds([paragraph.id], "interactive");
  }

  translateText(text: string, from: string, to: string): Promise<string> {
    return this.requestText(text, from, to, "interactive");
  }

  translateActiveInput(): void {
    const field = document.activeElement;
    if (!(
      field instanceof HTMLInputElement ||
      field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLElement && field.isContentEditable)
    ))
      return;
    const text =
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        ? field.value
        : (field.textContent ?? "");
    if (!text.trim()) return;
    void this.translateText(
      text,
      this.config.sourceLanguage,
      this.config.input.targetLanguage ?? this.config.targetLanguage,
    )
      .then((translation) => {
        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement
        ) {
          field.value = translation;
        } else {
          field.textContent = translation;
        }
        field.dispatchEvent(new InputEvent("input", { bubbles: true }));
      })
      .catch(() => undefined);
  }

  removeAll(): void {
    this.active = false;
    this.generation += 1;
    this.viewport?.disconnect();
    this.viewport = undefined;
    for (const [requestId, request] of this.requests) {
      clearTimeout(request.timeout);
      this.post({ type: "cancel", requestId });
      request.resolve();
      for (const id of request.remaining) {
        this.textWaiters.get(id)?.reject(new Error("Translation cancelled."));
        this.textWaiters.delete(id);
      }
    }
    this.requests.clear();
    this.paragraphSegments.clear();
    this.segmentTargets.clear();
    this.deferredResults.length = 0;
    this.restoreHiddenSources();
    if (this.renderFlushTimer !== undefined) {
      clearTimeout(this.renderFlushTimer);
      this.renderFlushTimer = undefined;
    }
    if (this.retryBatchTimer !== undefined) {
      clearTimeout(this.retryBatchTimer);
      this.retryBatchTimer = undefined;
    }
    if (this.secondaryBatchTimer !== undefined) {
      clearTimeout(this.secondaryBatchTimer);
      this.secondaryBatchTimer = undefined;
    }
    this.retryBatchIds.clear();
    this.secondaryBatchIds.clear();
    this.scrollActive = false;
    this.pendingIds.clear();
    this.renderedIds.clear();
    this.errorIds.clear();
    this.paragraphs.clear();
    removeRenderedTranslations(document);
    setScrollAnchorSuppression(false);
    this.injectPageStyles();
    setRenderedMask(document, this.mask);
    this.emitState();
  }

  destroy(): void {
    this.destroyed = true;
    this.removeAll();
    this.cachedTranslations.clear();
    this.stopMutation?.();
    this.stopScroll?.();
    if (this.scrollTimer !== undefined) clearTimeout(this.scrollTimer);
    setTranslationScrollActive(false);
    this.stopEditing?.();
    this.stopDirectHover?.();
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.port?.disconnect();
    this.port = undefined;
  }

  state(): PageTranslationState {
    return pageTranslationState({
      active: this.active,
      total: this.paragraphs.size,
      pending: this.pendingIds.size + this.deferredResults.length,
      translated: this.renderedIds.size,
      errors: this.errorIds.size,
    });
  }

  private extractionRule(): AdvancedPageRule {
    if (this.scope !== "whole") return this.rule;
    return {
      ...this.rule,
      selectors: [],
      // Transparent components are traversed by the scanner. Keep site
      // exclusions, but do not reject interactive navigation wholesale.
      excludeSelectors: (this.rule.excludeSelectors ?? []).filter(
        (selector) =>
          selector !== "nav" && selector !== "[role='navigation']",
      ),
      blockMinTextCount: Math.min(
        this.rule.blockMinTextCount ?? 24,
        2,
      ),
    };
  }

  private currentMode(): TranslationMode {
    return this.currentReadingMode() === "quick" ? "translation" : "dual";
  }

  private currentReadingMode(): ReadingMode {
    return (
      this.runtimeReadingMode ??
      this.config.readingMode ??
      (resolveTranslationMode(
        this.config,
        this.rule,
        window.location.href,
        this.pageLanguage,
      ) === "translation"
        ? "quick"
        : "professional")
    );
  }

  private currentTheme(): string {
    return resolveTranslationTheme(
      this.config,
      this.rule,
      window.location.href,
    );
  }

  private injectPageStyles(): void {
    injectStyles(
      document,
      [
        ...(this.rule.injectedCss ?? []),
        this.config.globalCustomCss ?? "",
      ].filter(Boolean),
    );
  }

  private installMutationObserver(): void {
    this.stopMutation?.();
    if (!document.body) return;
    this.stopMutation = observeMutations(
      document.body,
      () => {
        if (this.active) void this.rescan();
      },
      {
        debounceMs: 180,
        excludeSelectors: this.rule.mutationExcludeSelectors,
      },
    );
  }

  private setSessionAutoTranslate(active: boolean): void {
    try {
      window.sessionStorage.setItem(
        TRANSLATION_SESSION_ACTIVE_KEY,
        active ? "1" : "0",
      );
    } catch {
      // Session storage may be unavailable on restricted pages.
    }
    try {
      window.localStorage.setItem(
        TRANSLATION_SESSION_ACTIVE_KEY,
        active ? "1" : "0",
      );
    } catch {
      // Local storage may be unavailable on restricted pages.
    }
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.retryAttempts.clear();
    if (this.retryBatchTimer !== undefined) clearTimeout(this.retryBatchTimer);
    this.retryBatchTimer = undefined;
    this.retryBatchIds.clear();
    if (this.secondaryBatchTimer !== undefined) {
      clearTimeout(this.secondaryBatchTimer);
    }
    this.secondaryBatchTimer = undefined;
    this.secondaryBatchIds.clear();
    this.secondaryAttempted.clear();
  }

  private installScrollTranslation(): void {
    this.stopScroll?.();
    const onScroll = (): void => {
      if (!this.active) return;
      this.scrollActive = true;
      setTranslationScrollActive(true);
      this.translateVisibleParagraphs();
      if (this.scrollTimer !== undefined) clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = undefined;
        this.scrollActive = false;
        if (this.active) this.flushDeferredResults();
        setTranslationScrollActive(false);
        if (!this.active) return;
        // Visibility can change without a DOM mutation (for example, a
        // scrolled panel switching from display:none to visible). Rescanning
        // here also covers lazy content that did not exist during the first
        // pass, instead of relying on the text-block count staying constant.
        void this.rescan().then(() => this.translateVisibleParagraphs());
      }, 180);
    };
    document.addEventListener("scroll", onScroll, true);
    this.stopScroll = () => {
      document.removeEventListener("scroll", onScroll, true);
    };
  }

  private translateVisibleParagraphs(): void {
    if (!this.active) return;
    const viewportHeight = window.innerHeight;
    if (viewportHeight <= 0) return;
    const margin = Math.max(240, viewportHeight * 1.25);
    const ids: string[] = [];
    for (const [id, paragraph] of this.paragraphs) {
      if (this.pendingIds.has(id) || this.renderedIds.has(id)) continue;
      const rect = paragraph.container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < -margin || rect.top > viewportHeight + margin) continue;
      ids.push(id);
    }
    if (ids.length) void this.translateParagraphIds(ids, "viewport");
  }

  private scheduleDeferredRenderFlush(): void {
    if (this.renderFlushTimer !== undefined) {
      clearTimeout(this.renderFlushTimer);
      this.renderFlushTimer = undefined;
    }
    if (!this.scrollActive && this.pendingIds.size === 0) {
      this.flushDeferredResults();
      return;
    }
    this.renderFlushTimer = setTimeout(() => {
      this.renderFlushTimer = undefined;
      this.flushDeferredResults(true);
    }, 30_000);
  }

  private flushDeferredResults(force = false): void {
    if (!this.deferredResults.length) return;
    if (this.scrollActive || (!force && this.pendingIds.size > 0)) return;
    const results = this.deferredResults.splice(0);
    const anchor = captureRenderedScrollAnchor();
    try {
      for (const result of results) this.renderResultNow(result);
    } finally {
      restoreRenderedScrollAnchor(anchor);
    }
  }

  private installEditing(): void {
    this.stopEditing?.();
    this.stopEditing = installEditableTranslations(document, {
      enabled: this.config.enableEditTranslation === true,
      save: (id, translation) => this.overrideStore.set(id, translation),
    });
  }

  private installDirectHover(): void {
    this.stopDirectHover?.();
    this.stopDirectHover = undefined;
    if (!this.hoverDirectly) return;
    this.stopDirectHover = installDirectHoverTranslation(
      (request) => this.resolveHoverKnowledge(request),
      {
        onBookmarkWord: (request) => {
          document.dispatchEvent(
            new CustomEvent("imt:bookmark-word", { detail: request }),
          );
        },
        onBookmarkArticle: (request) => {
          document.dispatchEvent(
            new CustomEvent("imt:bookmark-article", { detail: request }),
          );
        },
        onOpenSource: (knowledge) => {
          const source = knowledge.sources[0]?.url;
          if (source) {
            window.open(source, "_blank", "noopener,noreferrer");
            return;
          }
          void sendToBackground({
            type: "openAcademic",
            term: knowledge.term,
          }).catch(() => undefined);
        },
      },
    );
  }

  private async resolveHoverKnowledge(
    request: HoverContextRequest,
  ): Promise<AcademicTermKnowledge | undefined> {
    const context = [
      request.previousSentence,
      request.sentence,
      request.nextSentence,
    ]
      .filter(Boolean)
      .join(" ");
    return sendToBackground({
      type: "academicResolve",
      term: request.word,
      context: `${request.paragraphTheme}\n${context}`,
      title: request.title,
      url: window.location.href,
      domain: request.domain,
      service: this.config.academic.service,
    }) as Promise<AcademicTermKnowledge | undefined>;
  }

  private scanRoot(): Node {
    if (this.scope === "whole" || this.rule.selectors?.length)
      return document.body;
    return findMainContent(document) ?? document.body;
  }

  private async rescan(): Promise<void> {
    if (!this.active || !document.body) return;
    const found = extractParagraphs(
      this.scanRoot(),
      this.extractionRule(),
    ) as AdvancedParagraph[];
    const nonNested = found.filter(
      (paragraph) =>
        !found.some(
          (candidate) =>
            candidate !== paragraph &&
            paragraph.container.contains(candidate.container),
        ),
    );
    const title = extractTitle(document, this.extractionRule());
    if (title) nonNested.unshift(title as AdvancedParagraph);
    const queued: string[] = [];
    for (const paragraph of nonNested) {
      const existing = this.paragraphs.get(paragraph.id);
      if (existing) {
        if (
          existing.container === paragraph.container &&
          this.hasTranslationMarker(existing.container)
        ) {
          continue;
        }
        if (
          existing.container !== paragraph.container &&
          existing.container.isConnected &&
          this.hasTranslationMarker(existing.container)
        ) {
          continue;
        }
        this.forgetParagraph(paragraph.id);
      }
      if (!this.registerParagraph(paragraph)) continue;
      this.useCompleteVisibleText(paragraph);
      const cached = this.cachedTranslations.get(paragraph.text);
      if (cached !== undefined) {
        this.renderText(paragraph, cached, false);
        continue;
      }
      const override = await this.overrideStore.get(paragraph.id);
      if (!this.active) return;
      if (override !== undefined) this.renderText(paragraph, override, false);
      else {
        const localUiTranslation = this.localUiTranslation(paragraph);
        if (localUiTranslation !== undefined) {
          this.renderText(paragraph, localUiTranslation, false);
        } else {
          queued.push(paragraph.id);
        }
      }
    }
    const quickMode = this.currentReadingMode() === "quick";
    if (this.immediate || quickMode) {
      this.collectMissedProse(queued, quickMode);
    }
    if (this.immediate) {
      await this.translateIdsImmediately(queued);
    } else {
      for (const id of queued) {
        const paragraph = this.paragraphs.get(id);
        if (paragraph) this.viewport?.add([id, paragraph.container]);
      }
    }
    this.emitState();
  }

  private collectMissedProse(queued: string[], force = false): void {
    if (!this.immediate && !force) return;
    const root = this.scanRoot();
    if (!(root instanceof Element)) return;
    const knownContainers = new Set(
      [...this.paragraphs.values()].map(({ container }) => container),
    );
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th",
      ),
    ).filter((element) => {
      if (element.closest("pre, code, [data-imt]")) return false;
      if (
        [...knownContainers].some(
          (container) =>
            container === element ||
            container.contains(element) ||
            element.contains(container),
        )
      ) {
        return false;
      }
      const hasDirectTranslation = Array.from(element.children).some(
        (child) => {
          const marker = child.getAttribute("data-imt");
          return (
            marker === "target" || marker === "loading" || marker === "error"
          );
        },
      );
      if (hasDirectTranslation) {
        return false;
      }
      const text = (element.innerText ?? element.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
      const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
      return latin >= 20 && chinese < 5;
    });
    for (const container of candidates) {
      if (knownContainers.has(container)) continue;
      knownContainers.add(container);
      const text = (container.innerText ?? container.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const paragraph: AdvancedParagraph = {
        id: `imt-fallback-${++this.sequence}`,
        container,
        nodes: [...container.childNodes],
        text,
        placeholders: new Map(),
      };
      this.paragraphs.set(paragraph.id, paragraph);
      queued.push(paragraph.id);
    }
  }

  private useCompleteVisibleText(paragraph: AdvancedParagraph): void {
    if (!this.immediate || paragraph.preformatted) return;
    const container = paragraph.container as HTMLElement;
    const visible = (container.innerText ?? container.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const current = paragraph.text.replace(/\s+/g, " ").trim();
    if (
      visible.length <= Math.max(40, current.length * 1.2) ||
      !/[A-Za-z]{3}/.test(visible)
    ) {
      return;
    }
    paragraph.text = visible;
    paragraph.nodes = [...paragraph.container.childNodes];
    paragraph.placeholders = new Map();
    paragraph.protectedAcademicText = undefined;
    paragraph.academicTerms = undefined;
  }

  private async translateMissedProse(): Promise<void> {
    if (!this.immediate || !this.active || !document.body) return;
    const knownContainers = new Set(
      [...this.paragraphs.values()].map(({ container }) => container),
    );
    const candidates = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th",
      ),
    ).filter((element) => {
      if (element.hasAttribute("data-imt-id")) return false;
      if (element.closest("pre, code, [data-imt]")) return false;
      if (
        [...knownContainers].some(
          (container) =>
            container === element ||
            container.contains(element) ||
            element.contains(container),
        )
      ) {
        return false;
      }
      const text = (element.innerText ?? element.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
      const chinese = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
      return latin >= 20 && chinese < 5;
    });
    if (!candidates.length) return;

    const paragraphs: AdvancedParagraph[] = candidates.flatMap((container) => {
      if (knownContainers.has(container)) return [];
      knownContainers.add(container);
      const text = (container.innerText ?? container.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim();
      return [
        {
          id: `imt-fallback-${++this.sequence}`,
          container,
          nodes: [...container.childNodes],
          text,
          placeholders: new Map(),
        },
      ];
    });
    for (const paragraph of paragraphs) {
      this.paragraphs.set(paragraph.id, paragraph);
    }
    await this.translateParagraphIds(
      paragraphs.map(({ id }) => id),
      "normal",
    );
  }

  private localUiTranslation(
    paragraph: AdvancedParagraph,
  ): string | undefined {
    const source = paragraph.text.replace(/\{\/?\d+\}/g, "").trim();
    return lookupLocalUiPhrase(source);
  }

  private hasTranslationMarker(container: Element): boolean {
    if (container.hasAttribute("data-imt-id")) return true;
    return Array.from(container.children).some((child) => {
      const marker = child.getAttribute("data-imt");
      return marker === "target" || marker === "loading" || marker === "error";
    });
  }

  private forgetParagraph(id: string): void {
    this.paragraphs.delete(id);
    this.pendingIds.delete(id);
    this.renderedIds.delete(id);
    this.errorIds.delete(id);
  }

  private rememberTranslation(source: string, translation: string): void {
    if (!source || !translation) return;
    this.cachedTranslations.delete(source);
    this.cachedTranslations.set(source, translation);
    while (this.cachedTranslations.size > 1_000) {
      const oldest = this.cachedTranslations.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) break;
      this.cachedTranslations.delete(oldest);
    }
  }

  private registerParagraph(paragraph: AdvancedParagraph): boolean {
    if (
      this.paragraphs.has(paragraph.id) ||
      this.pendingIds.has(paragraph.id) ||
      this.renderedIds.has(paragraph.id)
    )
      return false;
    const detected = detectTextLanguage(paragraph.text);
    paragraph.lang = detected;
    if (
      this.rule.sameLangCheck !== false &&
      isParagraphTargetLanguage(paragraph.text, this.config.targetLanguage)
    )
      return false;
    this.paragraphs.set(paragraph.id, paragraph);
    return true;
  }

  private async translateAllPending(): Promise<void> {
    const ids = [...this.paragraphs.keys()].filter(
      (id) => !this.pendingIds.has(id) && !this.renderedIds.has(id),
    );
    await this.translateIdsImmediately(ids);
  }

  private translateIdsImmediately(ids: readonly string[]): Promise<void> {
    const viewportHeight = Math.max(1, window.innerHeight);
    const margin = viewportHeight * 2;
    const priority: string[] = [];
    const deferred: string[] = [];
    for (const id of ids) {
      const paragraph = this.paragraphs.get(id);
      if (!paragraph) continue;
      const rect = paragraph.container.getBoundingClientRect();
      if (rect.bottom >= -margin && rect.top <= viewportHeight + margin) {
        priority.push(id);
      } else {
        deferred.push(id);
      }
    }
    return Promise.all([
      priority.length
        ? this.translateParagraphIds(priority, "viewport")
        : Promise.resolve(),
      deferred.length
        ? this.translateParagraphIds(deferred, "normal")
        : Promise.resolve(),
    ]).then(() => undefined);
  }

  private isParagraphAllowed(paragraph: AdvancedParagraph): boolean {
    const selectors = this.rule.selectors;
    if (!selectors?.length) return true;
    return selectors.some((selector) => {
      try {
        return (
          paragraph.container.matches(selector) ||
          Boolean(paragraph.container.closest(selector))
        );
      } catch {
        return false;
      }
    });
  }

  private clearParagraphSegments(paragraphId: string): void {
    for (const [id, target] of this.segmentTargets) {
      if (target.paragraphId === paragraphId) {
        this.segmentTargets.delete(id);
      }
    }
    this.paragraphSegments.delete(paragraphId);
  }

  private collectSegmentResult(
    target: SegmentTarget,
    result: ParagraphTranslationResult,
  ): void {
    const state = this.paragraphSegments.get(target.paragraphId);
    if (!state) return;
    state.results.set(target.index, result);
    if (state.results.size < state.total) return;

    const ordered = Array.from(
      { length: state.total },
      (_, index) => state.results.get(index),
    );
    const error = ordered.find((item) => item?.error)?.error;
    const paragraph = this.paragraphs.get(target.paragraphId);
    if (paragraph && !error) {
      paragraph.translatedSegments = ordered.map((item) =>
        restoreAcademicTerms(
          item?.text ?? "",
          paragraph.academicTerms ?? [],
        ),
      );
    }
    this.clearParagraphSegments(target.paragraphId);
    this.renderResult({
      id: target.paragraphId,
      ...(error
        ? { error }
        : { text: ordered.map((item) => item?.text ?? "").join(" ") }),
    });
  }

  private requestParagraphs(
    paragraphs: readonly AdvancedParagraph[],
    priority: TranslationPriority,
    serviceOverride?: string,
  ): Promise<void> {
    const requestParagraphs: TranslatePortMessage["paragraphs"] = [];
    for (const paragraph of paragraphs) {
      if (this.currentReadingMode() === "quick") {
        this.hideFailedSource(paragraph);
      }
      this.pendingIds.add(paragraph.id);
      this.errorIds.delete(paragraph.id);
      paragraph.translatedSegments = undefined;
      this.clearParagraphSegments(paragraph.id);
      if (!paragraph.protectedAcademicText) {
        if (
          this.config.academic.enabled &&
          !this.plainFallbackAttempted.has(paragraph.container)
        ) {
          const protectedText = protectAcademicTerms(
            paragraph.text,
            Math.max(this.config.academic.maxTermsPerParagraph, 12),
          );
          paragraph.academicTerms = protectedText.terms;
          paragraph.protectedAcademicText = protectedText.text;
        } else {
          paragraph.academicTerms = [];
          paragraph.protectedAcademicText = paragraph.text;
        }
      }

      const source = paragraph.protectedAcademicText;
      const segments =
        this.config.translationMode === "dual"
          ? splitTranslationSentences(source)
          : splitTranslationText(source);
      if (segments.length <= 1) {
        requestParagraphs.push({
          id: paragraph.id,
          text: source,
          priority,
          protectedTerms: paragraph.academicTerms,
        });
        continue;
      }

      this.paragraphSegments.set(paragraph.id, {
        total: segments.length,
        results: new Map(),
      });
      segments.forEach((text, index) => {
        const id = `${paragraph.id}::segment-${index}`;
        this.segmentTargets.set(id, {
          paragraphId: paragraph.id,
          index,
        });
        requestParagraphs.push({
          id,
          text,
          priority,
          protectedTerms: paragraph.academicTerms,
        });
      });
    }
    const requestId = this.newRequestId();
    const message: TranslatePortMessage = {
      type: "translate",
      requestId,
      paragraphs: requestParagraphs,
      from: this.config.sourceLanguage,
      to: this.config.targetLanguage,
      service:
        serviceOverride ??
        this.runtimeService ??
        this.rule.service ??
        this.config.service,
      glossary: this.glossary(),
      context: this.context(),
      priority,
      removeDuplicateTranslations: this.config.removeDuplicateTranslations,
      translationIntegrityMode: this.config.translationIntegrityMode,
    };
    this.emitState();
    return new Promise((resolve) => {
      this.requests.set(requestId, {
        message,
        remaining: new Set(requestParagraphs.map(({ id }) => id)),
        resolve,
        timeout: this.createRequestTimeout(
          requestId,
          requestParagraphs.length,
        ),
      });
      this.post(message);
    });
  }

  private resolveSecondaryService(): string | undefined {
    if (this.config.secondaryService === this.config.service) return undefined;
    const preferred = this.config.secondaryService;
    const services = this.config.services;
    if (
      preferred &&
      services[preferred] &&
      services[preferred].enabled !== false
    ) {
      return preferred;
    }
    const fallback = "local-model";
    if (services[fallback] && services[fallback].enabled !== false) {
      return fallback;
    }
    return undefined;
  }

  private trySecondaryService(paragraphIds: readonly string[]): boolean {
    const secondaryId = this.resolveSecondaryService();
    if (!secondaryId) return false;
    const pending = paragraphIds.filter(
      (id) =>
        this.paragraphs.has(id) &&
        !this.secondaryAttempted.has(id),
    );
    if (!pending.length) return false;
    for (const id of pending) this.secondaryAttempted.add(id);
    for (const id of pending) {
      // 放弃时可能已把它标记成已渲染，次级服务要能重新翻译这一段。
      this.renderedIds.delete(id);
      this.pendingIds.delete(id);
      this.errorIds.delete(id);
      this.retryAttempts.delete(id);
      this.clearParagraphSegments(id);
    }
    void this.translateParagraphIds(pending, "interactive", secondaryId);
    return true;
  }

  private queueSecondaryFallback(paragraphId: string): void {
    if (this.secondaryAttempted.has(paragraphId)) return;
    this.secondaryBatchIds.add(paragraphId);
    if (this.secondaryBatchTimer !== undefined) return;
    this.secondaryBatchTimer = setTimeout(() => {
      this.secondaryBatchTimer = undefined;
      const ids = [...this.secondaryBatchIds].filter(
        (id) =>
          this.active && this.paragraphs.has(id) && !this.renderedIds.has(id),
      );
      this.secondaryBatchIds.clear();
      if (!ids.length) return;
      if (this.trySecondaryService(ids)) return;
      for (const id of ids) this.finalizeFailedParagraph(id);
      this.emitState();
    }, 0);
  }

  private finalizeFailedParagraph(paragraphId: string): void {
    const paragraph = this.paragraphs.get(paragraphId);
    if (!paragraph || this.renderedIds.has(paragraphId)) return;
    removeTranslation(paragraph);
    this.hideFailedSource(paragraph);
    this.pendingIds.delete(paragraphId);
    this.errorIds.delete(paragraphId);
    markTranslated(paragraph.container, paragraphId);
    this.renderedIds.add(paragraphId);
  }

  private flushRetryBatch(): void {
    if (this.retryBatchTimer !== undefined) return;
    this.retryBatchTimer = setTimeout(() => {
      this.retryBatchTimer = undefined;
      const ids = [...this.retryBatchIds].filter(
        (id) => this.active && this.paragraphs.has(id),
      );
      this.retryBatchIds.clear();
      if (ids.length) void this.translateParagraphIds(ids, "interactive");
    }, 0);
  }

  private async translateParagraphIds(
    ids: readonly string[],
    priority: TranslationPriority,
    serviceOverride?: string,
  ): Promise<void> {
    const paragraphs = ids.flatMap((id) => {
      const paragraph = this.paragraphs.get(id);
      return paragraph &&
        !this.pendingIds.has(id) &&
        !this.renderedIds.has(id) &&
        this.isParagraphAllowed(paragraph)
        ? [paragraph]
        : [];
    });
    if (!paragraphs.length) return;
    const preformatted = paragraphs.filter(
      (paragraph) => paragraph.preformatted,
    );
    const regular = paragraphs.filter((paragraph) => !paragraph.preformatted);
    await Promise.all([
      regular.length
        ? this.requestParagraphs(regular, priority, serviceOverride)
        : Promise.resolve(),
      ...preformatted.map((paragraph) =>
        this.translatePreformatted(paragraph, priority),
      ),
    ]);
  }

  private async translatePreformatted(
    paragraph: AdvancedParagraph,
    priority: TranslationPriority,
  ): Promise<void> {
    const generation = this.generation;
    if (this.currentReadingMode() === "quick") {
      this.hideFailedSource(paragraph);
    }
    this.pendingIds.add(paragraph.id);
    this.errorIds.delete(paragraph.id);
    this.emitState();
    try {
      const lines = splitPreLikeText(paragraph.text);
      const sources = lines
        .filter((line) => line.text)
        .map((line) => line.text);
      const translations = new Array<string>(sources.length);
      await translateImmediately(
        sources.map((source, index) => ({ source, index })),
        async ({ source, index }) => {
          translations[index] = await this.requestText(
            source,
            this.config.sourceLanguage,
            this.config.targetLanguage,
            priority,
          );
        },
        { concurrency: this.config.immediateTranslationConcurrency ?? 4 },
      );
      if (generation !== this.generation) return;
      this.renderText(
        paragraph,
        joinPreLikeTranslation(lines, translations),
        false,
      );
    } catch {
      if (generation !== this.generation) return;
      this.scheduleAutomaticRetry(paragraph);
    }
  }

  private requestText(
    text: string,
    from: string,
    to: string,
    priority: TranslationPriority,
  ): Promise<string> {
    const id = `text-${Date.now().toString(36)}-${++this.sequence}`;
    const requestId = this.newRequestId();
    const message: TranslatePortMessage = {
      type: "translate",
      requestId,
      paragraphs: [{ id, text, priority }],
      from: normalizeLang(from),
      to: normalizeLang(to),
      service: this.runtimeService ?? this.rule.service ?? this.config.service,
      glossary: this.glossary(),
      context: this.context(),
      priority,
      removeDuplicateTranslations: this.config.removeDuplicateTranslations,
      translationIntegrityMode: this.config.translationIntegrityMode,
    };
    return new Promise<string>((resolve, reject) => {
      this.textWaiters.set(id, { resolve, reject });
      this.requests.set(requestId, {
        message,
        remaining: new Set([id]),
        resolve: () => undefined,
        timeout: this.createRequestTimeout(requestId),
      });
      this.post(message);
    });
  }

  private glossary(): Array<{ k: string; v: string }> {
    return glossaryForDomain(
      [...this.config.glossaries, ...(this.rule.glossaries ?? [])],
      window.location.hostname,
    ).map(({ k, v }) => ({ k, v }));
  }

  private context() {
    return buildPageContext(
      document,
      [...this.paragraphs.values()].map((paragraph) => paragraph.text),
      this.config.contextWordLimit ?? 80,
    );
  }

  private newRequestId(): string {
    return `request-${Date.now().toString(36)}-${++this.sequence}`;
  }

  private connect(): void {
    if (this.destroyed || this.port) return;
    try {
      const port = connectTranslatePort();
      this.port = port;
      port.onMessage((message) => this.handleResult(message));
      port.onDisconnect(() => {
        if (this.port !== port) return;
        this.port = undefined;
        if (!this.destroyed) this.scheduleReconnect();
      });
      for (const request of this.requests.values()) {
        const paragraphs = request.message.paragraphs.filter(({ id }) =>
          request.remaining.has(id),
        );
        if (paragraphs.length)
          port.postMessage({ ...request.message, paragraphs });
      }
    } catch {
      this.port = undefined;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private post(
    message: Parameters<ContentTranslatePort["postMessage"]>[0],
  ): void {
    if (!this.port) {
      if (message.type === "translate") this.connect();
      return;
    }
    try {
      this.port.postMessage(message);
    } catch {
      this.port = undefined;
      if (message.type === "translate") this.scheduleReconnect();
    }
  }

  private handleResult(message: TranslateResultMessage): void {
    const request = this.requests.get(message.requestId);
    if (!request) return;
    const anchor = captureRenderedScrollAnchor();
    try {
      for (const result of message.results) {
        request.remaining.delete(result.id);
        const segment = this.segmentTargets.get(result.id);
        if (segment) {
          this.collectSegmentResult(segment, result);
          continue;
        }
        const waiter = this.textWaiters.get(result.id);
        if (waiter) {
          this.textWaiters.delete(result.id);
          if (result.error) waiter.reject(new Error(result.error.message));
          else waiter.resolve(result.text ?? "");
        } else {
          this.renderResult(result);
        }
      }
      if (!request.remaining.size) {
        clearTimeout(request.timeout);
        this.requests.delete(message.requestId);
        request.resolve();
        return;
      }
      if (!message.done) return;
      const retryParagraphIds = new Set<string>();
      for (const id of request.remaining) {
        const waiter = this.textWaiters.get(id);
        if (waiter) {
          waiter.reject(new Error("Translation ended without a result."));
          this.textWaiters.delete(id);
        } else {
          const target = this.segmentTargets.get(id);
          const paragraphId = target?.paragraphId ?? id;
          retryParagraphIds.add(paragraphId);
        }
      }
      for (const paragraphId of retryParagraphIds) {
        this.clearParagraphSegments(paragraphId);
        const paragraph = this.paragraphs.get(paragraphId);
        if (paragraph) this.scheduleAutomaticRetry(paragraph);
      }
      clearTimeout(request.timeout);
      this.requests.delete(message.requestId);
      request.resolve();
      this.emitState();
    } finally {
      restoreRenderedScrollAnchor(anchor);
    }
  }

  private createRequestTimeout(
    requestId: string,
    itemCount = 1,
  ): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const request = this.requests.get(requestId);
      if (!request) return;
      this.requests.delete(requestId);
      this.post({ type: "cancel", requestId });
      const retryParagraphIds = new Set<string>();
      for (const id of request.remaining) {
        const waiter = this.textWaiters.get(id);
        if (waiter) {
          this.textWaiters.delete(id);
          waiter.reject(new Error("Translation request timed out."));
          continue;
        }
        const target = this.segmentTargets.get(id);
        retryParagraphIds.add(target?.paragraphId ?? id);
      }
      for (const paragraphId of retryParagraphIds) {
        this.clearParagraphSegments(paragraphId);
        const paragraph = this.paragraphs.get(paragraphId);
        if (paragraph) this.scheduleAutomaticRetry(paragraph);
      }
      request.resolve();
      this.emitState();
    }, Math.min(
      MAX_REQUEST_TIMEOUT_MS,
      REQUEST_TIMEOUT_MS + Math.max(0, itemCount - 1) * 300,
    ));
  }

  /** 仅中文模式下放弃翻译的段落隐藏原文，避免页面残留英文。 */
  private hideFailedSource(paragraph: AdvancedParagraph): void {
    if (this.currentMode() !== "translation") return;
    paragraph.container.classList.add("imt-source-hidden");
    this.hiddenSources.add(paragraph.container);
  }

  /** 恢复被隐藏的原文（切回原文/双语或整体重置时调用）。 */
  private restoreHiddenSources(): void {
    for (const element of this.hiddenSources) {
      element.classList.remove("imt-source-hidden");
    }
    this.hiddenSources.clear();
  }

  /** 诊断快照：仅用于排查段落卡在 pending 的问题，不参与翻译流程。 */
  debugSnapshot(): Record<string, unknown> {
    return {
      active: this.active,
      pending: this.pendingIds.size,
      deferred: this.deferredResults.length,
      translated: this.renderedIds.size,
      errors: this.errorIds.size,
      pendingIds: [...this.pendingIds].slice(0, 20),
      retryAttempts: [...this.retryAttempts.entries()].slice(0, 20),
      retryTimers: [...this.retryTimers.keys()].slice(0, 20),
      inFlightRequests: [...this.requests.keys()].slice(0, 10),
      scrollActive: this.scrollActive,
    };
  }

  private renderResult(result: ParagraphTranslationResult): void {
    this.pendingIds.delete(result.id);
    this.deferredResults.push(result);
    this.emitState();
    this.scheduleDeferredRenderFlush();
  }

  private renderResultNow(result: ParagraphTranslationResult): void {
    this.pendingIds.delete(result.id);
    const paragraph = this.paragraphs.get(result.id);
    if (!paragraph) return;
    if (result.error) {
      if (this.shouldSkipFailedTranslation(paragraph)) {
        removeTranslation(paragraph);
        this.hideFailedSource(paragraph);
        this.pendingIds.delete(paragraph.id);
        this.errorIds.delete(paragraph.id);
        markTranslated(paragraph.container, paragraph.id);
        this.renderedIds.add(paragraph.id);
        this.emitState();
        return;
      }
      this.scheduleAutomaticRetry(paragraph);
      return;
    }
    this.retryAttempts.delete(paragraph.id);
    const restored = restoreAcademicTerms(
      result.text ?? "",
      paragraph.academicTerms ?? [],
    );
    const translated = this.config.removeDuplicateTranslations
      ? removeDuplicateTranslation(
          paragraph.text,
          restored,
          paragraph.academicTerms ?? [],
        )
      : restored;
    if (!translated.trim()) {
      this.scheduleAutomaticRetry(paragraph);
      return;
    }
    if (translationLooksGarbled(translated)) {
      removeTranslation(paragraph);
      if (this.shouldSkipFailedTranslation(paragraph)) {
        this.pendingIds.delete(paragraph.id);
        this.errorIds.delete(paragraph.id);
        markTranslated(paragraph.container, paragraph.id);
        this.renderedIds.add(paragraph.id);
        this.emitState();
        return;
      }
      this.scheduleAutomaticRetry(paragraph);
      return;
    }
    if (this.translationIsUnchanged(paragraph, translated)) {
      removeTranslation(paragraph);
      if (!this.plainFallbackAttempted.has(paragraph.container)) {
        this.plainFallbackAttempted.add(paragraph.container);
        const visible = (
          paragraph.container as HTMLElement
        ).innerText
          ?.replace(/\s+/g, " ")
          .trim();
        paragraph.text = visible || paragraph.text;
        paragraph.nodes = [...paragraph.container.childNodes];
        paragraph.placeholders = new Map();
        paragraph.protectedAcademicText = undefined;
        paragraph.academicTerms = undefined;
        this.pendingIds.delete(paragraph.id);
        this.errorIds.delete(paragraph.id);
        void this.requestParagraphs([paragraph], "interactive");
        return;
      }
      this.pendingIds.delete(paragraph.id);
      if (this.shouldSkipFailedTranslation(paragraph)) {
        removeTranslation(paragraph);
        this.errorIds.delete(paragraph.id);
        markTranslated(paragraph.container, paragraph.id);
        this.renderedIds.add(paragraph.id);
        this.emitState();
        return;
      }
      this.scheduleAutomaticRetry(paragraph);
      return;
    }
    this.renderText(
      paragraph,
      translated,
      true,
    );
  }

  private scheduleAutomaticRetry(paragraph: AdvancedParagraph): void {
    if (this.retryTimers.has(paragraph.id)) return;
    if (this.secondaryAttempted.has(paragraph.id)) {
      this.retryAttempts.delete(paragraph.id);
      this.finalizeFailedParagraph(paragraph.id);
      this.emitState();
      return;
    }
    const previous = this.retryAttempts.get(paragraph.id) ?? 0;
    const attempt = previous + 1;
    // 完整性模式只是允许更多次重试，不能无限重试：只要段落永远失败，
    // pending 就永远不会归零，页面会一直停在“翻译中”。
    // 完整性模式只是允许更多次重试，不能无限重试：只要段落永远失败，
    // pending 就永远不会归零，页面会一直停在“翻译中”。
    const maxAttempts = this.config.translationIntegrityMode
      ? MAX_INTEGRITY_RETRIES
      : MAX_AUTOMATIC_RETRIES;
    if (attempt > maxAttempts) {
      this.retryAttempts.delete(paragraph.id);
      this.queueSecondaryFallback(paragraph.id);
      this.emitState();
      return;
    }

    this.retryAttempts.set(paragraph.id, attempt);
    // 失败段落要尽快收敛：限流由调度器的退避负责，这里只做短促重试，
    // 避免页面长时间停留在原文（仅中文模式下会出现成片英文）。
    const delay = Math.min(2_000, 400 * 2 ** Math.min(attempt - 1, 2));
    removeTranslation(paragraph);
    this.errorIds.delete(paragraph.id);
    const timer = setTimeout(() => {
      this.retryTimers.delete(paragraph.id);
      if (!this.active || !this.paragraphs.has(paragraph.id)) {
        // 段落已消失或翻译已关闭时，必须清掉挂起状态，否则 busy 永远为真。
        this.pendingIds.delete(paragraph.id);
        this.emitState();
        return;
      }
      this.errorIds.delete(paragraph.id);
      this.pendingIds.delete(paragraph.id);
      this.retryBatchIds.add(paragraph.id);
      this.flushRetryBatch();
    }, delay);
    this.retryTimers.set(paragraph.id, timer);
  }

  private shouldSkipFailedTranslation(
    paragraph: AdvancedParagraph,
  ): boolean {
    const text = paragraph.text.replace(/\{\/?\d+\}/g, "").trim();
    if (/doi:\s*10\.|10\.\d{4,9}\//i.test(text)) return true;
    const letters = text.match(/[A-Za-z]/g)?.length ?? 0;
    const words = text.split(/\s+/).filter(Boolean);
    return letters < 12 || words.length <= 1;
  }

  private translationIsUnchanged(
    paragraph: AdvancedParagraph,
    translated: string,
  ): boolean {
    const normalize = (value: string): string =>
      value
        .replace(/\{\/?\d+\}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const source = normalize(paragraph.text);
    const target = normalize(translated);
    if (!target && source) return true;
    if (source === target) return true;
    const sourceLetters = source.match(/[a-z]/g)?.length ?? 0;
    const targetLetters = target.match(/[a-z]/g)?.length ?? 0;
    const targetChinese = target.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
    return (
      sourceLetters >= 20 &&
      targetLetters >= 20 &&
      targetChinese < 3 &&
      targetLetters / sourceLetters >= 0.65
    );
  }

  private renderText(
    paragraph: AdvancedParagraph,
    text: string,
    decode: boolean,
  ): void {
    try {
      const fragment = decode
        ? decodePlaceholders(text, paragraph.placeholders, PLACEHOLDER_STYLE)
        : document.createDocumentFragment();
      if (!decode) fragment.append(text);
      this.hiddenSources.delete(paragraph.container);
      paragraph.container.classList.remove("imt-source-hidden");
      const target = renderTranslation(paragraph as Paragraph, fragment, {
        mode: this.currentMode(),
        readingMode: this.currentReadingMode(),
        theme: this.currentTheme(),
        wrapperTag: "font",
        automaticColor: this.config.autoTranslationColor !== false,
        prefix:
          this.rule.wrapperPrefix === "block" ||
          this.rule.wrapperPrefix === "inline"
            ? this.rule.wrapperPrefix
            : "smart",
        preformatted: paragraph.preformatted,
        academicTerms: paragraph.academicTerms,
        translatedSegments: paragraph.translatedSegments,
        style: {
          font: this.config.font,
          fontSize:
            typeof this.config.translationFontSize === "number"
              ? `${this.config.translationFontSize}px`
              : this.config.translationFontSize,
          color:
            this.config.autoTranslationColor === false
              ? this.config.translationColor
              : undefined,
          lineHeight: this.config.translationLineHeight,
        },
      });
      this.rememberTranslation(paragraph.text, target.textContent ?? text);
      markTranslated(paragraph.container, paragraph.id);
      this.pendingIds.delete(paragraph.id);
      this.errorIds.delete(paragraph.id);
      this.renderedIds.add(paragraph.id);
    } catch {
      this.scheduleAutomaticRetry(paragraph);
    }
    this.emitState();
  }

  private emitState(): void {
    const state = this.state();
    document.documentElement.dataset.imtTranslationBusy = String(
      state.pending > 0,
    );
    this.reportState?.(state);
  }
}
