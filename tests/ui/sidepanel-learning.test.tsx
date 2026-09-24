import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => {
  const messageListeners = new Set<(message: unknown) => void>();
  return {
    messageListeners,
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.add(listener),
        ),
        removeListener: vi.fn((listener: (message: unknown) => void) =>
          messageListeners.delete(listener),
        ),
      },
    },
    tabs: {
      query: vi.fn(),
      sendMessage: vi.fn(),
      create: vi.fn(),
    },
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
});

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { AssistantClient } from "../../src/shared/k-assistant";
import { withKDefaults } from "../../src/shared/k-types";
import type {
  PersonalDictionaryEntry,
  SavedArticle,
  SavedWord,
  WebsiteRecord,
} from "../../src/shared/learning-types";
import { SidePanel } from "../../src/ui/sidepanel/index";

const PAGE_URL = "https://example.com/article";

let storage: Record<string, unknown>;
let learning: {
  articles: SavedArticle[];
  words: SavedWord[];
  websites: WebsiteRecord[];
  dictionary: PersonalDictionaryEntry[];
  revision: number;
};

function article(overrides: Partial<SavedArticle> = {}): SavedArticle {
  return {
    id: "a1",
    url: PAGE_URL,
    title: "Article",
    websiteId: "w1",
    saved: true,
    screenshotState: "none",
    createdAt: 1,
    updatedAt: 2,
    syncStatus: "local",
    ...overrides,
  };
}

function word(overrides: Partial<SavedWord> = {}): SavedWord {
  return {
    id: "word1",
    articleId: "a1",
    word: "algorithm",
    normalizedKey: "algorithm",
    contextHash: "ctx",
    sentence: "An algorithm is a set of steps.",
    previousSentence: "",
    nextSentence: "",
    paragraphTheme: "Introduction",
    domain: "Computer science",
    createdAt: 1,
    updatedAt: 2,
    syncStatus: "local",
    ...overrides,
  };
}

function website(overrides: Partial<WebsiteRecord> = {}): WebsiteRecord {
  return {
    id: "w1",
    hostname: "example.com",
    createdAt: 1,
    updatedAt: 2,
    syncStatus: "local",
    ...overrides,
  };
}

const assistant: AssistantClient = {
  complete: vi.fn().mockResolvedValue(""),
  supportsStreaming: vi.fn().mockResolvedValue(false),
  stream: vi.fn().mockResolvedValue(""),
};

beforeEach(() => {
  storage = { config: withKDefaults(DEFAULT_CONFIG), kSidePanelHistory: [] };
  learning = {
    articles: [],
    words: [],
    websites: [],
    dictionary: [],
    revision: 0,
  };
  browserMock.messageListeners.clear();
  browserMock.tabs.query
    .mockReset()
    .mockResolvedValue([{ id: 8, title: "Article", url: PAGE_URL }]);
  browserMock.tabs.sendMessage.mockReset().mockImplementation(
    async (_id, message) => {
      if (message.type === "getPageState") {
        return { title: "Article", url: PAGE_URL, translated: false };
      }
      return undefined;
    },
  );
  browserMock.tabs.create.mockReset().mockResolvedValue(undefined);
  browserMock.runtime.sendMessage.mockReset().mockImplementation(
    async (message: { type: string } & Record<string, unknown>) => {
      switch (message.type) {
        case "learningListArticles":
          return { articles: learning.articles };
        case "learningListWords":
          return { words: learning.words };
        case "learningListWebsites":
          return { websites: learning.websites };
        case "learningListDictionaryEntries":
          return { entries: learning.dictionary };
        case "learningGetRevision":
          return { revision: learning.revision };
        case "learningSaveArticle":
          return { article: { ...article(), saved: true } };
        case "learningRemoveArticle":
          return { article: { ...article(), saved: false } };
        case "learningRemoveWord":
          return { removed: true };
        case "learningAddDictionaryEntry":
          return { entry: { word: message.word } };
        default:
          return undefined;
      }
    },
  );
  browserMock.storage.local.get.mockReset().mockImplementation(async (key) => ({
    [key]: storage[key],
  }));
  browserMock.storage.local.set
    .mockReset()
    .mockImplementation(async (value) => {
      Object.assign(storage, value);
    });
});

afterEach(cleanup);

async function renderPanel(): Promise<void> {
  render(<SidePanel assistant={assistant} />);
  await screen.findByRole("tab", { name: "收藏" });
}

async function openCollection(): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: "收藏" }));
  await screen.findByRole("tab", { name: "文章" });
}

