import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LearningStore,
  canonicalArticleId,
  contextHash,
  hostnameFromUrl,
  normalizeWord,
  normalizedWordKey,
  routeLearningRequest,
  websiteIdFromUrl,
} from "../../src/background/learning-store";
import type { SaveWordInput } from "../../src/shared/learning-types";

function makeStore(): LearningStore {
  return new LearningStore({ indexedDB: null });
}

function wordInput(
  overrides: Partial<SaveWordInput> = {},
): SaveWordInput {
  return {
    url: "https://example.com/article",
    title: "Article",
    domain: "Computer science",
    word: "algorithm",
    sentence: "An algorithm is a set of steps.",
    previousSentence: "",
    nextSentence: "",
    paragraphTheme: "Introduction",
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("learning identity helpers", () => {
  it("derives deterministic website IDs from URL hostnames", async () => {
    const a = await websiteIdFromUrl("https://example.com/one");
    const b = await websiteIdFromUrl("https://example.com/two");
    const c = await websiteIdFromUrl("https://other.org/x");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(hostnameFromUrl("https://example.com/path")).toBe("example.com");
  });

  it("derives deterministic canonical article IDs from URL and title", async () => {
    const a = await canonicalArticleId("https://example.com/a", "Title");
    const b = await canonicalArticleId("https://example.com/a", "Title");
    expect(a).toBe(b);
    const c = await canonicalArticleId("https://example.com/a", "Other");
    expect(a).not.toBe(c);
  });

  it("normalizes words and hashes context deterministically", async () => {
    expect(normalizeWord("  Hello  ")).toBe("hello");
    expect(await normalizedWordKey("Hello")).toBe(
      await normalizedWordKey("hello"),
    );
    const context = {
      sentence: "s",
      previousSentence: "p",
      nextSentence: "n",
      paragraphTheme: "t",
    };
    expect(await contextHash(context)).toBe(await contextHash(context));
  });
});

describe("LearningStore", () => {
  it("saves an article and repeat saves are idempotent", async () => {
    const store = makeStore();
    const first = await store.saveArticle({
      url: "https://example.com/a",
      title: "Article A",
    });
    const second = await store.saveArticle({
      url: "https://example.com/a",
      title: "Article A",
    });
    expect(second.id).toBe(first.id);
    expect(second.saved).toBe(true);
    expect(await store.listArticles({ savedOnly: true })).toHaveLength(1);
  });

  it("creates an uncollected article context record when saving a word", async () => {
    const store = makeStore();
    await store.saveWord(wordInput());
    const articles = await store.listArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].saved).toBe(false);
    expect(await store.listArticles({ savedOnly: true })).toHaveLength(0);
  });

  it("removing a collected article keeps its context and words", async () => {
    const store = makeStore();
    const url = "https://example.com/a";
    const title = "Article A";
    await store.saveArticle({ url, title });
    const saved = await store.saveWord(wordInput({ url, title }));
    const article = await store.removeArticleCollection(saved.articleId);
    expect(article).not.toBeNull();
    expect(article?.saved).toBe(false);
    const articles = await store.listArticles();
    expect(articles).toHaveLength(1);
    expect(articles[0].saved).toBe(false);
    expect(await store.findWordsByArticle(saved.articleId)).toHaveLength(1);
  });

  it("deduplicates the same word in the same article and context", async () => {
    const store = makeStore();
    const first = await store.saveWord(wordInput());
    const second = await store.saveWord(wordInput());
    expect(second.id).toBe(first.id);
    expect(await store.listWords()).toHaveLength(1);
  });

  it("retains the same word in different contexts separately", async () => {
    const store = makeStore();
    const first = await store.saveWord(wordInput());
    const second = await store.saveWord(
      wordInput({ sentence: "A completely different context sentence." }),
    );
    expect(second.id).not.toBe(first.id);
    expect(await store.listWords()).toHaveLength(2);
  });

  it("associates a website automatically and deterministically", async () => {
    const store = makeStore();
    await store.saveArticle({ url: "https://example.com/a", title: "A" });
    await store.saveArticle({ url: "https://example.com/b", title: "B" });
    await store.saveArticle({ url: "https://other.org/c", title: "C" });
    const websites = await store.listWebsites();
    expect(websites.map((w) => w.hostname).sort()).toEqual([
      "example.com",
      "other.org",
    ]);
  });

  it("adds personal dictionary entries idempotently", async () => {
    const store = makeStore();
    const first = await store.addDictionaryEntry({
      word: "algorithm",
      from: "en",
      to: "zh-CN",
      translation: "算法",
    });
    const second = await store.addDictionaryEntry({
      word: "algorithm",
      from: "en",
      to: "zh-CN",
      translation: "算法",
    });
    expect(second.id).toBe(first.id);
    const entry = await store.getDictionaryEntry("algorithm", "en", "zh-CN");
    expect(entry).not.toBeNull();
    expect(entry?.translation).toBe("算法");
  });

  it("supports article list pagination", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    for (let index = 0; index < 4; index += 1) {
      vi.setSystemTime(new Date(`2026-01-0${index + 1}T00:00:00Z`));
      await store.saveArticle({
        url: `https://example.com/${index}`,
        title: `Article ${index}`,
      });
    }
    const page = await store.listArticles({ offset: 1, limit: 2 });
    expect(page.map((article) => article.title)).toEqual([
      "Article 2",
      "Article 1",
    ]);
  });

  it("normalizes personal dictionary identity by case", async () => {
    const store = makeStore();
    const first = await store.addDictionaryEntry({
      word: "Algorithm",
      from: "en",
      to: "zh-CN",
    });
    const second = await store.addDictionaryEntry({
      word: " algorithm ",
      from: "en",
      to: "zh-CN",
    });
    expect(second.id).toBe(first.id);
    expect(
      await store.getDictionaryEntry("ALGORITHM", "en", "zh-CN"),
    ).toMatchObject({ id: first.id });
  });

  it("lists articles newest first", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    await store.saveArticle({ url: "https://example.com/1", title: "One" });
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    await store.saveArticle({ url: "https://example.com/2", title: "Two" });
    vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
    await store.saveArticle({ url: "https://example.com/3", title: "Three" });
    const articles = await store.listArticles();
    expect(articles.map((a) => a.title)).toEqual(["Three", "Two", "One"]);
  });

  it("increments the learning revision on writes", async () => {
    const store = makeStore();
    expect(await store.getLearningRevision()).toBe(0);
    await store.saveArticle({ url: "https://example.com/a", title: "A" });
    expect(await store.getLearningRevision()).toBe(1);
    await store.saveWord(wordInput());
    expect(await store.getLearningRevision()).toBe(2);
    await store.addDictionaryEntry({
      word: "word",
      from: "en",
      to: "zh-CN",
    });
    expect(await store.getLearningRevision()).toBe(3);
  });

  it("serializes concurrent revision updates", async () => {
    const store = makeStore();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.saveArticle({
          url: `https://example.com/${index}`,
          title: `Article ${index}`,
        }),
      ),
    );
    expect(await store.getLearningRevision()).toBe(8);
  });

  it("preserves existing word knowledge when a later save omits it", async () => {
    const store = makeStore();
    const first = await store.saveWord(
      wordInput({
        translation: "algorithm",
        partOfSpeech: "noun",
        definition: "A procedure for solving a problem.",
      }),
    );
    const second = await store.saveWord(wordInput());
    expect(second.id).toBe(first.id);
    expect(second.translation).toBe("algorithm");
    expect(second.partOfSpeech).toBe("noun");
    expect(second.definition).toBe("A procedure for solving a problem.");
  });
});

