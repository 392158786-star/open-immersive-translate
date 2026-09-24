import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import browser from "webextension-polyfill";

import type {
  PersonalDictionaryEntry,
  SavedArticle,
  SavedWord,
  WebsiteRecord,
} from "../../shared/learning-types";
import { sendToBackground } from "../../shared/messages";
import { Button } from "../shared/components";
import { t } from "../shared/i18n";
import { ArticleCard } from "./article-card";
import { SavedWordCard } from "./saved-word-card";

export type CollectionSegment = "articles" | "words" | "websites";

export interface LearningState {
  articles: SavedArticle[];
  words: SavedWord[];
  websites: WebsiteRecord[];
  dictionary: PersonalDictionaryEntry[];
  revision: number;
  loading: boolean;
  error: boolean;
  refresh(): Promise<void>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function normalize(word: string): string {
  return word.trim().toLowerCase();
}

function matches(text: string, query: string): boolean {
  return query !== "" && text.toLowerCase().includes(query.toLowerCase());
}

export function useLearningState(): LearningState {
  const [articles, setArticles] = useState<SavedArticle[]>([]);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [dictionary, setDictionary] = useState<PersonalDictionaryEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [a, w, ws, d, r] = await Promise.all([
        sendToBackground({ type: "learningListArticles" }),
        sendToBackground({ type: "learningListWords" }),
        sendToBackground({ type: "learningListWebsites" }),
        sendToBackground({ type: "learningListDictionaryEntries" }),
        sendToBackground({ type: "learningGetRevision" }),
      ]);
      setArticles(a.articles);
      setWords(w.words);
      setWebsites(ws.websites);
      setDictionary(d.entries);
      setRevision(r.revision);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const listener = (message: unknown): void => {
      if (isRecord(message) && message.type === "learningChanged") {
        void refresh();
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [refresh]);

  return {
    articles,
    words,
    websites,
    dictionary,
    revision,
    loading,
    error,
    refresh,
  };
}

export interface LearningPanelProps {
  state: LearningState;
  segment: CollectionSegment;
  onSegmentChange(segment: CollectionSegment): void;
  articleFilterId?: string;
  onViewArticleWords(articleId: string): void;
  onClearArticleFilter(): void;
}

interface WebsiteRow {
  website: WebsiteRecord;
  articles: SavedArticle[];
  words: SavedWord[];
}

export function LearningPanel({
  state,
  segment,
  onSegmentChange,
  articleFilterId,
  onViewArticleWords,
  onClearArticleFilter,
}: LearningPanelProps): JSX.Element {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const collectedArticles = useMemo(
    () => state.articles.filter((article) => article.saved),
    [state.articles],
  );

  const articleById = useMemo(
    () => new Map(state.articles.map((article) => [article.id, article])),
    [state.articles],
  );

  const wordsByArticle = useMemo(() => {
    const map = new Map<string, SavedWord[]>();
    for (const word of state.words) {
      const list = map.get(word.articleId) ?? [];
      list.push(word);
      map.set(word.articleId, list);
    }
    return map;
  }, [state.words]);

  const dictionaryWords = useMemo(
    () => new Set(state.dictionary.map((entry) => normalize(entry.word))),
    [state.dictionary],
  );

  const filteredArticles = useMemo(() => {
    const query = search.trim();
    if (!query) return collectedArticles;
    return collectedArticles.filter(
      (article) =>
        matches(article.title, query) ||
        matches(hostnameOf(article.url), query),
    );
  }, [collectedArticles, search]);

  const filteredWords = useMemo(() => {
    let list = state.words;
    if (articleFilterId) {
      list = list.filter((word) => word.articleId === articleFilterId);
    }
    const query = search.trim();
    if (query) {
      list = list.filter(
        (word) =>
          matches(word.word, query) ||
          matches(word.translation ?? "", query) ||
          matches(word.definition ?? "", query) ||
          matches(word.sentence, query),
      );
    }
    return list;
  }, [state.words, articleFilterId, search]);

  const websiteRows = useMemo<WebsiteRow[]>(() => {
    const articlesByWebsite = new Map<string, SavedArticle[]>();
    for (const article of collectedArticles) {
      const list = articlesByWebsite.get(article.websiteId) ?? [];
      list.push(article);
      articlesByWebsite.set(article.websiteId, list);
    }
    const wordsByWebsite = new Map<string, SavedWord[]>();
    for (const word of state.words) {
      const article = articleById.get(word.articleId);
      if (!article) continue;
      const list = wordsByWebsite.get(article.websiteId) ?? [];
      list.push(word);
      wordsByWebsite.set(article.websiteId, list);
    }
    const query = search.trim();
    return state.websites
      .map((website) => ({
        website,
        articles: articlesByWebsite.get(website.id) ?? [],
        words: wordsByWebsite.get(website.id) ?? [],
      }))
      .filter((row) => {
        if (row.articles.length === 0 && row.words.length === 0) return false;
        if (!query) return true;
        return matches(row.website.hostname, query);
      });
  }, [articleById, collectedArticles, state.websites, state.words, search]);

  const openUrl = useCallback((url: string): void => {
    if (url) void browser.tabs.create({ url });
  }, []);

  const uncollectArticle = useCallback(
    async (articleId: string): Promise<void> => {
      await sendToBackground({ type: "learningRemoveArticle", articleId });
      await state.refresh();
    },
    [state],
  );

  const uncollectWord = useCallback(
    async (wordId: string): Promise<void> => {
      await sendToBackground({ type: "learningRemoveWord", wordId });
      await state.refresh();
    },
    [state],
  );

  const addDictionary = useCallback(
    async (word: SavedWord): Promise<void> => {
      await sendToBackground({
        type: "learningAddDictionaryEntry",
        word: word.word,
        from: word.from ?? "en",
        to: word.to ?? "zh-CN",
        translation: word.translation,
      });
      await state.refresh();
    },
    [state],
  );

  const segments: Array<{ value: CollectionSegment; label: string }> = [
    { value: "articles", label: t("learning.segmentArticles") },
    { value: "words", label: t("learning.segmentWords") },
    { value: "websites", label: t("learning.segmentWebsites") },
  ];

  return (
    <section class="side-panel learning-panel" aria-label={t("side.collection")}>
      <div class="learning-segments" role="tablist">
        {segments.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={segment === item.value}
            onClick={() => onSegmentChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        class="learning-search"
        placeholder={t("learning.search")}
        aria-label={t("learning.search")}
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />

      {segment === "words" && articleFilterId && (
        <div class="learning-filter-hint">
          <span>{t("learning.viewWords")}</span>
          <button type="button" onClick={onClearArticleFilter}>
            {t("learning.clearFilter")}
          </button>
        </div>
      )}

      {state.loading ? (
        <p class="ui-status">{t("common.loading")}</p>
      ) : state.error ? (
        <p class="ui-status ui-status-error">{t("learning.loadFailed")}</p>
      ) : segment === "articles" ? (
        filteredArticles.length ? (
          <div class="learning-list">
            {filteredArticles.map((article) => (
              <ArticleCard
                key={article.id}
                article={article}
                hostname={hostnameOf(article.url)}
                wordCount={wordsByArticle.get(article.id)?.length ?? 0}
                onOpen={() => openUrl(article.url)}
                onViewWords={() => onViewArticleWords(article.id)}
                onUncollect={() => void uncollectArticle(article.id)}
              />
            ))}
          </div>
        ) : (
          <p class="ui-status">{t("learning.empty")}</p>
        )
      ) : segment === "words" ? (
        filteredWords.length ? (
          <div class="learning-list">
            {filteredWords.map((word) => {
              const article = articleById.get(word.articleId);
              return (
                <SavedWordCard
                  key={word.id}
                  word={word}
                  articleTitle={article?.title ?? ""}
                  hostname={article ? hostnameOf(article.url) : ""}
                  inDictionary={dictionaryWords.has(normalize(word.word))}
                  onOpenContext={() =>
                    openUrl(word.sourceUrl ?? article?.url ?? "")
                  }
                  onAddDictionary={() => void addDictionary(word)}
                  onUncollect={() => void uncollectWord(word.id)}
                />
              );
            })}
          </div>
        ) : (
          <p class="ui-status">{t("learning.empty")}</p>
        )
      ) : websiteRows.length ? (
        <div class="learning-list">
          {websiteRows.map((row) => {
            const isExpanded = expanded[row.website.id] === true;
            return (
              <article key={row.website.id} class="learning-card">
                <header class="learning-card-head">
                  <strong class="learning-card-title">
                    {row.website.hostname}
                  </strong>
                  <span class="learning-card-meta">
                    {t("learning.articleCount", { count: row.articles.length })}
                    {" · "}
                    {t("learning.wordCount", { count: row.words.length })}
                  </span>
                </header>
                <Button
                  variant="quiet"
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [row.website.id]: !isExpanded,
                    }))
                  }
                >
                  {isExpanded ? t("learning.collapse") : t("learning.expand")}
                </Button>
                {isExpanded && (
                  <div class="learning-website-details">
                    {row.articles.map((article) => (
                      <p key={article.id} class="learning-card-meta">
                        {article.title}
                      </p>
                    ))}
                    {row.words.map((word) => (
                      <p key={word.id} class="learning-card-meta">
                        {word.word}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p class="ui-status">{t("learning.empty")}</p>
      )}
    </section>
  );
}
