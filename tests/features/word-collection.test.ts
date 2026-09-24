import { afterEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  runtime: {
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  },
}));

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import {
  WordCollectionDrawer,
  type WordCollectionAdapter,
} from "../../src/content/features/word-collection";
import type { SavedWord } from "../../src/shared/learning-types";

function savedWord(overrides: Partial<SavedWord> = {}): SavedWord {
  return {
    id: "w1",
    articleId: "a1",
    word: "algorithm",
    normalizedKey: "algorithm",
    contextHash: "ctx",
    sentence: "An algorithm is a set of steps.",
    previousSentence: "",
    nextSentence: "",
    paragraphTheme: "Introduction",
    domain: "Computer science",
    translation: "算法",
    partOfSpeech: "noun",
    definition: "A procedure for solving a problem.",
    createdAt: 1,
    updatedAt: 2,
    syncStatus: "local",
    ...overrides,
  };
}

interface Harness {
  adapter: WordCollectionAdapter;
  setArticleId(id: string): void;
  setWords(words: SavedWord[]): void;
  listWords: ReturnType<typeof vi.fn>;
  removeWords: ReturnType<typeof vi.fn>;
  emitChanged(): void;
  emitUrlChange(url: string): void;
}

function harness(overrides: Partial<WordCollectionAdapter> = {}): Harness {
  let articleId = "a1";
  let words: SavedWord[] = [];
  const changedListeners: Array<() => void> = [];
  const urlListeners: Array<(url: string) => void> = [];
  const listWords = vi.fn(
    async (id: string) => words.filter((word) => word.articleId === id),
  );
  const removeWords = vi.fn(async (ids: string[]) => {
    words = words.filter((word) => !ids.includes(word.id));
  });
  const adapter: WordCollectionAdapter = {
    currentArticleId: vi.fn(async () => articleId),
    listWords,
    removeWords,
    onChanged: vi.fn((listener: () => void) => {
      changedListeners.push(listener);
      return () => undefined;
    }),
    onUrlChange: vi.fn((listener: (url: string) => void) => {
      urlListeners.push(listener);
      return () => undefined;
    }),
    isSupported: vi.fn(() => true),
    ...overrides,
  };
  return {
    adapter,
    setArticleId: (id: string) => {
      articleId = id;
    },
    setWords: (next: SavedWord[]) => {
      words = next;
    },
    listWords,
    removeWords,
    emitChanged: () => {
      for (const listener of changedListeners) listener();
    },
    emitUrlChange: (url: string) => {
      for (const listener of urlListeners) listener(url);
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function query(selector: string): HTMLElement | null {
  const host = document.querySelector<HTMLElement>(
    '[data-imt="word-collection"]',
  );
  return host?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

afterEach(() => {
  document.documentElement
    .querySelectorAll('[data-imt="word-collection"]')
    .forEach((element) => element.remove());
  vi.clearAllMocks();
});

describe("word collection drawer", () => {
  it("shows the handle and keeps the drawer closed by default", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    drawer.mount();
    await flush();

    expect(query(".handle")?.hidden).toBe(false);
    expect(query(".drawer")?.hidden).toBe(true);
    drawer.dispose();
  });

  it("opens and closes the drawer when the handle and close button are clicked", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    drawer.mount();
    await flush();

    query(".handle")?.click();
    expect(query(".drawer")?.hidden).toBe(false);

    query(".drawer-close")?.click();
    expect(query(".drawer")?.hidden).toBe(true);
    drawer.dispose();
  });

  it("closes the drawer with Escape and on navigation", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    drawer.mount();
    await flush();

    query(".handle")?.click();
    expect(query(".drawer")?.hidden).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(query(".drawer")?.hidden).toBe(true);

    query(".handle")?.click();
    expect(query(".drawer")?.hidden).toBe(false);
    h.emitUrlChange("https://example.com/next");
    await flush();
    expect(query(".drawer")?.hidden).toBe(true);
    drawer.dispose();
  });

  it("moves the handle away from a right-side translation ball", async () => {
    const ball = document.createElement("div");
    ball.dataset.imt = "float-ball";
    ball.dataset.side = "right";
    ball.getBoundingClientRect = () =>
      ({
        top: 340,
        bottom: 420,
        left: 1200,
        right: 1240,
        width: 40,
        height: 80,
      } as DOMRect);
    document.body.append(ball);

    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    drawer.mount();
    await flush();
    const handle = query(".handle") as HTMLElement;
    handle.getBoundingClientRect = () =>
      ({
        top: 350,
        bottom: 410,
        left: 1248,
        right: 1280,
        width: 32,
        height: 60,
      } as DOMRect);

    (
      drawer as unknown as { reposition(): void }
    ).reposition();

    expect(parseFloat(handle.style.top)).toBeGreaterThanOrEqual(430);
    drawer.dispose();
    ball.remove();
  });

  it("starts the count at zero and updates it after words are saved", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    drawer.mount();
    await flush();
    expect(query(".handle-count")?.textContent).toBe("0");

    h.setWords([savedWord()]);
    h.emitChanged();
    await flush();
    expect(query(".handle-count")?.textContent).toBe("1");
    drawer.dispose();
  });

  it("counts the same normalized word once across multiple contexts", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([
      savedWord(),
      savedWord({ id: "w2", contextHash: "ctx2", sentence: "Another use." }),
    ]);
    drawer.mount();
    await flush();

    expect(query(".handle-count")?.textContent).toBe("1");
    expect(query(".drawer-list")?.children.length).toBe(1);
    drawer.dispose();
  });

  it("counts different words separately", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([
      savedWord(),
      savedWord({
        id: "w2",
        word: "vector",
        normalizedKey: "vector",
        contextHash: "ctx2",
      }),
    ]);
    drawer.mount();
    await flush();

    expect(query(".handle-count")?.textContent).toBe("2");
    drawer.dispose();
  });

  it("renders only words that belong to the current article", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([
      savedWord(),
      savedWord({
        id: "w2",
        articleId: "a2",
        word: "vector",
        normalizedKey: "vector",
        contextHash: "ctx2",
      }),
    ]);
    drawer.mount();
    await flush();

    expect(h.listWords).toHaveBeenCalledWith("a1");
    expect(query(".handle-count")?.textContent).toBe("1");
    expect(query(".drawer-list")?.textContent).toContain("algorithm");
    expect(query(".drawer-list")?.textContent).not.toContain("vector");
    drawer.dispose();
  });

  it("removes every context when a grouped card is removed", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([
      savedWord(),
      savedWord({ id: "w2", contextHash: "ctx2" }),
    ]);
    drawer.mount();
    await flush();

    const removeButton = query(".word-remove") as HTMLButtonElement;
    removeButton.click();
    await flush();

    expect(h.removeWords).toHaveBeenCalledWith(["w1", "w2"]);
    expect(query(".handle-count")?.textContent).toBe("0");
    drawer.dispose();
  });

  it("opens the knowledge card on click and returns to the list on back", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([savedWord()]);
    drawer.mount();
    await flush();

    const card = query(".word-card") as HTMLElement;
    card.click();

    expect(query(".drawer-knowledge")?.hidden).toBe(false);
    expect(query(".drawer-list")?.hidden).toBe(true);

    query('[data-action="back"]')?.click();
    expect(query(".drawer-knowledge")?.hidden).toBe(true);
    expect(query(".drawer-list")?.hidden).toBe(false);
    drawer.dispose();
  });

  it("refreshes the collection when the page URL changes", async () => {
    const h = harness();
    const drawer = new WordCollectionDrawer(h.adapter);
    h.setWords([savedWord()]);
    drawer.mount();
    await flush();
    expect(query(".handle-count")?.textContent).toBe("1");

    const callsBefore = h.listWords.mock.calls.length;
    h.setArticleId("a2");
    h.setWords([]);
    h.emitUrlChange("https://example.com/other");
    await flush();

    expect(h.listWords.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(query(".handle-count")?.textContent).toBe("0");
    drawer.dispose();
  });
});