describe("routeLearningRequest", () => {
  it("routes a message to the store", async () => {
    const store = makeStore();
    const response = await routeLearningRequest(
      { type: "learningSaveArticle", url: "https://example.com/a", title: "A" },
      store,
    );
    expect(response).toMatchObject({ article: { saved: true } });
    expect(await store.listArticles({ savedOnly: true })).toHaveLength(1);
  });

  it("routes a word save to the store", async () => {
    const store = makeStore();
    const response = await routeLearningRequest(
      { type: "learningSaveWord", ...wordInput() },
      store,
    );
    expect(response).toMatchObject({ word: { word: "algorithm" } });
    expect(await store.listWords()).toHaveLength(1);
  });

  it("persists word knowledge fields through the save-word route", async () => {
    const store = makeStore();
    const response = await routeLearningRequest(
      {
        type: "learningSaveWord",
        ...wordInput(),
        translation: "算法",
        partOfSpeech: "noun",
        definition: "A procedure for solving a problem.",
        knowledgeId: "term-algorithm",
        sourceUrl: "https://doi.org/10.1234/example",
      },
      store,
    );
    expect(response).toMatchObject({
      word: {
        translation: "算法",
        partOfSpeech: "noun",
        definition: "A procedure for solving a problem.",
        knowledgeId: "term-algorithm",
        sourceUrl: "https://doi.org/10.1234/example",
      },
    });
  });

  it("lists personal dictionary entries", async () => {
    const store = makeStore();
    await store.addDictionaryEntry({
      word: "algorithm",
      from: "en",
      to: "zh-CN",
      translation: "算法",
    });
    const response = await routeLearningRequest(
      { type: "learningListDictionaryEntries" },
      store,
    );
    expect(response).toMatchObject({ entries: [{ word: "algorithm" }] });
  });
});
