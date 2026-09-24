import type { LangCode } from "./types";

/** Local-first sync state for records that may later sync to the cloud. */
export type LearningSyncStatus = "local" | "pending" | "synced" | "failed";

/** Screenshot capture state reserved for a later local screenshot feature. */
export type ArticleScreenshotState =
  | "none"
  | "pending"
  | "captured"
  | "failed";

/** Common fields on every persistent learning record. */
export interface LearningRecordBase {
  id: string;
  createdAt: number;
  updatedAt: number;
  syncStatus: LearningSyncStatus;
  remoteId?: string;
  deletedAt?: number;
}

/** A collected article or a context-only article record. */
export interface SavedArticle extends LearningRecordBase {
  url: string;
  title: string;
  websiteId: string;
  /** True only when the user explicitly collected the article. */
  saved: boolean;
  /** Reserved asset reference for future screenshots. */
  assetId?: string;
  screenshotState: ArticleScreenshotState;
}

/** A collected word tied to one article context record. */
export interface SavedWord extends LearningRecordBase {
  articleId: string;
  word: string;
  normalizedKey: string;
  contextHash: string;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  paragraphTheme: string;
  domain: string;
  from?: LangCode;
  to?: LangCode;
  translation?: string;
  partOfSpeech?: string;
  definition?: string;
  knowledgeId?: string;
  sourceUrl?: string;
}

/** A website derived automatically from an article URL hostname. */
export interface WebsiteRecord extends LearningRecordBase {
  hostname: string;
}

/** Reserved metadata for future local screenshot assets. */
export interface LearningAsset extends LearningRecordBase {
  articleId?: string;
  contentType?: string;
}

/** A personal dictionary entry keyed by normalized word and language pair. */
export interface PersonalDictionaryEntry extends LearningRecordBase {
  normalizedKey: string;
  word: string;
  from: LangCode;
  to: LangCode;
  translation?: string;
}

/** Input for saving or updating an article's collection state. */
export interface SaveArticleInput {
  url: string;
  title: string;
}

/** Input for saving a word, including its article context. */
export interface SaveWordInput {
  url: string;
  title: string;
  domain: string;
  word: string;
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  paragraphTheme: string;
  from?: LangCode;
  to?: LangCode;
  translation?: string;
  partOfSpeech?: string;
  definition?: string;
  knowledgeId?: string;
  sourceUrl?: string;
}

/** Input for adding a personal dictionary entry. */
export interface AddDictionaryEntryInput {
  word: string;
  from: LangCode;
  to: LangCode;
  translation?: string;
}

/** Options for listing articles. */
export interface ListArticlesQuery {
  savedOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Options for listing words. */
export interface ListWordsQuery {
  articleId?: string;
  limit?: number;
  offset?: number;
}
