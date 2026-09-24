import type { JSX } from "preact";

import type { SavedWord } from "../../shared/learning-types";
import { Button } from "../shared/components";
import { t } from "../shared/i18n";

export interface SavedWordCardProps {
  word: SavedWord;
  articleTitle: string;
  hostname: string;
  inDictionary: boolean;
  onOpenContext(): void;
  onAddDictionary(): void;
  onUncollect(): void;
}

export function SavedWordCard({
  word,
  articleTitle,
  hostname,
  inDictionary,
  onOpenContext,
  onAddDictionary,
  onUncollect,
}: SavedWordCardProps): JSX.Element {
  return (
    <article class="learning-card">
      <header class="learning-card-head">
        <strong class="learning-card-title">{word.word}</strong>
        {word.translation && (
          <span class="learning-card-translation">{word.translation}</span>
        )}
      </header>
      {word.partOfSpeech && (
        <p class="learning-card-meta">{word.partOfSpeech}</p>
      )}
      {word.definition && (
        <p class="learning-card-detail">{word.definition}</p>
      )}
      <p class="learning-card-meta">
        {articleTitle}
        {hostname ? <span> · {hostname}</span> : null}
      </p>
      <div class="learning-card-actions">
        <Button variant="quiet" onClick={onOpenContext}>
          {t("learning.openContext")}
        </Button>
        <Button
          variant="quiet"
          disabled={inDictionary}
          onClick={onAddDictionary}
        >
          {inDictionary
            ? t("learning.inDictionary")
            : t("learning.addDictionary")}
        </Button>
        <Button variant="danger" onClick={onUncollect}>
          {t("learning.uncollect")}
        </Button>
      </div>
    </article>
  );
}
