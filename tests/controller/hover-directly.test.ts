import { afterEach, describe, expect, it, vi } from "vitest";

import { installDirectHoverTranslation } from "../../src/content/controller/hover-directly";
import type { AcademicTermKnowledge } from "../../src/shared/types";

const knowledge: AcademicTermKnowledge = {
  id: "hover",
  term: "Hover",
  translation: "悬停",
  definition: "将指针停留在对象上。",
  domain: "Computer science",
  aliases: [],
  summary: "测试上下文解释。",
  confidence: 0.8,
  sources: [],
  contexts: [],
  updatedAt: Date.now(),
};

function stubPoint(textNode: Text): void {
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: vi.fn(() => ({ offsetNode: textNode, offset: 2 })),
  });
}

function stubElementFromPoint(element: Element): void {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
}

function stubEmptyPoint(): void {
  Object.defineProperty(document, "caretPositionFromPoint", {
    configurable: true,
    value: vi.fn(() => ({ offsetNode: document.body, offset: 0 })),
  });
}

function contextCard(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-imt="context-card"]');
}

function cardElement(): HTMLElement | null {
  return (
    contextCard()?.shadowRoot?.querySelector<HTMLElement>(".card") ?? null
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "caretPositionFromPoint");
  Reflect.deleteProperty(document, "elementFromPoint");
  document.body.replaceChildren();
  document.documentElement
    .querySelectorAll('[data-imt="context-card"]')
    .forEach((element) => element.remove());
});

