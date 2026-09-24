import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  injectStyles,
  isTranslated,
  layoutGuideFrames,
  layoutHeadingFrames,
  markTranslated,
  removeAll,
  renderTranslation,
  resolveAutomaticTranslationColor,
  restoreRenderedScrollAnchor,
  segmentRenderedText,
  setError,
  setLoading,
  setMode,
} from "../../src/content/render/inject";
import type { Paragraph } from "../../src/shared/types";

function makeParagraph(container: Element): Paragraph {
  return {
    id: "paragraph-1",
    container,
    nodes: [...container.childNodes],
    text: container.textContent ?? "",
    placeholders: new Map(),
  };
}

function translationFragment(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  fragment.append(text);
  return fragment;
}

afterEach(() => {
  removeAll(document);
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("renderTranslation", () => {
  it("holds the exact scroll position after translation changes layout", () => {
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);

    restoreRenderedScrollAnchor({ x: 0, y: 120 });

    expect(scrollTo).toHaveBeenCalledWith(0, 120);
  });

  it("inserts a dual translation after a block source", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;

    const target = renderTranslation(
      makeParagraph(container),
      translationFragment("你好"),
      {
        mode: "dual",
        theme: "underline",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(container.childNodes[1]).toBe(target);
    expect(target.classList.contains("imt-target-block")).toBe(true);
    expect(target.style.maxWidth).toBe("100%");
    expect(target.style.minWidth).toBe("0");
    expect(target.style.overflowWrap).toBe("anywhere");
    expect(target.style.whiteSpace).toBe("normal");
    expect(target.outerHTML).toContain('data-imt="target"');
    expect(target.textContent).toBe("你好");
    expect(container.textContent).toBe("Hello你好");
  });

  it("keeps headings visible and collapses body translations in research mode", () => {
    document.body.innerHTML =
      "<article><h1>Research title</h1><p>Lead paragraph</p><p>Research body</p></article>";
    const heading = document.querySelector("h1")!;
    const lead = document.querySelector("p")!;
    const paragraph = document.querySelectorAll("p")[1]!;

    const headingTarget = renderTranslation(
      makeParagraph(heading),
      translationFragment("研究标题"),
      {
        mode: "dual",
        readingMode: "research",
        theme: "underline",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    const bodyTarget = renderTranslation(
      makeParagraph(paragraph),
      translationFragment("研究正文"),
      {
        mode: "dual",
        readingMode: "research",
        theme: "underline",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    const leadTarget = renderTranslation(
      makeParagraph(lead),
      translationFragment("引导译文"),
      {
        mode: "dual",
        readingMode: "research",
        theme: "underline",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    const toggle = paragraph.querySelector<HTMLButtonElement>(
      '[data-imt="reading-toggle"]',
    )!;

    expect(headingTarget.style.display).toBe("none");
    expect(leadTarget.style.display).toBe("none");
    expect(bodyTarget.style.display).toBe("none");
    expect(toggle.hidden).toBe(false);

    toggle.click();
    expect(bodyTarget.style.display).not.toBe("none");
  });

  it("maps dark source text to blue and blue source text to black", () => {
    document.body.style.background = "rgb(255, 255, 255)";
    const dark = document.createElement("p");
    dark.style.color = "rgb(20, 20, 20)";
    document.body.append(dark);
    expect(resolveAutomaticTranslationColor(dark)).toBe("#4da3ff");

    const blue = document.createElement("p");
    blue.style.color = "rgb(31, 111, 235)";
    document.body.append(blue);
    expect(resolveAutomaticTranslationColor(blue)).toBe("#000000");
  });

  it("shrinks constrained source text without shrinking the target", () => {
    document.body.innerHTML =
      '<div class="card"><h4><a href="/story">A constrained English source headline.</a></h4></div>';
    const card = document.querySelector(".card") as HTMLElement;
    const container = document.querySelector("h4") as HTMLElement;
    const source = document.querySelector("a") as HTMLElement;
    container.style.fontSize = "14px";
    source.style.display = "block";
    const containerRect = {
      top: 0,
      bottom: 56,
      left: 0,
      right: 320,
      width: 320,
      height: 56,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const cardRect = {
      ...containerRect,
      bottom: 80,
      height: 80,
    } as DOMRect;
    const targetRect = {
      ...containerRect,
      top: 56,
      bottom: 104,
      height: 48,
      y: 56,
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === container) return containerRect;
        if (this === card) return cardRect;
        if (
          this instanceof HTMLElement &&
          this.dataset.imt === "target"
        ) {
          return targetRect;
        }
        return {
          ...containerRect,
          width: 0,
          height: 0,
          bottom: 0,
          right: 0,
        } as DOMRect;
      },
    );
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 104,
    });
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 56,
    });
    Object.defineProperty(card, "scrollHeight", {
      configurable: true,
      value: 104,
    });
    Object.defineProperty(card, "clientHeight", {
      configurable: true,
      value: 80,
    });
    const originalFontSize =
      Number.parseFloat(getComputedStyle(container).fontSize) || 16;

    const target = renderTranslation(
      makeParagraph(container),
      translationFragment("需要保持原字号的中文标题"),
      {
        mode: "dual",
        theme: "underline",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(Number.parseFloat(source.style.fontSize)).toBeLessThan(
      originalFontSize,
    );
    expect(Number.parseFloat(target.style.fontSize)).toBeLessThan(
      originalFontSize,
    );
    expect(container.style.height).toBe("");
    expect(container.style.minHeight).toBe("");
    expect(container.style.overflow).toBe("");
    expect(card.style.height).toBe("");
    expect(card.style.minHeight).toBe("");

    removeAll(document);
    expect(container.style.height).toBe("");
    expect(container.style.fontSize).toBe("14px");
    expect(source.style.fontSize).toBe("");
  });

  it("keeps navigation translations inside the interactive control", () => {
    document.body.innerHTML =
      '<li><a href="/home">HOME</a><span class="icon"></span></li>';
    const container = document.querySelector("li") as HTMLElement;
    const link = document.querySelector("a") as HTMLAnchorElement;

    renderTranslation(makeParagraph(container), translationFragment("首页"), {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(link.querySelector('[data-imt="target"]')?.textContent).toBe("首页");
    expect(container.querySelector(':scope > [data-imt="target"]')).toBeNull();
    expect(link.getAttribute("href")).toBe("/home");
  });

  it("wraps a guide translation when it touches the frame edge", () => {
    document.body.innerHTML =
      '<div><a href="/editorials">Editorials</a></div>';
    const link = document.querySelector("a") as HTMLAnchorElement;
    const rect = {
      top: 0,
      bottom: 30,
      left: 0,
      right: 30,
      width: 30,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rect,
    );
    const target = renderTranslation(
      makeParagraph(link),
      translationFragment("社论"),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    Object.defineProperty(link, "clientWidth", {
      configurable: true,
      value: 30,
    });
    Object.defineProperty(link, "scrollWidth", {
      configurable: true,
      value: 30,
    });
    Object.defineProperty(target, "scrollWidth", {
      configurable: true,
      value: 30,
    });

    layoutGuideFrames();

    expect(target.dataset.imtGuideWrapped).toBe("true");
    expect(target.style.whiteSpace).toBe("normal");
    expect(target.style.overflowWrap).toBe("anywhere");
    expect(link.getAttribute("href")).toBe("/editorials");
  });

  it("replaces an older target when the same control is translated twice", () => {
    document.body.innerHTML = '<li><a href="/home">HOME</a></li>';
    const listItem = document.querySelector("li") as HTMLElement;
    const link = document.querySelector("a") as HTMLElement;
    const options = {
      mode: "dual" as const,
      theme: "none",
      wrapperTag: "font" as const,
      prefix: "smart" as const,
    };

    renderTranslation(makeParagraph(listItem), translationFragment("首页"), options);
    renderTranslation(makeParagraph(link), translationFragment("首页"), options);

    expect(link.querySelectorAll(':scope > [data-imt="target"]')).toHaveLength(1);
    expect(link.getAttribute("href")).toBe("/home");
  });

  it("uses vertical whitespace to enlarge normal dual text", () => {
    document.body.innerHTML =
      "<p>A normal paragraph with enough text for translation.</p>";
    const container = document.querySelector("p") as HTMLElement;
    container.style.fontSize = "16px";
    const containerRect = {
      top: 0,
      bottom: 120,
      left: 0,
      right: 500,
      width: 500,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const targetRect = {
      ...containerRect,
      top: 50,
      bottom: 80,
      height: 30,
      y: 50,
    } as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === container) return containerRect;
        if (this.dataset.imt === "target") return targetRect;
        return containerRect;
      },
    );
    Object.defineProperty(container, "clientHeight", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(container, "scrollHeight", {
      configurable: true,
      value: 50,
    });
    Object.defineProperty(container, "clientWidth", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(container, "scrollWidth", {
      configurable: true,
      value: 300,
    });

    const target = renderTranslation(
      makeParagraph(container),
      translationFragment("这是一段用于测试空白区域放大的普通文本。"),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(Number.parseFloat(container.style.fontSize)).toBeGreaterThan(16);
    expect(Number.parseFloat(target.style.fontSize)).toBeGreaterThan(16);
    expect(Number.parseFloat(container.style.fontSize)).toBeLessThanOrEqual(
      19.2,
    );
  });

  it("lays out short heading frames with smaller English and prominent Chinese", async () => {
    document.body.innerHTML =
      '<h3 style="font-size:20px;font-weight:700">China Perspectives</h3>';
    const container = document.querySelector("h3") as HTMLElement;

    const target = renderTranslation(
      makeParagraph(container),
      translationFragment("中国视角"),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    layoutHeadingFrames();

    const sourceSize = Number.parseFloat(container.style.fontSize);
    const targetSize = Number.parseFloat(target.style.fontSize);
    expect(sourceSize).toBeLessThan(targetSize);
    expect(targetSize).toBeLessThan(20);
    expect(target.style.whiteSpace).toBe("normal");
    expect(target.style.overflowWrap).toBe("anywhere");
    expect(target.dataset.imtHeadingFrame).toBe("true");
  });

  it("hides an inline source without adding a line break in translation-only mode", () => {
    document.body.innerHTML = "<span>Hello</span>";
    const container = document.querySelector("span")!;

    renderTranslation(makeParagraph(container), translationFragment("你好"), {
      mode: "translation",
      theme: "none",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(container.querySelector('[data-imt="br"]')).toBeNull();
    expect(
      container
        .querySelector('[data-imt="source"]')
        ?.classList.contains("imt-source-hidden"),
    ).toBe(true);
    expect(container.querySelector('[data-imt="target"]')?.textContent).toBe(
      "你好",
    );
  });

  it("marks translation-only targets for in-place layout", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;

    renderTranslation(makeParagraph(container), translationFragment("你好"), {
      mode: "translation",
      theme: "underline",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(
      container
        .querySelector('[data-imt="target"]')
        ?.classList.contains("imt-target-replace"),
    ).toBe(true);
  });

  it("segments long translations at sentence boundaries", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "这是第一句完整的中文翻译，用于确认长段落可以按照句子边界进行显示。第二句继续补充上下文，并确保整段翻译不会挤在同一行里。第三句用于验证分号；第四句确认不会破坏原始含义和页面结构。",
      ),
      {
        mode: "translation",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    const segments = container.querySelectorAll<HTMLElement>(
      ".imt-target-segment",
    );
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]?.style.getPropertyValue("display")).toBe("block");
    expect(segments[0]?.style.getPropertyPriority("display")).toBe(
      "important",
    );
    expect(container.querySelector('[data-imt="target"]')?.textContent).toBe(
      "这是第一句完整的中文翻译，用于确认长段落可以按照句子边界进行显示。第二句继续补充上下文，并确保整段翻译不会挤在同一行里。第三句用于验证分号；第四句确认不会破坏原始含义和页面结构。",
    );
  });

  it("segments rich translations without removing inline controls", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 150,
      width: 150,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const fragment = document.createDocumentFragment();
    fragment.append(
      "\u8fd9\u662f\u7b2c\u4e00\u53e5\u5b8c\u6574\u4e14\u53ef\u8bfb\u7684\u8bd1\u6587\u3002",
    );
    const link = document.createElement("a");
    link.href = "/reference";
    link.textContent =
      "\u8fd9\u662f\u5305\u542b\u94fe\u63a5\u7684\u7b2c\u4e8c\u53e5\u8bd1\u6587\u3002";
    fragment.append(link);
    fragment.append(
      "\u8fd9\u662f\u7528\u4e8e\u786e\u8ba4\u5206\u6bb5\u540e\u4ecd\u7136\u4fdd\u7559\u94fe\u63a5\u548c\u987a\u5e8f\u7684\u7b2c\u4e09\u53e5\u8bd1\u6587\u3002",
    );

    renderTranslation(makeParagraph(container), fragment, {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(
      container.querySelectorAll(".imt-target-segment").length,
    ).toBeGreaterThan(1);
    expect(
      container.querySelector('[data-imt="target"] a')?.getAttribute("href"),
    ).toBe("/reference");
  });

  it("segments a two-line translation even when it is short", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 150,
      width: 150,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "\u7b2c\u4e00\u53e5\u77ed\u8bd1\u6587\u3002\u7b2c\u4e8c\u53e5\u77ed\u8bd1\u6587\u3002\u7b2c\u4e09\u53e5\u77ed\u8bd1\u6587\u3002",
      ),
      {
        mode: "translation",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(
      container.querySelectorAll(".imt-target-segment").length,
    ).toBeGreaterThan(1);
  });

  it("uses the full width of Chinese characters when grouping lines", () => {
    document.body.innerHTML = '<p style="font-size:20px">Hello</p>';
    const container = document.querySelector("p")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 200,
      width: 200,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "\u8fd9\u662f\u7b2c\u4e00\u53e5\u7528\u4e8e\u68c0\u67e5\u4e2d\u6587\u5b57\u7b26\u5b9e\u9645\u5bbd\u5ea6\u7684\u8bd1\u6587\u3002" +
          "\u8fd9\u662f\u7b2c\u4e8c\u53e5\u7528\u4e8e\u68c0\u67e5\u4e2d\u6587\u5b57\u7b26\u5b9e\u9645\u5bbd\u5ea6\u7684\u8bd1\u6587\u3002" +
          "\u8fd9\u662f\u7b2c\u4e09\u53e5\u7528\u4e8e\u68c0\u67e5\u4e2d\u6587\u5b57\u7b26\u5b9e\u9645\u5bbd\u5ea6\u7684\u8bd1\u6587\u3002",
      ),
      {
        mode: "translation",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(
      container.querySelectorAll(".imt-target-segment").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("segments long interactive text without removing the original control", () => {
    const source =
      "A very long interactive recommendation title without punctuation that still needs readable blocks";
    document.body.innerHTML = `<div><a href="/paper">${source}</a></div>`;
    const container = document.querySelector("div")!;
    const link = document.querySelector("a")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 30,
      left: 0,
      right: 180,
      width: 180,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "这是一个很长的交互式推荐论文标题，用来确认译文依然可以按照行数分段，同时保留原链接的全部点击功能",
      ),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(link.querySelectorAll(".imt-target-segment").length).toBeGreaterThan(
      1,
    );
    expect(link.getAttribute("href")).toBe("/paper");
    expect(link.querySelector('[data-imt="target"]')).not.toBeNull();
  });

  it("reseegments after the available width changes", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const container = document.querySelector("p")!;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        top: 0,
        bottom: 20,
        left: 0,
        right: 640,
        width: 640,
        height: 20,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    const target = renderTranslation(
      makeParagraph(container),
      translationFragment(
        "\u7b2c\u4e00\u53e5\u77ed\u8bd1\u6587\u3002\u7b2c\u4e8c\u53e5\u77ed\u8bd1\u6587\u3002\u7b2c\u4e09\u53e5\u77ed\u8bd1\u6587\u3002",
      ),
      {
        mode: "translation",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );
    expect(target.querySelectorAll(".imt-target-segment")).toHaveLength(0);

    rect.mockReturnValue({
      top: 0,
      bottom: 60,
      left: 0,
      right: 150,
      width: 150,
      height: 60,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    segmentRenderedText(target);

    expect(
      target.querySelectorAll(".imt-target-segment").length,
    ).toBeGreaterThan(1);
  });

  it("renders alternating English and Chinese line pairs", () => {
    const source =
      "This is the first English line with enough content to wrap across the paragraph. This is the second English line with more context for the first pair. This is the third English line that begins the following pair. This is the fourth English line with additional details. This is the fifth English line to complete the example.";
    document.body.innerHTML = `<p>${source}</p>`;
    const container = document.querySelector("p")!;
    container.style.color = "rgb(12, 34, 56)";

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "这是第一组中文，用于对应前面的英文内容并保持完整含义。这是第二组中文，继续保留相同含义。这是第三组中文，按照两行一组的方式排列。这是第四组中文，确保整段内容不会被挤成一整块。",
      ),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
      },
    );

    expect(
      container.querySelectorAll(".imt-target-pair").length,
    ).toBeGreaterThan(1);
    expect(
      container.querySelectorAll(".imt-pair-source-block").length,
    ).toBeGreaterThan(1);
    expect(
      container.querySelectorAll(".imt-pair-target-block").length,
    ).toBeGreaterThan(1);
    expect(
      container
        .querySelector('[data-imt="source"]')
        ?.classList.contains("imt-source-hidden"),
    ).toBe(true);
  });

  it("pairs sentence translations in their original order", () => {
    const source =
      "The first sentence explains the method clearly. The second sentence reports the measured result.";
    document.body.innerHTML = `<p>${source}</p>`;
    const container = document.querySelector("p")!;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 20,
      left: 0,
      right: 160,
      width: 160,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    renderTranslation(
      makeParagraph(container),
      translationFragment(
        "\u7b2c\u4e00\u53e5\u89e3\u91ca\u65b9\u6cd5\u3002\u7b2c\u4e8c\u53e5\u62a5\u544a\u7ed3\u679c\u3002",
      ),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
        translatedSegments: [
          "\u7b2c\u4e00\u53e5\u89e3\u91ca\u65b9\u6cd5\u3002",
          "\u7b2c\u4e8c\u53e5\u62a5\u544a\u7ed3\u679c\u3002",
        ],
      },
    );

    const pairs = container.querySelectorAll(".imt-target-pair");
    expect(
      pairs[0]?.querySelector(".imt-pair-target-block")?.textContent,
    ).toBe("\u7b2c\u4e00\u53e5\u89e3\u91ca\u65b9\u6cd5\u3002");
    expect(
      pairs[1]?.querySelector(".imt-pair-target-block")?.textContent,
    ).toBe("\u7b2c\u4e8c\u53e5\u62a5\u544a\u7ed3\u679c\u3002");
  });

  it("does not repeat a translation when the source has more sentences", () => {
    const source =
      "The first sentence explains the method clearly. The second sentence reports the measured result. The third sentence adds important context.";
    document.body.innerHTML = `<p>${source}</p>`;
    const container = document.querySelector("p")!;

    renderTranslation(
      makeParagraph(container),
      translationFragment("第一句解释方法。第二句补充重要背景。"),
      {
        mode: "dual",
        theme: "none",
        wrapperTag: "font",
        prefix: "smart",
        translatedSegments: ["第一句解释方法。", "第二句补充重要背景。"],
      },
    );

    const targetTexts = [
      ...container.querySelectorAll(".imt-pair-target-block"),
    ].map((element) => element.textContent?.trim());
    expect(targetTexts.filter((text) => text === "第一句解释方法。")).toHaveLength(1);
    expect(
      targetTexts.filter((text) => text === "第二句补充重要背景。"),
    ).toHaveLength(1);
  });

  it("keeps interactive elements visible while replacing their label text", () => {
    document.body.innerHTML =
      '<div><a href="/explore">Explore content</a></div>';
    const container = document.querySelector("div")!;
    const link = document.querySelector("a")!;

    renderTranslation(makeParagraph(container), translationFragment("探索内容"), {
      mode: "translation",
      theme: "underline",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(link.classList.contains("imt-source-hidden")).toBe(false);
    expect(link.getAttribute("href")).toBe("/explore");
    expect(link.querySelector('[data-imt="target"]')?.textContent).toBe(
      "探索内容",
    );
    expect(
      link
        .querySelector('[data-imt="source"]')
        ?.classList.contains("imt-source-hidden"),
    ).toBe(true);
  });

  it("hides source elements in translation-only mode and restores them later", () => {
    document.body.innerHTML =
      '<p>Read the <a href="/guide">JavaScript Guide</a> first.</p>';
    const container = document.querySelector("p")!;
    const link = document.querySelector("a")!;

    renderTranslation(makeParagraph(container), translationFragment("先阅读指南。"), {
      mode: "translation",
      theme: "underline",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(link.classList.contains("imt-source-hidden")).toBe(true);
    expect(link.getAttribute("href")).toBe("/guide");
    expect(link.textContent).toBe("JavaScript Guide");
    expect(container.querySelector('[data-imt="target"]')?.textContent).toBe(
      "先阅读指南。",
    );

    setMode(document, "dual");
    expect(link.classList.contains("imt-source-hidden")).toBe(false);
    expect(link.getAttribute("href")).toBe("/guide");
  });

  it("honors explicit block and inline prefixes", () => {
    document.body.innerHTML = "<span id='block'>A</span><p id='inline'>B</p>";
    const block = document.querySelector("#block")!;
    const inline = document.querySelector("#inline")!;

    renderTranslation(makeParagraph(block), translationFragment("甲"), {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "block",
    });
    renderTranslation(makeParagraph(inline), translationFragment("乙"), {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "inline",
    });

    expect(
      block
        .querySelector('[data-imt="target"]')
        ?.classList.contains("imt-target-block"),
    ).toBe(true);
    expect(
      inline
        .querySelector('[data-imt="target"]')
        ?.classList.contains("imt-target-block"),
    ).toBe(false);
  });

  it("uses computed block display for smart prefixes", () => {
    document.body.innerHTML = "<span style='display: grid'>A</span>";
    const container = document.querySelector("span")!;

    renderTranslation(makeParagraph(container), translationFragment("甲"), {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "smart",
    });

    expect(
      container
        .querySelector('[data-imt="target"]')
        ?.classList.contains("imt-target-block"),
    ).toBe(true);
  });

  it("replaces loading, result, and error states and runs retry", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const paragraph = makeParagraph(document.querySelector("p")!);
    const retry = vi.fn();

    setLoading(paragraph);
    expect(
      paragraph.container.querySelector('[data-imt="loading"]'),
    ).not.toBeNull();

    renderTranslation(paragraph, translationFragment("你好"), {
      mode: "dual",
      theme: "highlight",
      wrapperTag: "font",
      prefix: "smart",
    });
    expect(
      paragraph.container.querySelector('[data-imt="loading"]'),
    ).toBeNull();
    expect(
      paragraph.container.querySelector('[data-imt="target"]'),
    ).not.toBeNull();

    setError(paragraph, "Network error", retry);
    expect(paragraph.container.querySelector('[data-imt="target"]')).toBeNull();
    expect(
      paragraph.container.querySelector('[data-imt="error"]')?.textContent,
    ).toContain("Network error");
    paragraph.container
      .querySelector<HTMLButtonElement>('[data-imt="retry"]')!
      .click();
    expect(retry).toHaveBeenCalledOnce();
  });

  it("restores the original DOM exactly when all translations are removed", () => {
    document.body.innerHTML =
      '<article><p class="lead">Hello <em>world</em></p></article>';
    const paragraph = makeParagraph(document.querySelector("p")!);
    markTranslated(paragraph.container, paragraph.id);

    renderTranslation(paragraph, translationFragment("你好世界"), {
      mode: "translation",
      theme: "paper",
      wrapperTag: "font",
      prefix: "smart",
    });
    removeAll(document);

    expect(document.body.innerHTML).toMatchInlineSnapshot(
      `"<article><p class="lead">Hello <em>world</em></p></article>"`,
    );
  });

  it("toggles modes and tracks translated containers", () => {
    document.body.innerHTML = "<p>Hello</p>";
    const paragraph = makeParagraph(document.querySelector("p")!);
    renderTranslation(paragraph, translationFragment("你好"), {
      mode: "dual",
      theme: "none",
      wrapperTag: "font",
      prefix: "smart",
    });

    setMode(document, "translation");
    const source = paragraph.container.querySelector('[data-imt="source"]')!;
    expect(source.classList.contains("imt-source-hidden")).toBe(true);
    setMode(document, "dual");
    expect(source.classList.contains("imt-source-hidden")).toBe(false);

    expect(isTranslated(paragraph.container)).toBe(false);
    markTranslated(paragraph.container, paragraph.id);
    expect(isTranslated(paragraph.container)).toBe(true);
  });
});

describe("injectStyles", () => {
  it("injects site CSS once, then updates the same style", () => {
    injectStyles(document, [".site-rule { color: tomato; }"]);
    const style = document.head.querySelector<HTMLStyleElement>(
      'style[data-imt="style"]',
    )!;

    expect(style.textContent).toContain(".site-rule { color: tomato; }");

    injectStyles(document, [".second-rule { color: teal; }"]);
    expect(
      document.head.querySelectorAll('style[data-imt="style"]'),
    ).toHaveLength(1);
    expect(style.textContent).toContain(".second-rule { color: teal; }");
    expect(style.textContent).not.toContain(".site-rule { color: tomato; }");
  });

  it("defines every theme, shared variables, and dark mode", () => {
    const css = readFileSync("src/content/render/themes.css", "utf8");
    const themes = [
      "none",
      "underline",
      "dashed",
      "dotted",
      "highlight",
      "mask",
      "opacity",
      "blockquote",
      "paper",
      "bold",
      "italic",
      "grey",
      "dividingLine",
      "wavy",
      "marker",
    ];

    for (const theme of themes) {
      expect(css).toContain(`.imt-theme-${theme}`);
    }
    expect(css).toContain("--imt-target-color");
    expect(css).toContain("--imt-target-font");
    expect(css).toContain("--imt-highlight-bg");
    expect(css).toContain("--imt-error-color");
    expect(css).toContain("max-width: 100% !important");
    expect(css).toContain("overflow-wrap: anywhere !important");
    expect(css).toContain(".imt-target table");
    expect(css).toContain(".imt-target th");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("injects the shared stylesheet into a shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });

    injectStyles(shadow, [".shadow-rule { color: teal; }"]);

    const style = shadow.querySelector<HTMLStyleElement>(
      'style[data-imt="style"]',
    );
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain(".shadow-rule { color: teal; }");
  });

  it("uses an adopted stylesheet when constructable stylesheets are available", () => {
    const prototype = window.CSSStyleSheet.prototype as CSSStyleSheet & {
      replaceSync?: (css: string) => void;
    };
    const originalReplaceSync = Object.getOwnPropertyDescriptor(
      prototype,
      "replaceSync",
    );
    const cssTexts: string[] = [];
    Object.defineProperty(document, "adoptedStyleSheets", {
      configurable: true,
      value: [],
      writable: true,
    });
    Object.defineProperty(prototype, "replaceSync", {
      configurable: true,
      value(css: string) {
        cssTexts.push(css);
      },
      writable: true,
    });

    try {
      injectStyles(document, [".adopted { color: green; }"]);
      expect(document.adoptedStyleSheets).toHaveLength(1);
      expect(cssTexts.at(-1)).toContain(".adopted { color: green; }");
      expect(document.querySelector('style[data-imt="style"]')).toBeNull();
    } finally {
      removeAll(document);
      Reflect.deleteProperty(document, "adoptedStyleSheets");
      if (originalReplaceSync) {
        Object.defineProperty(prototype, "replaceSync", originalReplaceSync);
      } else {
        Reflect.deleteProperty(prototype, "replaceSync");
      }
    }
  });
});