describe("SidePanel collection", () => {
  it("renders and switches the four side-panel tabs", async () => {
    await renderPanel();
    expect(await screen.findByRole("tab", { name: "翻译" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "对话" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "页面" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "收藏" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "收藏" }));
    expect(await screen.findByRole("tab", { name: "文章" })).toBeTruthy();
  });

  it("reflects collected and uncollected state on the current-page article card", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    expect(await screen.findByRole("button", { name: "收藏" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "暂无截图" })).toBeTruthy();
  });

  it("shows the current-page article card as collected when saved", async () => {
    learning.articles = [article()];
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    expect(
      await screen.findByRole("button", { name: "取消收藏" }),
    ).toBeTruthy();
  });

  it("renders article, word, and website lists", async () => {
    learning.articles = [article()];
    learning.words = [word()];
    learning.websites = [website()];
    await renderPanel();
    await openCollection();

    expect(screen.getByText("Article")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "词语" }));
    expect(await screen.findByText("algorithm")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "网站" }));
    expect(await screen.findByText("example.com")).toBeTruthy();
  });

  it("filters by search across segments", async () => {
    learning.articles = [article(), article({ id: "a2", title: "Other", url: "https://x.org/a" })];
    learning.words = [word(), word({ id: "word2", word: "vector", articleId: "a2" })];
    learning.websites = [website(), website({ id: "w2", hostname: "x.org" })];
    await renderPanel();
    await openCollection();

    const search = screen.getByRole("searchbox");
    fireEvent.input(search, { target: { value: "vector" } });

    fireEvent.click(screen.getByRole("tab", { name: "词语" }));
    expect(await screen.findByText("vector")).toBeTruthy();
    expect(screen.queryByText("algorithm")).toBeNull();
  });

  it("computes website article and word counts", async () => {
    learning.articles = [article(), article({ id: "a2", url: "https://example.com/b", title: "B" })];
    learning.words = [
      word(),
      word({ id: "word2", contextHash: "ctx2" }),
      word({ id: "word3", articleId: "a2", contextHash: "ctx3" }),
    ];
    learning.websites = [website()];
    await renderPanel();
    await openCollection();

    fireEvent.click(screen.getByRole("tab", { name: "网站" }));
    expect(await screen.findByText("example.com")).toBeTruthy();
    expect(screen.getByText(/文章 2/)).toBeTruthy();
    expect(screen.getByText(/词语 3/)).toBeTruthy();
  });

  it("keeps word-only websites visible when the article is not collected", async () => {
    learning.articles = [article({ saved: false })];
    learning.words = [word()];
    learning.websites = [website()];
    await renderPanel();
    await openCollection();

    fireEvent.click(screen.getAllByRole("tab")[2]);
    expect(await screen.findByText("example.com")).toBeTruthy();
  });

  it("keeps the page translation control after adding the article card", async () => {
    await renderPanel();
    fireEvent.click(screen.getAllByRole("tab")[2]);
    await screen.findByText("Article");
    const primaryButtons = document.querySelectorAll(
      ".side-panel button.ui-button-primary",
    );
    expect(primaryButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(primaryButtons[1]);
    await waitFor(() =>
      expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(8, {
        type: "toggleTranslate",
        tabId: 8,
      }),
    );
  });

  it("sends a save message from the current-page card", async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole("tab", { name: "页面" }));
    fireEvent.click(await screen.findByRole("button", { name: "收藏" }));
    await waitFor(() =>
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "learningSaveArticle",
          url: PAGE_URL,
        }),
      ),
    );
  });

  it("sends an uncollect message from an article card", async () => {
    learning.articles = [article()];
    learning.websites = [website()];
    await renderPanel();
    await openCollection();
    fireEvent.click(screen.getByRole("button", { name: "取消收藏" }));
    await waitFor(() =>
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "learningRemoveArticle" }),
      ),
    );
  });

  it("adds a word to the personal dictionary", async () => {
    learning.articles = [article()];
    learning.words = [word()];
    learning.websites = [website()];
    await renderPanel();
    await openCollection();

    fireEvent.click(screen.getByRole("tab", { name: "词语" }));
    fireEvent.click(await screen.findByRole("button", { name: "加入生词本" }));
    await waitFor(() =>
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "learningAddDictionaryEntry" }),
      ),
    );
  });

  it("reloads when learningChanged is broadcast", async () => {
    await renderPanel();
    await waitFor(() =>
      expect(browserMock.runtime.sendMessage).toHaveBeenCalledWith({
        type: "learningListArticles",
      }),
    );
    const before = browserMock.runtime.sendMessage.mock.calls.length;

    for (const listener of browserMock.messageListeners) {
      listener({ type: "learningChanged", revision: 1 });
    }
    await waitFor(() =>
      expect(browserMock.runtime.sendMessage.mock.calls.length).toBeGreaterThan(
        before,
      ),
    );
  });

  it("does not duplicate rendered items after a reload", async () => {
    learning.articles = [article()];
    await renderPanel();
    await openCollection();
    expect(screen.getAllByText("Article")).toHaveLength(1);

    for (const listener of browserMock.messageListeners) {
      listener({ type: "learningChanged", revision: 1 });
    }
    await waitFor(() =>
      expect(screen.getAllByText("Article")).toHaveLength(1),
    );
  });
});