describe("context hover translation", () => {
  it("resolves the hovered word with sentence context and shows a card", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <h1>Reading mode</h1>
        <p>Hover this paragraph in the article.</p>
      </article>
    `;
    const paragraph = document.querySelector("p")!;
    const textNode = paragraph.firstChild as Text;
    stubPoint(textNode);
    stubElementFromPoint(paragraph);
    const resolve = vi.fn().mockResolvedValue(knowledge);
    const dispose = installDirectHoverTranslation(resolve, { delayMs: 500 });

    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        word: "Hover",
        sentence: "Hover this paragraph in the article.",
        title: "Reading mode",
      }),
    );
    expect(
      document.querySelector('[data-imt="context-card"]'),
    ).not.toBeNull();
    dispose();
  });

  it("does not resolve words inside controls or code", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = "<button>Hover</button><p>Body text</p>";
    const button = document.querySelector("button")!;
    stubElementFromPoint(button);
    const resolve = vi.fn().mockResolvedValue(knowledge);
    const dispose = installDirectHoverTranslation(resolve);

    button.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 2, clientY: 2 }),
    );
    await vi.advanceTimersByTimeAsync(600);

    expect(resolve).not.toHaveBeenCalled();
    dispose();
  });

  it("selects original source text but excludes translated target text", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Hover source paragraph words.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    const sourceText = source.firstChild as Text;
    stubPoint(sourceText);
    stubElementFromPoint(source);
    const sourceResolve = vi.fn().mockResolvedValue(knowledge);
    const sourceDispose = installDirectHoverTranslation(sourceResolve, {
      delayMs: 500,
    });

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(sourceResolve).toHaveBeenCalledWith(
      expect.objectContaining({ word: "Hover" }),
    );
    sourceDispose();

    document.body.innerHTML =
      '<p><font data-imt="target">Translated target words.</font></p>';
    const target = document.querySelector<HTMLElement>(
      'font[data-imt="target"]',
    )!;
    const targetText = target.firstChild as Text;
    stubPoint(targetText);
    stubElementFromPoint(target);
    const targetResolve = vi.fn().mockResolvedValue(knowledge);
    const targetDispose = installDirectHoverTranslation(targetResolve, {
      delayMs: 500,
    });

    target.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(targetResolve).not.toHaveBeenCalled();
    targetDispose();
  });

  it("shows a collectible card while knowledge resolution is pending", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Pending source word.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    stubPoint(source.firstChild as Text);
    stubElementFromPoint(source);
    const dispose = installDirectHoverTranslation(
      vi.fn(() => new Promise<never>(() => undefined)),
      { delayMs: 500 },
    );

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    const host = document.querySelector<HTMLElement>(
      '[data-imt="context-card"]',
    );
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-action="bookmark-word"]',
    );
    expect(host).not.toBeNull();
    expect(button?.disabled).toBe(false);
    expect(button?.dataset.state).toBe("uncollected");
    dispose();
  });

  it("passes resolved knowledge to the bookmark callback and marks the word collected", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <h1>Reading mode</h1>
        <p>Hover this paragraph in the article.</p>
      </article>
    `;
    const paragraph = document.querySelector("p")!;
    const textNode = paragraph.firstChild as Text;
    stubPoint(textNode);
    stubElementFromPoint(paragraph);
    const onBookmarkWord = vi.fn().mockResolvedValue("collected");
    const dispose = installDirectHoverTranslation(
      vi.fn().mockResolvedValue(knowledge),
      { delayMs: 500, onBookmarkWord },
    );

    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    const host = document.querySelector<HTMLElement>(
      '[data-imt="context-card"]',
    );
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-action="bookmark-word"]',
    );
    expect(button).toBeTruthy();
    expect(button?.closest(".details")).toBeNull();
    expect(button?.dataset.state).toBe("uncollected");
    expect(button?.getAttribute("aria-label")).toBe("收藏词语");
    expect(
      host?.shadowRoot?.querySelector('button[data-action="bookmark-article"]'),
    ).toBeNull();
    button?.click();

    expect(onBookmarkWord).toHaveBeenCalledWith(
      expect.objectContaining({ word: "Hover" }),
      knowledge,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.dataset.state).toBe("collected");
    expect(button?.getAttribute("aria-label")).toBe("已收藏");
    dispose();
  });

  it("restores the collected state from getBookmarkState", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <article>
        <h1>Reading mode</h1>
        <p>Hover this paragraph in the article.</p>
      </article>
    `;
    const paragraph = document.querySelector("p")!;
    const textNode = paragraph.firstChild as Text;
    stubPoint(textNode);
    stubElementFromPoint(paragraph);
    const dispose = installDirectHoverTranslation(
      vi.fn().mockResolvedValue(knowledge),
      { delayMs: 500, getBookmarkState: vi.fn().mockResolvedValue("collected") },
    );

    paragraph.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);

    const host = document.querySelector<HTMLElement>(
      '[data-imt="context-card"]',
    );
    const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-action="bookmark-word"]',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.dataset.state).toBe("collected");
    dispose();
  });

  it("keeps the card open while the pointer crosses from the word to the card", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Hover source word.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    stubPoint(source.firstChild as Text);
    stubElementFromPoint(source);
    const dispose = installDirectHoverTranslation(
      vi.fn(() => new Promise<never>(() => undefined)),
      { delayMs: 500 },
    );

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(contextCard()).not.toBeNull();

    stubEmptyPoint();
    stubElementFromPoint(document.body);
    document.body.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 200, clientY: 300 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(contextCard()).not.toBeNull();

    cardElement()?.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        composed: true,
        clientX: 200,
        clientY: 300,
      }),
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(contextCard()).not.toBeNull();
    dispose();
  });

  it("keeps the card open while the pointer is inside it", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Hover source word.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    stubPoint(source.firstChild as Text);
    stubElementFromPoint(source);
    const dispose = installDirectHoverTranslation(
      vi.fn(() => new Promise<never>(() => undefined)),
      { delayMs: 500 },
    );

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(contextCard()).not.toBeNull();

    const card = cardElement()!;
    for (let index = 0; index < 3; index += 1) {
      card.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          composed: true,
          clientX: 200 + index,
          clientY: 300,
        }),
      );
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(contextCard()).not.toBeNull();
    dispose();
  });

  it("closes the card after the pointer leaves it and the grace expires", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Hover source word.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    stubPoint(source.firstChild as Text);
    stubElementFromPoint(source);
    const dispose = installDirectHoverTranslation(
      vi.fn(() => new Promise<never>(() => undefined)),
      { delayMs: 500 },
    );

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(contextCard()).not.toBeNull();

    const card = cardElement()!;
    card.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        composed: true,
        clientX: 200,
        clientY: 300,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    stubEmptyPoint();
    stubElementFromPoint(document.body);
    document.body.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 500, clientY: 600 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(contextCard()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(100);
    expect(contextCard()).toBeNull();
    dispose();
  });

  it("re-entering during grace cancels the close", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<p><font data-imt="source">Hover source word.</font></p>';
    const source = document.querySelector<HTMLElement>(
      'font[data-imt="source"]',
    )!;
    stubPoint(source.firstChild as Text);
    stubElementFromPoint(source);
    const dispose = installDirectHoverTranslation(
      vi.fn(() => new Promise<never>(() => undefined)),
      { delayMs: 500 },
    );

    source.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(contextCard()).not.toBeNull();

    const card = cardElement()!;
    card.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        composed: true,
        clientX: 200,
        clientY: 300,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    stubEmptyPoint();
    stubElementFromPoint(document.body);
    document.body.dispatchEvent(
      new MouseEvent("mousemove", { bubbles: true, clientX: 500, clientY: 600 }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(contextCard()).not.toBeNull();

    cardElement()?.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        composed: true,
        clientX: 200,
        clientY: 300,
      }),
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(contextCard()).not.toBeNull();
    dispose();
  });
});
