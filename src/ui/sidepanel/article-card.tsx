import type { JSX } from "preact";

import type { SavedArticle } from "../../shared/learning-types";
import { Button } from "../shared/components";
import { t } from "../shared/i18n";

export interface ArticleCardProps {
  article: SavedArticle;
  hostname: string;
  wordCount: number;
  onOpen(): void;
  onViewWords(): void;
  onUncollect(): void;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function ArticleCard({
  article,
  hostname,
  wordCount,
  onOpen,
  onViewWords,
  onUncollect,
}: ArticleCardProps): JSX.Element {
  return (
    <article class="learning-card">
      <header class="learning-card-head">
        <strong class="learning-card-title">{article.title}</strong>
        {hostname && <span class="learning-card-host">{hostname}</span>}
      </header>
      <p class="learning-card-meta">
        {t("learning.collectedAt", { time: formatTime(article.updatedAt) })}
        <span> · </span>
        {t("learning.wordCount", { count: wordCount })}
      </p>
      <div class="learning-card-actions">
        <Button variant="quiet" onClick={onOpen}>
          {t("learning.openOriginal")}
        </Button>
        <Button variant="quiet" disabled title={t("learning.noScreenshot")}>
          {t("learning.noScreenshot")}
        </Button>
        <Button variant="quiet" onClick={onViewWords}>
          {t("learning.viewWords")}
        </Button>
        <Button variant="danger" onClick={onUncollect}>
          {t("learning.uncollect")}
        </Button>
      </div>
    </article>
  );
}