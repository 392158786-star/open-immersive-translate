import type {
  AddDictionaryEntryInput,

  LearningSyncStatus,
  PersonalDictionaryEntry,
  SaveArticleInput,
  SaveWordInput,
  SavedArticle,
  SavedWord,
  WebsiteRecord,
  ListArticlesQuery,
  ListWordsQuery,
} from "../shared/learning-types";
import type {
  LearningRequest,
  LearningResponse,
} from "../shared/messages";

const DATABASE_NAME = "bilingual-translator-learning";
const DATABASE_VERSION = 1;
const REVISION_KEY = "learningRevision";

const STORE_NAMES = [
  "articles",
  "words",
  "websites",
  "assets",
  "dictionary",
  "meta",
] as const;

type StoreName = (typeof STORE_NAMES)[number];

interface MetaRecord {
  id: string;
  value: number;
}

export interface LearningStoreOptions {
  indexedDB?: IDBFactory | null;
  databaseName?: string;
}

/** Compute a deterministic SHA-256 hex digest. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Extract a normalized hostname from a URL, falling back to the raw value. */
export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Normalize a word for identity comparison. */
export function normalizeWord(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

/** Deterministic article ID derived from URL and title. */
export function canonicalArticleId(url: string, title: string): Promise<string> {
  return sha256Hex(`${hostnameFromUrl(url)}|${url}|${title.trim()}`);
}

/** Deterministic normalized word key. */
export function normalizedWordKey(word: string): Promise<string> {
  return sha256Hex(normalizeWord(word));
}

/** Deterministic website ID derived from a URL hostname. */
export function websiteIdFromUrl(url: string): Promise<string> {
  return sha256Hex(`website|${hostnameFromUrl(url)}`);
}

/** Deterministic hash for a word's surrounding context. */
export function contextHash(context: {
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  paragraphTheme: string;
}): Promise<string> {
  return sha256Hex(
    `${context.paragraphTheme}\n${context.previousSentence}\n${context.sentence}\n${context.nextSentence}`,
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

/**
 * Local-first learning store backed by IndexedDB with an in-memory fallback.
 * Articles, words, websites, assets, dictionary entries, and meta live in
 * dedicated object stores of `bilingual-translator-learning`.
 */
export class LearningStore {
  private databaseFactory: IDBFactory | null;
  private readonly databaseName: string;
  private databasePromise?: Promise<IDBDatabase>;
  private readonly memory: Record<StoreName, Map<string, unknown>> = {
    articles: new Map(),
    words: new Map(),
    websites: new Map(),
    assets: new Map(),
    dictionary: new Map(),
    meta: new Map(),
  };
  private revisionQueue: Promise<number> = Promise.resolve(0);

  constructor(options: LearningStoreOptions = {}) {
    this.databaseFactory =
      options.indexedDB === undefined
        ? typeof globalThis.indexedDB === "undefined"
          ? null
          : globalThis.indexedDB
        : options.indexedDB;
    this.databaseName = options.databaseName ?? DATABASE_NAME;
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.databaseFactory)
      return Promise.reject(new Error("IndexedDB unavailable."));
    if (this.databasePromise) return this.databasePromise;

    const databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.databaseFactory?.open(
        this.databaseName,
        DATABASE_VERSION,
      );
      if (!request) {
        reject(new Error("IndexedDB unavailable."));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of STORE_NAMES) {
          if (database.objectStoreNames.contains(name)) continue;
          const store = database.createObjectStore(name, { keyPath: "id" });
          if (name === "words") {
            store.createIndex("articleId", "articleId", { unique: false });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open learning store."));
      request.onblocked = () =>
        reject(new Error("Learning store upgrade was blocked."));
    }).catch((error) => {
      this.useMemory();
      throw error;
    });
    this.databasePromise = databasePromise;
    return databasePromise;
  }

  private useMemory(): void {
    this.databaseFactory = null;
    this.databasePromise = undefined;
  }

  private memoryStore(store: StoreName): Map<string, unknown> {
    return this.memory[store];
  }

  private async getRecord<T>(store: StoreName, key: string): Promise<T | undefined> {
    if (!this.databaseFactory)
      return this.memoryStore(store).get(key) as T | undefined;
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(store, "readonly");
      return await requestResult(
        transaction.objectStore(store).get(key) as IDBRequest<T | undefined>,
      );
    } catch {
      this.useMemory();
      return this.memoryStore(store).get(key) as T | undefined;
    }
  }

  private async putRecord<T extends { id: string }>(
    store: StoreName,
    record: T,
  ): Promise<void> {
    if (!this.databaseFactory) {
      this.memoryStore(store).set(record.id, record);
      return;
    }
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(store, "readwrite");
      transaction.objectStore(store).put(record);
      await transactionDone(transaction);
    } catch {
      this.useMemory();
      this.memoryStore(store).set(record.id, record);
    }
  }

  private async deleteRecord(store: StoreName, key: string): Promise<void> {
    if (!this.databaseFactory) {
      this.memoryStore(store).delete(key);
      return;
    }
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(store, "readwrite");
      transaction.objectStore(store).delete(key);
      await transactionDone(transaction);
    } catch {
      this.useMemory();
      this.memoryStore(store).delete(key);
    }
  }

  private async getAllRecords<T>(store: StoreName): Promise<T[]> {
    if (!this.databaseFactory)
      return [...this.memoryStore(store).values()] as T[];
    try {
      const database = await this.openDatabase();
      const transaction = database.transaction(store, "readonly");
      return await requestResult(
        transaction.objectStore(store).getAll() as IDBRequest<T[]>,
      );
    } catch {
      this.useMemory();
      return [...this.memoryStore(store).values()] as T[];
    }
  }

  private async bumpRevision(): Promise<number> {
    const update = this.revisionQueue.then(async () => {
      const current = await this.getLearningRevision();
      const next = current + 1;
      await this.putRecord("meta", { id: REVISION_KEY, value: next });
      return next;
    });
    this.revisionQueue = update.catch(() => this.getLearningRevision());
    return update;
  }

  private async ensureWebsite(
    websiteId: string,
    hostname: string,
    now: number,
  ): Promise<WebsiteRecord> {
    const existing = await this.getRecord<WebsiteRecord>("websites", websiteId);
    if (existing) return existing;
    const website: WebsiteRecord = {
      id: websiteId,
      hostname,
      createdAt: now,
      updatedAt: now,
      syncStatus: "local",
    };
    await this.putRecord("websites", website);
    return website;
  }

  private async ensureArticleContext(
    articleId: string,
    url: string,
    title: string,
    websiteId: string,
    now: number,
  ): Promise<SavedArticle> {
    const existing = await this.getRecord<SavedArticle>("articles", articleId);
    if (existing) return existing;
    const article: SavedArticle = {
      id: articleId,
      url,
      title,
      websiteId,
      saved: false,
      screenshotState: "none",
      createdAt: now,
      updatedAt: now,
      syncStatus: "local",
    };
    await this.putRecord("articles", article);
    return article;
  }

  private nextSyncStatus(existing: LearningSyncStatus): LearningSyncStatus {
    return existing === "synced" ? "pending" : existing;
  }

  /** Initialize or open the underlying database when IndexedDB is available. */
  async open(): Promise<void> {
    if (!this.databaseFactory) return;
    await this.openDatabase();
  }

  async saveArticle(input: SaveArticleInput): Promise<SavedArticle> {
    const id = await canonicalArticleId(input.url, input.title);
    const websiteId = await websiteIdFromUrl(input.url);
    const hostname = hostnameFromUrl(input.url);
    const now = Date.now();
    await this.ensureWebsite(websiteId, hostname, now);
    const existing = await this.getRecord<SavedArticle>("articles", id);
    if (existing) {
      const article: SavedArticle = {
        ...existing,
        url: input.url,
        title: input.title,
        websiteId,
        saved: true,
        updatedAt: now,
        syncStatus: this.nextSyncStatus(existing.syncStatus),
      };
      await this.putRecord("articles", article);
      await this.bumpRevision();
      return article;
    }
    const article: SavedArticle = {
      id,
      url: input.url,
      title: input.title,
      websiteId,
      saved: true,
      screenshotState: "none",
      createdAt: now,
      updatedAt: now,
      syncStatus: "local",
    };
    await this.putRecord("articles", article);
    await this.bumpRevision();
    return article;
  }

  async removeArticleCollection(articleId: string): Promise<SavedArticle | null> {
    const existing = await this.getRecord<SavedArticle>("articles", articleId);
    if (!existing) return null;
    const article: SavedArticle = {
      ...existing,
      saved: false,
      updatedAt: Date.now(),
      syncStatus: this.nextSyncStatus(existing.syncStatus),
    };
    await this.putRecord("articles", article);
    await this.bumpRevision();
    return article;
  }

  async saveWord(input: SaveWordInput): Promise<SavedWord> {
    const articleId = await canonicalArticleId(input.url, input.title);
    const websiteId = await websiteIdFromUrl(input.url);
    const hostname = hostnameFromUrl(input.url);
    const normalizedKey = await normalizedWordKey(input.word);
    const ctxHash = await contextHash({
      sentence: input.sentence,
      previousSentence: input.previousSentence,
      nextSentence: input.nextSentence,
      paragraphTheme: input.paragraphTheme,
    });
    const id = await sha256Hex(`${articleId}|${normalizedKey}|${ctxHash}`);
    const now = Date.now();
    await this.ensureWebsite(websiteId, hostname, now);
    await this.ensureArticleContext(articleId, input.url, input.title, websiteId, now);
    const fields = {
      articleId,
      word: input.word,
      normalizedKey,
      contextHash: ctxHash,
      sentence: input.sentence,
      previousSentence: input.previousSentence,
      nextSentence: input.nextSentence,
      paragraphTheme: input.paragraphTheme,
      domain: input.domain,
      from: input.from,
      to: input.to,
    };
    const existing = await this.getRecord<SavedWord>("words", id);
    if (existing) {
      const word: SavedWord = {
        ...existing,
        ...fields,
        updatedAt: now,
        syncStatus: this.nextSyncStatus(existing.syncStatus),
      };
      await this.putRecord("words", word);
      await this.bumpRevision();
      return word;
    }
    const word: SavedWord = {
      id,
      ...fields,
      createdAt: now,
      updatedAt: now,
      syncStatus: "local",
    };
    await this.putRecord("words", word);
    await this.bumpRevision();
    return word;
  }

  async removeWord(wordId: string): Promise<boolean> {
    const existing = await this.getRecord<SavedWord>("words", wordId);
    if (!existing) return false;
    await this.deleteRecord("words", wordId);
    await this.bumpRevision();
    return true;
  }

  async listArticles(query: ListArticlesQuery = {}): Promise<SavedArticle[]> {
    let articles = await this.getAllRecords<SavedArticle>("articles");
    if (query.savedOnly) articles = articles.filter((article) => article.saved);
    articles = [...articles].sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? articles.length;
    return articles.slice(offset, offset + limit);
  }

  async listWords(query: ListWordsQuery = {}): Promise<SavedWord[]> {
    let words = await this.getAllRecords<SavedWord>("words");
    if (query.articleId) {
      words = words.filter((word) => word.articleId === query.articleId);
    }
    words = [...words].sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? words.length;
    return words.slice(offset, offset + limit);
  }

  async listWebsites(): Promise<WebsiteRecord[]> {
    const websites = await this.getAllRecords<WebsiteRecord>("websites");
    return [...websites].sort((a, b) => b.createdAt - a.createdAt);
  }

  async findWordsByArticle(articleId: string): Promise<SavedWord[]> {
    return this.listWords({ articleId });
  }

  async addDictionaryEntry(
    input: AddDictionaryEntryInput,
  ): Promise<PersonalDictionaryEntry> {
    const normalizedKey = await normalizedWordKey(input.word);
    const id = await sha256Hex(
      `dictionary|${normalizedKey}|${input.from}|${input.to}`,
    );
    const now = Date.now();
    const existing = await this.getRecord<PersonalDictionaryEntry>(
      "dictionary",
      id,
    );
    if (existing) {
      const entry: PersonalDictionaryEntry = {
        ...existing,
        word: input.word,
        translation: input.translation,
        updatedAt: now,
        syncStatus: this.nextSyncStatus(existing.syncStatus),
      };
      await this.putRecord("dictionary", entry);
      await this.bumpRevision();
      return entry;
    }
    const entry: PersonalDictionaryEntry = {
      id,
      normalizedKey,
      word: input.word,
      from: input.from,
      to: input.to,
      translation: input.translation,
      createdAt: now,
      updatedAt: now,
      syncStatus: "local",
    };
    await this.putRecord("dictionary", entry);
    await this.bumpRevision();
    return entry;
  }

  async getDictionaryEntry(
    word: string,
    from: PersonalDictionaryEntry["from"],
    to: PersonalDictionaryEntry["to"],
  ): Promise<PersonalDictionaryEntry | null> {
    const normalizedKey = await normalizedWordKey(word);
    const id = await sha256Hex(`dictionary|${normalizedKey}|${from}|${to}`);
    const existing = await this.getRecord<PersonalDictionaryEntry>(
      "dictionary",
      id,
    );
    return existing ?? null;
  }

  async getLearningRevision(): Promise<number> {
    const record = await this.getRecord<MetaRecord>("meta", REVISION_KEY);
    return record?.value ?? 0;
  }
}

