import { afterEach, describe, expect, it, vi } from "vitest";

const portPosts = vi.hoisted(() => [] as unknown[]);
const portListeners = vi.hoisted(() => [] as Array<(message: unknown) => void>);
const disconnectListeners = vi.hoisted(() => [] as Array<() => void>);
const controllerStorage = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
}));
const browserMock = vi.hoisted(() => ({
  runtime: {
    sendMessage: vi.fn(async () => ({})),
    connect: vi.fn(() => ({
      postMessage: vi.fn((message: unknown) => portPosts.push(message)),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) =>
          portListeners.push(listener),
        ),
        removeListener: vi.fn(),
      },
      onDisconnect: {
        addListener: vi.fn((listener: () => void) =>
          disconnectListeners.push(listener),
        ),
        removeListener: vi.fn(),
      },
      disconnect: vi.fn(),
    })),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({
        [key]: controllerStorage.values[key],
      })),
      set: vi.fn(async (patch: Record<string, unknown>) => {
        Object.assign(controllerStorage.values, patch);
      }),
    },
  },
}));

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import { generalRule } from "../../src/background/rules/defaults";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import {
  READING_SESSION_MODE_KEY,
  TRANSLATION_SESSION_ACTIVE_KEY,
  TRANSLATION_SESSION_MODE_KEY,
  TranslationController,
} from "../../src/content/controller/translation-controller";
import { TRANSLATION_OVERRIDES_KEY } from "../../src/content/controller/editable";
import { extractParagraphs } from "../../src/content/extract/scanner";
import { removeAll as removeRenderedTranslations } from "../../src/content/render/inject";
import type { AdvancedPageConfig } from "../../src/shared/j-types";
import type { Config } from "../../src/shared/types";

