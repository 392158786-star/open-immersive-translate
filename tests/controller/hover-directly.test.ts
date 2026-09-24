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

  it("passes resolved knowledge to the bookmark callback and marks the word saved", async () => {
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
    const onBookmarkWord = vi.fn().mockResolvedValue(true);
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
    button?.click();

    expect(onBookmarkWord).toHaveBeenCalledWith(
      expect.objectContaining({ word: "Hover" }),
      knowledge,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(button?.disabled).toBe(true);
    dispose();
  });
});