export const learningStore = new LearningStore();

const LEARNING_REQUEST_TYPES = new Set<string>([
  "learningSaveArticle",
  "learningRemoveArticle",
  "learningSaveWord",
  "learningRemoveWord",
  "learningListArticles",
  "learningListWords",
  "learningListWebsites",
  "learningFindWordsByArticle",
  "learningAddDictionaryEntry",
  "learningGetDictionaryEntry",
  "learningGetRevision",
]);

/** True when a runtime message targets the learning store. */
export function isLearningRequest(message: unknown): message is LearningRequest {
  if (typeof message !== "object" || message === null || !("type" in message))
    return false;
  return LEARNING_REQUEST_TYPES.has((message as { type: string }).type);
}

/** Route a learning request to the store and shape its response. */
export async function routeLearningRequest(
  request: LearningRequest,
  store: LearningStore = learningStore,
): Promise<LearningResponse> {
  switch (request.type) {
    case "learningSaveArticle": {
      const article = await store.saveArticle({
        url: request.url,
        title: request.title,
      });
      return { article };
    }
    case "learningRemoveArticle": {
      const article = await store.removeArticleCollection(request.articleId);
      return { article };
    }
    case "learningSaveWord": {
      const word = await store.saveWord({
        url: request.url,
        title: request.title,
        domain: request.domain,
        word: request.word,
        sentence: request.sentence,
        previousSentence: request.previousSentence,
        nextSentence: request.nextSentence,
        paragraphTheme: request.paragraphTheme,
        from: request.from,
        to: request.to,
      });
      return { word };
    }
    case "learningRemoveWord": {
      const removed = await store.removeWord(request.wordId);
      return { removed };
    }
    case "learningListArticles": {
      const articles = await store.listArticles({
        savedOnly: request.savedOnly,
        limit: request.limit,
        offset: request.offset,
      });
      return { articles };
    }
    case "learningListWords": {
      const words = await store.listWords({
        articleId: request.articleId,
        limit: request.limit,
        offset: request.offset,
      });
      return { words };
    }
    case "learningListWebsites": {
      const websites = await store.listWebsites();
      return { websites };
    }
    case "learningFindWordsByArticle": {
      const words = await store.findWordsByArticle(request.articleId);
      return { words };
    }
    case "learningAddDictionaryEntry": {
      const entry = await store.addDictionaryEntry({
        word: request.word,
        from: request.from,
        to: request.to,
        translation: request.translation,
      });
      return { entry };
    }
    case "learningGetDictionaryEntry": {
      const entry = await store.getDictionaryEntry(
        request.word,
        request.from,
        request.to,
      );
      return { entry };
    }
    case "learningGetRevision": {
      const revision = await store.getLearningRevision();
      return { revision };
    }
  }
}