function config(): Config {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    floatBall: { enabled: false, position: "right" },
    subtitle: { ...DEFAULT_CONFIG.subtitle, youtube: false },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeRenderedTranslations(document);
  portPosts.length = 0;
  portListeners.length = 0;
  disconnectListeners.length = 0;
  controllerStorage.values = {};
  vi.clearAllMocks();
  document.documentElement.lang = "";
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("TranslationController", () => {
  it("remembers mode and active state for same-tab navigation", () => {
    const controller = new TranslationController(config(), generalRule);

    controller.setMode("translation");
    expect(window.sessionStorage.getItem(TRANSLATION_SESSION_MODE_KEY)).toBe(
      "translation",
    );
    expect(window.localStorage.getItem(TRANSLATION_SESSION_MODE_KEY)).toBe(
      "translation",
    );
    expect(window.sessionStorage.getItem(READING_SESSION_MODE_KEY)).toBe(
      "quick",
    );

    controller.togglePage();
    expect(window.sessionStorage.getItem(TRANSLATION_SESSION_ACTIVE_KEY)).toBe(
      "1",
    );
    expect(window.localStorage.getItem(TRANSLATION_SESSION_ACTIVE_KEY)).toBe(
      "1",
    );
    window.sessionStorage.clear();
    const reopened = new TranslationController(config(), generalRule);
    expect(reopened.shouldAutoTranslate()).toBe(true);
    expect(reopened.config.translationMode).toBe("translation");
    expect(reopened.config.readingMode).toBe("quick");
    reopened.destroy();
    controller.togglePage();
    expect(window.sessionStorage.getItem(TRANSLATION_SESSION_ACTIVE_KEY)).toBe(
      "0",
    );
    controller.destroy();
  });

  it("uses built-in translations for common navigation labels", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<article><p>HOME</p><p>CHINA</p></article>";
    const controller = new TranslationController(
      Object.assign(config(), {
        translateToPageEndImmediately: true,
      }) as AdvancedPageConfig,
      { ...generalRule, isTranslateTitle: false },
    );
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    expect(
      [...document.querySelectorAll('[data-imt="target"]')].map(
        (element) => element.textContent,
      ),
    ).toEqual(["首页", "中国"]);
    expect(portPosts).toHaveLength(0);
    controller.destroy();
  });

  it("tracks quick mode globally for source suppression", () => {
    const controller = new TranslationController(config(), generalRule);
    controller.start("whole");
    expect(document.documentElement.dataset.imtQuickMode).toBe("true");

    controller.setReadingMode("professional");
    expect(document.documentElement.dataset.imtQuickMode).toBe("false");

    controller.setReadingMode("quick");
    expect(document.documentElement.dataset.imtQuickMode).toBe("true");
    controller.removeAll();
    expect(document.documentElement.dataset.imtQuickMode).toBe("false");
    controller.destroy();
  });

  it("translates only main prose and sends domain glossary plus page context", async () => {
    vi.useFakeTimers();
    document.title = "Test article";
    document.body.innerHTML = `
      <nav><p>Navigation links should stay outside the translation request.</p></nav>
      <article><p>This is the main article and it contains enough words for detection.</p></article>
      <footer><p>Footer words should also stay outside the translation request.</p></footer>`;
    const advanced = Object.assign(config(), {
      glossaries: [
        { k: "article", v: "文章", domain: "localhost" },
        { k: "footer", v: "页脚", domain: "other.test" },
      ],
      translationModeUrlPattern: {
        dualMatches: [],
        translationMatches: ["http://localhost:*/*"],
      },
      translationThemePatterns: { paper: ["http://localhost:*/*"] },
      translationFontSize: "17px",
      autoTranslationColor: false,
      translationColor: "#123456",
      translationLineHeight: 1.7,
      globalCustomCss: "body { --workstream-j-global: 1; }",
      contextWordLimit: 5,
      translateToPageEndImmediately: false,
    }) as AdvancedPageConfig;
    const states = vi.fn();
    const controller = new TranslationController(
      advanced,
      { ...generalRule, isTranslateTitle: false },
      {
      reportState: states,
      },
    );
    controller.start("main");
    expect(
      document.querySelector('style[data-imt="style"]')?.textContent,
    ).toContain("--workstream-j-global: 1");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
        glossary: Array<{ k: string; v: string }>;
        context: { title?: string; summary?: string };
      } => (item as { type?: string }).type === "translate",
    );
    expect(request).toBeDefined();
    expect(request?.paragraphs.map(({ text }) => text).join(" ")).toContain(
      "main article",
    );
    expect(request?.paragraphs.map(({ text }) => text).join(" ")).not.toContain(
      "Navigation",
    );
    expect(request?.paragraphs.map(({ text }) => text).join(" ")).not.toContain(
      "Footer",
    );
    expect(request?.glossary).toEqual([{ k: "article", v: "文章" }]);
    expect(request?.context.title).toBe("Test article");
    expect(request?.context.summary?.split(/\s+/)).toHaveLength(5);

    portListeners[0]?.({
      type: "translateResult",
      requestId: request?.requestId,
      results:
        request?.paragraphs.map(({ id }) => ({ id, text: "译文" })) ?? [],
      done: true,
    });
    const target = document.querySelector<HTMLElement>('[data-imt="target"]');
    expect(target?.classList.contains("imt-theme-paper")).toBe(true);
    expect(target?.style.getPropertyValue("--imt-target-font-size")).toBe(
      "17px",
    );
    expect(target?.style.getPropertyValue("--imt-target-color")).toBe(
      "#123456",
    );
    expect(document.querySelector('[data-imt="source"]')?.classList).toContain(
      "imt-source-hidden",
    );
    expect(states).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
    );
    controller.destroy();
  });

  it("keeps interactive page chrome intact in whole-page mode", async () => {
    vi.useFakeTimers();
    document.title = "Clinical knowledge article";
    document.body.innerHTML = `
      <header class="site-header"><a href="/explore">Explore content</a></header>
      <article><p>Large language models encode clinical knowledge.</p></article>`;
    const rule = {
      ...generalRule,
      isTranslateTitle: false,
      excludeSelectors: [".site-header"],
    };
    const controller = new TranslationController(config(), rule);
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelector('header [data-imt="target"]')).toBeNull();
    expect(
      document.querySelector<HTMLAnchorElement>('header a')?.getAttribute(
        "href",
      ),
    ).toBe("/explore");
    controller.destroy();
  });

  it("rescans and translates new content after scrolling", async () => {
    vi.useFakeTimers();
    class IdleIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal(
      "IntersectionObserver",
      IdleIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    document.body.innerHTML =
      "<article><p id='top'>The first article paragraph.</p></article>";
    const rect = (top: number): DOMRect =>
      ({
        top,
        bottom: top + 30,
        left: 0,
        right: 500,
        width: 500,
        height: 30,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const top = document.querySelector("#top")!;
    top.getBoundingClientRect = () => rect(0);
    const controller = new TranslationController(config(), generalRule);
    const visibleSpy = vi.spyOn(
      controller as unknown as { translateVisibleParagraphs(): void },
      "translateVisibleParagraphs",
    );
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const lower = document.createElement("p");
    lower.textContent = "A newly loaded paragraph below the first viewport.";
    lower.getBoundingClientRect = () => rect(180);
    document.querySelector("article")!.append(lower);
    document.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(200);
    expect(visibleSpy).toHaveBeenCalled();

    const requests = portPosts.filter(
      (
        item,
      ): item is {
        type: "translate";
        paragraphs: Array<{ text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(
      requests.some((request) =>
        request.paragraphs.some(({ text }) =>
          text.includes("newly loaded paragraph"),
        ),
      ),
    ).toBe(true);
    controller.destroy();
  });

  it("rescans content revealed by scrolling without a DOM mutation", async () => {
    vi.useFakeTimers();
    class IdleIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal(
      "IntersectionObserver",
      IdleIntersectionObserver as unknown as typeof IntersectionObserver,
    );
    document.body.innerHTML = `
      <article>
        <p id="top">The first article paragraph stays visible.</p>
        <p id="lower" style="display: none">A hidden lower article paragraph stays in the document until it is revealed.</p>
      </article>`;
    const rect = (top: number): DOMRect =>
      ({
        top,
        bottom: top + 30,
        left: 0,
        right: 500,
        width: 500,
        height: 30,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    document.querySelector("#top")!.getBoundingClientRect = () => rect(0);
    const lower = document.querySelector<HTMLElement>("#lower")!;
    lower.getBoundingClientRect = () => rect(240);
    const controller = new TranslationController(config(), generalRule);
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    lower.style.display = "";
    document.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(200);

    const requests = portPosts.filter(
      (
        item,
      ): item is {
        type: "translate";
        paragraphs: Array<{ text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(
      requests.some((request) =>
        request.paragraphs.some(({ text }) =>
          text.includes("hidden lower article paragraph"),
        ),
      ),
    ).toBe(true);
    controller.destroy();
  });

  it("reapplies a cached translation when a virtualized paragraph is recreated", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p id='item'>A virtualized paragraph that stays in the article.</p></article>";
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const firstRequest = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(firstRequest).toBeDefined();
    portListeners[0]?.({
      type: "translateResult",
      requestId: firstRequest?.requestId,
      results:
        firstRequest?.paragraphs.map(({ id }) => ({
          id,
          text: "已缓存的译文",
        })) ?? [],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(800);

    const replacement = document.createElement("p");
    replacement.textContent =
      "A virtualized paragraph that stays in the article.";
    replacement.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 30,
        left: 0,
        right: 500,
        width: 500,
        height: 30,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.querySelector("p")!.replaceWith(replacement);
    document.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(200);

    expect(replacement.querySelector('[data-imt="target"]')?.textContent).toBe(
      "已缓存的译文",
    );
    expect(
      portPosts.filter((item) => (item as { type?: string }).type === "translate"),
    ).toHaveLength(1);
    controller.destroy();
  });

  it("does not duplicate an unchanged translation", async () => {
    vi.useFakeTimers();
    const source =
      "This paragraph should stay visible only once when translation is unchanged.";
    document.body.innerHTML = `<article><p>${source}</p></article>`;
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
      secondaryService: "transmart",
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(request).toBeDefined();
    portListeners[0]?.({
      type: "translateResult",
      requestId: request?.requestId,
      results: request?.paragraphs.map(({ id, text }) => ({ id, text })) ?? [],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('[data-imt="target"]')).toBeNull();
    expect(
      document.querySelector("p")?.textContent?.match(
        /This paragraph should stay visible only once when translation is unchanged\./g,
      ),
    ).toHaveLength(1);
    controller.destroy();
  });

  it("removes echoed English from a translated result when deduplication is enabled", async () => {
    vi.useFakeTimers();
    const source =
      "This English sentence should not be repeated in the translated result.";
    document.body.innerHTML = `<article><p>${source}</p></article>`;
    const controller = new TranslationController(config(), {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(request).toBeDefined();
    portListeners[0]?.({
      type: "translateResult",
      requestId: request?.requestId,
      results: [
        {
          id: request?.paragraphs[0]?.id,
          text: `${source} 这段英文不应在译文中重复出现。`,
        },
      ],
      done: true,
    });

    expect(document.querySelector('[data-imt="target"]')?.textContent).toBe(
      "这段英文不应在译文中重复出现。",
    );
    controller.destroy();
  });

  it("keeps existing translation nodes untouched during rescan", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>A paragraph that has already been translated.</p></article>";
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, generalRule);
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(request).toBeDefined();
    portListeners[0]?.({
      type: "translateResult",
      requestId: request?.requestId,
      results:
        request?.paragraphs.map(({ id }) => ({
          id,
          text: "已经翻译好的内容。",
        })) ?? [],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(0);

    const existing = document.querySelector('[data-imt="target"]');
    expect(existing).not.toBeNull();
    await (
      controller as unknown as { rescan(): Promise<void> }
    ).rescan();

    expect(document.querySelector('[data-imt="target"]')).toBe(existing);
    expect(existing?.textContent).toBe("已经翻译好的内容。");
    controller.destroy();
  });

  it("reapplies a saved per-site override without a translation request", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>This saved paragraph has enough English words for language detection.</p></article>";
    const rule = { ...generalRule, isTranslateTitle: false };
    const paragraph = extractParagraphs(
      document.querySelector("article")!,
      rule,
    )[0]!;
    controllerStorage.values[TRANSLATION_OVERRIDES_KEY] = {
      localhost: { [paragraph.id]: "已保存的译文" },
    };
    const controller = new TranslationController(config(), rule);
    controller.start("main");
    await vi.advanceTimersByTimeAsync(150);

    expect(document.querySelector('[data-imt="target"]')?.textContent).toBe(
      "已保存的译文",
    );
    expect(portPosts).toHaveLength(0);
    controller.destroy();
  });

  it("translates pre-like blocks line by line and restores whitespace", async () => {
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
      secondaryService: "transmart",
    }) as AdvancedPageConfig;
    const rule = {
      ...generalRule,
      isTranslateTitle: false,
      isTransformPreTagNewLine: true,
      likePreSelectors: ["pre"],
    };
    document.body.innerHTML = "<pre>  first line\n\tsecond line  </pre>";
    const controller = new TranslationController(advanced, rule);
    controller.start("whole");
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    const requests = portPosts.filter(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(requests.map((request) => request.paragraphs[0]?.text)).toEqual([
      "first line",
      "second line",
    ]);
    for (const request of requests) {
      const source = request.paragraphs[0]!;
      portListeners[0]?.({
        type: "translateResult",
        requestId: request.requestId,
        results: [
          { id: source.id, text: source.text === "first line" ? "一" : "二" },
        ],
        done: true,
      });
    }
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(document.querySelector('[data-imt="target"]')?.textContent).toBe(
      "  一\n\t二  ",
    );
    controller.destroy();
  });

  it("retries failures silently three times and then leaves the source unchanged", async () => {
    vi.useFakeTimers();
    const source =
      "A long academic paragraph that should be retried without displaying an error card.";
    document.body.innerHTML = `<article><p>${source}</p></article>`;
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const requests = (): Array<{
      requestId: string;
      paragraphs: Array<{ id: string }>;
    }> =>
      portPosts.filter(
        (
          item,
        ): item is {
          type: "translate";
          requestId: string;
          paragraphs: Array<{ id: string }>;
        } => (item as { type?: string }).type === "translate",
      );

    const failLatestRequest = (): void => {
      const request = requests().at(-1);
      expect(request).toBeDefined();
      portListeners[0]?.({
        type: "translateResult",
        requestId: request?.requestId,
        results:
          request?.paragraphs.map(({ id }) => ({
            id,
            error: {
              code: "NETWORK",
              message: "temporary failure",
              retryable: true,
              serviceId: "test",
            },
          })) ?? [],
        done: true,
      });
    };

    failLatestRequest();
    expect(document.querySelector('[data-imt="error"]')).toBeNull();
    expect(document.querySelector("p")?.textContent).toBe(source);

    await vi.advanceTimersByTimeAsync(800);
    expect(requests()).toHaveLength(2);
    failLatestRequest();
    expect(document.querySelector('[data-imt="error"]')).toBeNull();

    await vi.advanceTimersByTimeAsync(1_600);
    expect(requests()).toHaveLength(3);
    failLatestRequest();
    expect(document.querySelector('[data-imt="error"]')).toBeNull();

    await vi.advanceTimersByTimeAsync(3_200);
    expect(requests()).toHaveLength(4);
    failLatestRequest();
    expect(document.querySelector('[data-imt="error"]')).toBeNull();
    expect(document.querySelector("p")?.textContent).toBe(source);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests()).toHaveLength(5);
    failLatestRequest();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector("p")?.textContent).toBe(source);
    await (
      controller as unknown as { rescan(): Promise<void> }
    ).rescan();
    expect(requests()).toHaveLength(5);
    controller.destroy();
  });

  it("bounds retries in integrity mode so a failing paragraph cannot stall the page", async () => {
    vi.useFakeTimers();
    const source =
      "A long paragraph that keeps failing while integrity mode stays enabled.";
    document.body.innerHTML = `<article><p>${source}</p></article>`;
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: true,
      secondaryService: "transmart",
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.setMode("translation");
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const requests = (): Array<{
      requestId: string;
      paragraphs: Array<{ id: string }>;
    }> =>
      portPosts.filter(
        (
          item,
        ): item is {
          type: "translate";
          requestId: string;
          paragraphs: Array<{ id: string }>;
        } => (item as { type?: string }).type === "translate",
      );

    const failLatestRequest = (): void => {
      const request = requests().at(-1);
      if (!request) return;
      portListeners[0]?.({
        type: "translateResult",
        requestId: request.requestId,
        results: request.paragraphs.map(({ id }) => ({
          id,
          error: {
            code: "NETWORK",
            message: "temporary failure",
            retryable: true,
            serviceId: "test",
          },
        })),
        done: true,
      });
    };

    failLatestRequest();
    for (let round = 0; round < 8; round += 1) {
      await vi.advanceTimersByTimeAsync(2_500);
      failLatestRequest();
    }
    await vi.advanceTimersByTimeAsync(2_500);

    expect(document.documentElement.dataset.imtTranslationBusy).toBe("false");
    expect(document.querySelector("p")?.textContent).toBe(source);
    controller.destroy();
  });

  it("treats an empty translation as invalid and requests it again", async () => {
    vi.useFakeTimers();
    const source =
      "A middle paragraph that must not be replaced by an empty translation.";
    document.body.innerHTML = `<article><p>${source}</p></article>`;
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const first = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string }>;
      } => (item as { type?: string }).type === "translate",
    )!;
    portListeners[0]?.({
      type: "translateResult",
      requestId: first.requestId,
      results: [{ id: first.paragraphs[0]!.id, text: "" }],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(800);

    const requests = portPosts.filter(
      (item) => (item as { type?: string }).type === "translate",
    );
    expect(requests).toHaveLength(2);
    expect(document.querySelector('[data-imt="error"]')).toBeNull();

    const second = requests[1] as {
      requestId: string;
      paragraphs: Array<{ id: string }>;
    };
    portListeners[0]?.({
      type: "translateResult",
      requestId: second.requestId,
      results: [{ id: second.paragraphs[0]!.id, text: "有效的译文" }],
      done: true,
    });
    expect(document.querySelector('[data-imt="target"]')?.textContent).toBe(
      "有效的译文",
    );
    controller.destroy();
  });

  it("retries a request that never receives a background result", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>A paragraph that waits too long for a translation result.</p></article>";
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const translationRequests = (): unknown[] =>
      portPosts.filter(
        (item) => (item as { type?: string }).type === "translate",
      );
    expect(translationRequests()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(
      portPosts.some((item) => (item as { type?: string }).type === "cancel"),
    ).toBe(true);
    expect(document.querySelector('[data-imt="error"]')).toBeNull();

    await vi.advanceTimersByTimeAsync(800);
    expect(translationRequests()).toHaveLength(2);
    controller.destroy();
  });

  it("does not translate an ancestor after its child prose blocks are queued", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <ul>
          <li>
            <h4>SSC drives sustainable development across the region.</h4>
            <h5>Stefan Liller is the representative for this initiative.</h5>
          </li>
        </ul>
      </article>`;
    const advanced = Object.assign(config(), {
      translateToPageEndImmediately: true,
    }) as AdvancedPageConfig;
    const controller = new TranslationController(advanced, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        paragraphs: Array<{ text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    const texts = request?.paragraphs.map(({ text }) => text) ?? [];
    expect(
      texts.some((text) =>
        text.includes("drives sustainable development across the region"),
      ),
    ).toBe(true);
    expect(
      texts.some((text) => text.includes("Stefan Liller")),
    ).toBe(true);
    expect(
      texts.some(
        (text) =>
          text.includes("SSC drives sustainable development") &&
          text.includes("Stefan Liller"),
      ),
    ).toBe(false);
    controller.destroy();
  });

  it("splits a long paragraph before calling the translation service", async () => {
    vi.useFakeTimers();
    const sentenceA = `${"A".repeat(220)}.`;
    const sentenceB = `${"B".repeat(220)}.`;
    const sentenceC = `${"C".repeat(220)}.`;
    document.body.innerHTML = `<article><p>${sentenceA} ${sentenceB} ${sentenceC}</p></article>`;
    const controller = new TranslationController(
      Object.assign(config(), {
        translateToPageEndImmediately: true,
        removeDuplicateTranslations: false,
      }) as AdvancedPageConfig,
      { ...generalRule, isTranslateTitle: false },
    );
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const request = portPosts.find(
      (
        item,
      ): item is {
        type: "translate";
        requestId: string;
        paragraphs: Array<{ id: string; text: string }>;
      } => (item as { type?: string }).type === "translate",
    );
    expect(request).toBeDefined();
    expect(request?.paragraphs.length).toBeGreaterThan(1);
    expect(
      request?.paragraphs.every(
        ({ id, text }) => id.includes("::segment-") && text.length <= 480,
      ),
    ).toBe(true);

    portListeners[0]?.({
      type: "translateResult",
      requestId: request?.requestId,
      results:
        request?.paragraphs.map(({ id }, index) => ({
          id,
          text: `\u8bd1\u6587${index}`,
        })) ?? [],
      done: true,
    });

    const expected = (request?.paragraphs ?? [])
      .map((_, index) => `\u8bd1\u6587${index}`)
      .join(" ");
    expect(
      document.querySelector('[data-imt="target"]')?.textContent,
    ).toBe(expected);
    controller.destroy();
  });

  it("triggers secondary service for paragraphs left unrendered after primary pass", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>First paragraph to translate.</p><p>Second paragraph to translate.</p></article>";
    const cfg = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
      secondaryService: "cloud",
      services: {
        ...DEFAULT_CONFIG.services,
        transmart: { ...DEFAULT_CONFIG.services.transmart, enabled: true },
        cloud: { ...DEFAULT_CONFIG.services.cloud, enabled: true },
        "local-model": {
          ...DEFAULT_CONFIG.services["local-model"],
          enabled: true,
        },
      },
    }) as AdvancedPageConfig;
    const controller = new TranslationController(cfg, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const translateRequests = (): Array<{
      requestId: string;
      service?: string;
      paragraphs: Array<{ id: string }>;
    }> =>
      portPosts.filter(
        (
          item,
        ): item is {
          type: "translate";
          requestId: string;
          service?: string;
          paragraphs: Array<{ id: string }>;
        } => (item as { type?: string }).type === "translate",
      );

    const primaryReq = translateRequests().at(-1);
    expect(primaryReq).toBeDefined();
    expect(primaryReq?.service).toBe("transmart");
    const [id1, id2] = primaryReq!.paragraphs.map((p) => p.id);

    portListeners[0]?.({
      type: "translateResult",
      requestId: primaryReq?.requestId,
      results: [
        { id: id1, text: "第一段译文。" },
        {
          id: id2,
          error: {
            code: "NETWORK",
            message: "primary failed",
            retryable: true,
            serviceId: "transmart",
          },
        },
      ],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    const targetsAfterPrimary = document.querySelectorAll(
      '[data-imt="target"]',
    );
    expect(targetsAfterPrimary).toHaveLength(1);
    expect(targetsAfterPrimary[0]?.textContent).toBe("第一段译文。");

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      const retryReq = translateRequests().at(-1);
      expect(retryReq).toBeDefined();
      portListeners[0]?.({
        type: "translateResult",
        requestId: retryReq?.requestId,
        results: retryReq!.paragraphs.map(({ id }) => ({
          id,
          error: {
            code: "NETWORK",
            message: "retry failed",
            retryable: true,
            serviceId: "transmart",
          },
        })),
        done: true,
      });
      await vi.advanceTimersByTimeAsync(50);
    }

    const secondaryReq = translateRequests().at(-1);
    expect(secondaryReq).toBeDefined();
    expect(secondaryReq?.service).toBe("cloud");

    portListeners[0]?.({
      type: "translateResult",
      requestId: secondaryReq?.requestId,
      results: secondaryReq!.paragraphs.map(({ id }) => ({
        id,
        text: "第二段译文。",
      })),
      done: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    const targets = document.querySelectorAll('[data-imt="target"]');
    expect(targets).toHaveLength(2);
    expect(targets[0]?.textContent).toBe("第一段译文。");
    expect(targets[1]?.textContent).toBe("第二段译文。");
    controller.destroy();
  });

  it("falls back to local-model when cloud is not enabled", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>A paragraph that will fail on primary.</p></article>";
    const cfg = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
      secondaryService: "cloud",
      services: {
        ...DEFAULT_CONFIG.services,
        transmart: { ...DEFAULT_CONFIG.services.transmart, enabled: true },
        cloud: { ...DEFAULT_CONFIG.services.cloud, enabled: false },
        "local-model": {
          ...DEFAULT_CONFIG.services["local-model"],
          enabled: true,
        },
      },
    }) as AdvancedPageConfig;
    const controller = new TranslationController(cfg, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const translateRequests = (): Array<{
      requestId: string;
      service?: string;
      paragraphs: Array<{ id: string }>;
    }> =>
      portPosts.filter(
        (
          item,
        ): item is {
          type: "translate";
          requestId: string;
          service?: string;
          paragraphs: Array<{ id: string }>;
        } => (item as { type?: string }).type === "translate",
      );

    const failLatest = (): void => {
      const req = translateRequests().at(-1);
      if (!req) return;
      portListeners[0]?.({
        type: "translateResult",
        requestId: req.requestId,
        results: req.paragraphs.map(({ id }) => ({
          id,
          error: {
            code: "NETWORK",
            message: "fail",
            retryable: true,
            serviceId: "transmart",
          },
        })),
        done: true,
      });
    };

    failLatest();
    await vi.advanceTimersByTimeAsync(50);

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      failLatest();
      await vi.advanceTimersByTimeAsync(50);
    }

    const secondaryReq = translateRequests().at(-1);
    expect(secondaryReq?.service).toBe("local-model");
    controller.destroy();
  });

  it("renders all paragraphs after secondary pass succeeds", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      "<article><p>First sentence here.</p><p>Second sentence here.</p><p>Third sentence here.</p></article>";
    const cfg = Object.assign(config(), {
      translateToPageEndImmediately: true,
      translationIntegrityMode: false,
      secondaryService: "cloud",
      services: {
        ...DEFAULT_CONFIG.services,
        transmart: { ...DEFAULT_CONFIG.services.transmart, enabled: true },
        cloud: { ...DEFAULT_CONFIG.services.cloud, enabled: true },
        "local-model": {
          ...DEFAULT_CONFIG.services["local-model"],
          enabled: true,
        },
      },
    }) as AdvancedPageConfig;
    const controller = new TranslationController(cfg, {
      ...generalRule,
      isTranslateTitle: false,
    });
    controller.start("whole");
    await vi.advanceTimersByTimeAsync(150);

    const translateRequests = (): Array<{
      requestId: string;
      service?: string;
      paragraphs: Array<{ id: string }>;
    }> =>
      portPosts.filter(
        (
          item,
        ): item is {
          type: "translate";
          requestId: string;
          service?: string;
          paragraphs: Array<{ id: string }>;
        } => (item as { type?: string }).type === "translate",
      );

    const primaryReq = translateRequests().at(-1);
    const [idA, idB, idC] = primaryReq!.paragraphs.map((p) => p.id);
    portListeners[0]?.({
      type: "translateResult",
      requestId: primaryReq?.requestId,
      results: [
        { id: idA, text: "第一句。" },
        {
          id: idB,
          error: {
            code: "NETWORK",
            message: "fail",
            retryable: true,
            serviceId: "transmart",
          },
        },
        {
          id: idC,
          error: {
            code: "NETWORK",
            message: "fail",
            retryable: true,
            serviceId: "transmart",
          },
        },
      ],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2_000);
      const retryReq = translateRequests().at(-1);
      expect(retryReq).toBeDefined();
      portListeners[0]?.({
        type: "translateResult",
        requestId: retryReq?.requestId,
        results: retryReq!.paragraphs.map(({ id }) => ({
          id,
          error: {
            code: "NETWORK",
            message: "retry failed",
            retryable: true,
            serviceId: "transmart",
          },
        })),
        done: true,
      });
      await vi.advanceTimersByTimeAsync(50);
    }

    const secondaryReq = translateRequests().at(-1);
    expect(secondaryReq?.service).toBe("cloud");
    const secondaryIds = secondaryReq!.paragraphs.map((p) => p.id).sort();
    expect(secondaryIds).toEqual([idB, idC].sort());

    portListeners[0]?.({
      type: "translateResult",
      requestId: secondaryReq?.requestId,
      results: [
        { id: idB, text: "第二句。" },
        { id: idC, text: "第三句。" },
      ],
      done: true,
    });
    await vi.advanceTimersByTimeAsync(50);

    const targets = document.querySelectorAll('[data-imt="target"]');
    expect(targets).toHaveLength(3);
    expect(targets[0]?.textContent).toBe("第一句。");
    expect(targets[1]?.textContent).toBe("第二句。");
    expect(targets[2]?.textContent).toBe("第三句。");
    controller.destroy();
  });
});
