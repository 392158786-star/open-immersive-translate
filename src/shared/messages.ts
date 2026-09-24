import browser from "webextension-polyfill";

import type { PageCommandId } from "./j-types";
import type { AssistantRequest } from "./k-assistant";
import type {
  PersonalDictionaryEntry,
  SavedArticle,
  SavedWord,
  WebsiteRecord,
} from "./learning-types";
import type {
  AcademicTermKnowledge,
  Config,
  ConfigPatch,
  GlossaryEntry,
  JsonValue,
  LangCode,
  PlaceholderStyle,
  Rule,
  ServiceConfig,
  ServiceKind,
  TranslateError,
  TranslateParagraph,
  TranslationContext,
} from "./types";

/** Resolve one academic term using page context, AI, and public scholarly APIs. */
export interface AcademicResolveMessage {
  type: "academicResolve";
  term: string;
  context: string;
  title?: string;
  url?: string;
  domain?: string;
  service?: string;
}

/** Read a previously resolved term from the local knowledge cache. */
export interface AcademicGetMessage {
  type: "academicGet";
  term: string;
}

/** Open the full knowledge page for one term. */
export interface AcademicOpenMessage {
  type: "openAcademic";
  term: string;
}

export interface LocalModelStatusItem {
  role: "translation" | "academic";
  model: string;
  ready: boolean;
  status: string;
  progress: number;
  loaded: number;
  total: number;
  file?: string;
}

export interface GetLocalModelStatusMessage {
  type: "getLocalModelStatus";
}

export interface LoadLocalModelMessage {
  type: "loadLocalModel";
  target: "translation" | "academic" | "all";
}

/** Request the merged rule for a document URL. */
export interface GetRuleMessage {
  type: "getRule";
  url: string;
}

/** Submit serializable paragraphs for scheduled translation. */
export interface TranslateMessage {
  type: "translate";
  requestId: string;
  tabId: number;
  paragraphs: TranslateParagraph[];
  from: LangCode;
  to: LangCode;
  service?: string;
  glossary?: GlossaryEntry[];
  context?: TranslationContext;
  priority?: "normal" | "viewport" | "interactive";
  /** Remove echoed source text and repeated target fragments from every result. */
  removeDuplicateTranslations?: boolean;
  /** Reject corrupt output, keep retrying, and enforce readable segmentation. */
  translationIntegrityMode?: boolean;
}

/** One streamed paragraph result. */
export interface ParagraphTranslationResult {
  id: string;
  text?: string;
  error?: TranslateError;
}

/** A partial or terminal result batch pushed to a content script. */
export interface TranslateResultMessage {
  type: "translateResult";
  requestId: string;
  results: ParagraphTranslationResult[];
  done: boolean;
}

/** Cancel all work for a tab, or one request when requestId is present. */
export interface CancelMessage {
  type: "cancel";
  tabId: number;
  requestId?: string;
}

/** Read the complete local configuration. */
export interface GetConfigMessage {
  type: "getConfig";
}

/** Validate and persist a top-level configuration patch. */
export interface SetConfigMessage {
  type: "setConfig";
  patch: ConfigPatch;
}

/** Notify extension contexts that configuration changed. */
export interface ConfigChangedMessage {
  type: "configChanged";
  config?: Config;
}

/** Toggle content translation for the main region or whole page. */
export interface ToggleTranslateMessage {
  type: "toggleTranslate";
  tabId: number;
  scope?: "main" | "whole";
}

/** Ask a content script to translate the active editable field. */
export interface TranslateInputMessage {
  type: "translateInput";
  tabId: number;
}

/** Translate text supplied by the browser selection context menu. */
export interface TranslateSelectionMessage {
  type: "translateSelection";
  tabId: number;
  text: string;
}

/** List translation services available to the current configuration. */
export interface GetServicesMessage {
  type: "getServices";
}

export interface ServiceInfo {
  id: string;
  name: string;
  kind: ServiceKind;
  enabled: boolean;
  placeholder: PlaceholderStyle;
}

/** Check one adapter with its unsaved or persisted settings. */
export interface TestServiceMessage {
  type: "testService";
  serviceId: string;
  config?: ServiceConfig;
}

export interface ChatgptOauthAccount {
  accountId?: string;
  email?: string;
  planType?: string;
  expiresAt?: number;
}

export type ChatgptOauthStatus =
  | { state: "logged_out" }
  | {
      state: "pending";
      userCode: string;
      verificationUrl: string;
      startedAt: number;
      expiresAt: number;
      nextPollAt: number;
    }
  | { state: "authenticated"; account: ChatgptOauthAccount }
  | { state: "error"; error: string; retryAfter?: number };

export interface ChatgptOauthStartMessage {
  type: "chatgptOauth.start";
}

export interface ChatgptOauthStatusMessage {
  type: "chatgptOauth.status";
}

export interface ChatgptOauthCancelMessage {
  type: "chatgptOauth.cancel";
}

export interface ChatgptOauthLogoutMessage {
  type: "chatgptOauth.logout";
}

export interface ChatgptOauthImportCliMessage {
  type: "chatgptOauth.importCli";
  json: string;
}

export type ServiceTestResult =
  | { ok: true; latencyMs: number; sample: string }
  | { ok: false; latencyMs: number; error: string };

/** Read and clear translation-cache metadata. */
export interface GetCacheStatsMessage {
  type: "getCacheStats";
}

export interface ClearCacheMessage {
  type: "clearCache";
}

export interface CacheStatsResult {
  count: number;
}

export interface ClearCacheResult {
  cleared: number;
}

/** Validate one site-rule object or JSON string. */
export interface ValidateRuleMessage {
  type: "validateRule";
  rule: JsonValue | string;
}

export interface RuleValidationResult {
  ok: boolean;
  errors: string[];
}

/** Open the extension options page from a content or UI context. */
export interface OpenOptionsMessage {
  type: "openOptions";
}

export interface OpenOptionsResult {
  opened: boolean;
}

export interface AssistantRequestMessage {
  type: "assistantRequest";
  request: AssistantRequest;
}

export interface AssistantResponse {
  text: string;
}

export interface GetAssistantCapabilitiesMessage {
  type: "getAssistantCapabilities";
  serviceId: string;
}

export interface AssistantCapabilities {
  streaming: boolean;
}

export interface OpenSidePanelMessage {
  type: "openSidePanel";
  tabId: number;
}

export interface OpenSidePanelResult {
  opened: boolean;
}

export interface OpenAiWritingMessage {
  type: "openAiWriting";
}

export interface GetPageStateMessage {
  type: "getPageState";
}

export interface GetSelectionTextMessage {
  type: "getSelectionText";
}

export interface SidePanelSelectionMessage {
  type: "sidePanelSelection";
  text: string;
}

export interface ToggleVideoSubtitlePreTranslationMessage {
  type: "toggleVideoSubtitlePreTranslation";
  tabId: number;
}

export type PageTranslationStatus = "idle" | "translating" | "done" | "error";

export interface PageTranslationState {
  status: PageTranslationStatus;
  total: number;
  pending: number;
  translated: number;
  errors: number;
}

export interface PageTranslationStateMessage {
  type: "pageTranslationState";
  state: PageTranslationState;
}

export interface PageTranslationStateAcknowledgement {
  received: true;
}

export interface ControllerCommandMessage {
  type: "pageControllerCommand";
  command: PageCommandId;
}

/** Content-to-background port request; the tab id comes from Port.sender. */
export type TranslatePortMessage = Omit<TranslateMessage, "tabId">;

/** Content-to-background port cancellation; the tab id comes from Port.sender. */
export type CancelPortMessage = Omit<CancelMessage, "tabId">;

/** Every runtime and port message in the extension protocol. */
export type Msg =
  | GetRuleMessage
  | TranslateMessage
  | TranslateResultMessage
  | CancelMessage
  | GetConfigMessage
  | SetConfigMessage
  | ConfigChangedMessage
  | ToggleTranslateMessage
  | TranslateInputMessage
  | TranslateSelectionMessage
  | GetServicesMessage
  | TestServiceMessage
  | ChatgptOauthStartMessage
  | ChatgptOauthStatusMessage
  | ChatgptOauthCancelMessage
  | ChatgptOauthLogoutMessage
  | ChatgptOauthImportCliMessage
  | GetCacheStatsMessage
  | ClearCacheMessage
  | ValidateRuleMessage
  | OpenOptionsMessage
  | AssistantRequestMessage
  | GetAssistantCapabilitiesMessage
  | OpenSidePanelMessage
  | OpenAiWritingMessage
  | GetPageStateMessage
  | GetSelectionTextMessage
  | SidePanelSelectionMessage
  | ToggleVideoSubtitlePreTranslationMessage
  | PageTranslationStateMessage
  | ControllerCommandMessage
  | AcademicResolveMessage
  | AcademicGetMessage
  | AcademicOpenMessage
  | GetLocalModelStatusMessage
  | LoadLocalModelMessage
  | LearningRequest
  | LearningChangedMessage
  | TranslatePortMessage
  | CancelPortMessage;

/** Messages accepted through runtime.sendMessage by the background worker. */
export type BackgroundRequest =
  | GetRuleMessage
  | TranslateMessage
  | CancelMessage
  | GetConfigMessage
  | SetConfigMessage
  | GetServicesMessage
  | TestServiceMessage
  | ChatgptOauthStartMessage
  | ChatgptOauthStatusMessage
  | ChatgptOauthCancelMessage
  | ChatgptOauthLogoutMessage
  | ChatgptOauthImportCliMessage
  | GetCacheStatsMessage
  | ClearCacheMessage
  | ValidateRuleMessage
  | OpenOptionsMessage
  | AssistantRequestMessage
  | GetAssistantCapabilitiesMessage
  | OpenSidePanelMessage
  | PageTranslationStateMessage
  | AcademicResolveMessage
  | AcademicGetMessage
  | AcademicOpenMessage
  | GetLocalModelStatusMessage
  | LoadLocalModelMessage
  | LearningRequest;

/** Save an article or mark an existing context record as collected. */
export interface LearningSaveArticleMessage {
  type: "learningSaveArticle";
  url: string;
  title: string;
}

/** Stop collecting an article while keeping its context record and words. */
export interface LearningRemoveArticleMessage {
  type: "learningRemoveArticle";
  articleId: string;
}

/** Save a word, creating or reusing its article context record. */
export interface LearningSaveWordMessage {
  type: "learningSaveWord";
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

/** Remove a collected word. */
export interface LearningRemoveWordMessage {
  type: "learningRemoveWord";
  wordId: string;
}

export interface LearningListArticlesMessage {
  type: "learningListArticles";
  savedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface LearningListWordsMessage {
  type: "learningListWords";
  articleId?: string;
  limit?: number;
  offset?: number;
}

export interface LearningListWebsitesMessage {
  type: "learningListWebsites";
}

export interface LearningFindWordsByArticleMessage {
  type: "learningFindWordsByArticle";
  articleId: string;
}

export interface LearningAddDictionaryEntryMessage {
  type: "learningAddDictionaryEntry";
  word: string;
  from: LangCode;
  to: LangCode;
  translation?: string;
}

export interface LearningGetDictionaryEntryMessage {
  type: "learningGetDictionaryEntry";
  word: string;
  from: LangCode;
  to: LangCode;
}

export interface LearningListDictionaryEntriesMessage {
  type: "learningListDictionaryEntries";
}

export interface LearningGetRevisionMessage {
  type: "learningGetRevision";
}

/** Broadcast to extension contexts after a learning write. */
export interface LearningChangedMessage {
  type: "learningChanged";
  revision: number;
}

export type LearningRequest =
  | LearningSaveArticleMessage
  | LearningRemoveArticleMessage
  | LearningSaveWordMessage
  | LearningRemoveWordMessage
  | LearningListArticlesMessage
  | LearningListWordsMessage
  | LearningListWebsitesMessage
  | LearningFindWordsByArticleMessage
  | LearningAddDictionaryEntryMessage
  | LearningGetDictionaryEntryMessage
  | LearningListDictionaryEntriesMessage
  | LearningGetRevisionMessage;

export interface LearningSaveArticleResult {
  article: SavedArticle;
}

export interface LearningRemoveArticleResult {
  article: SavedArticle | null;
}

export interface LearningSaveWordResult {
  word: SavedWord;
}

export interface LearningRemoveWordResult {
  removed: boolean;
}

export interface LearningListArticlesResult {
  articles: SavedArticle[];
}

export interface LearningListWordsResult {
  words: SavedWord[];
}

export interface LearningListWebsitesResult {
  websites: WebsiteRecord[];
}

export interface LearningFindWordsByArticleResult {
  words: SavedWord[];
}

export interface LearningAddDictionaryEntryResult {
  entry: PersonalDictionaryEntry;
}

export interface LearningGetDictionaryEntryResult {
  entry: PersonalDictionaryEntry | null;
}

export interface LearningListDictionaryEntriesResult {
  entries: PersonalDictionaryEntry[];
}

export interface LearningGetRevisionResult {
  revision: number;
}

export type LearningResponse =
  | LearningSaveArticleResult
  | LearningRemoveArticleResult
  | LearningSaveWordResult
  | LearningRemoveWordResult
  | LearningListArticlesResult
  | LearningListWordsResult
  | LearningListWebsitesResult
  | LearningFindWordsByArticleResult
  | LearningAddDictionaryEntryResult
  | LearningGetDictionaryEntryResult
  | LearningListDictionaryEntriesResult
  | LearningGetRevisionResult;

/** Acknowledgement for work submitted to a scheduler. */
export interface TranslateAcknowledgement {
  accepted: boolean;
  error?: TranslateError;
}

/** Acknowledgement for cancellation requests. */
export interface CancelAcknowledgement {
  cancelled: boolean;
}

/** Response type selected from a concrete background request. */
export type BackgroundResponse<T extends BackgroundRequest> =
  T extends GetRuleMessage
    ? Rule
    : T extends TranslateMessage
      ? TranslateAcknowledgement
      : T extends CancelMessage
        ? CancelAcknowledgement
        : T extends GetConfigMessage
          ? Config
          : T extends SetConfigMessage
            ? Config
            : T extends GetServicesMessage
              ? ServiceInfo[]
              : T extends TestServiceMessage
                ? ServiceTestResult
                : T extends
                      | ChatgptOauthStartMessage
                      | ChatgptOauthStatusMessage
                      | ChatgptOauthCancelMessage
                      | ChatgptOauthLogoutMessage
                      | ChatgptOauthImportCliMessage
                  ? ChatgptOauthStatus
                  : T extends GetCacheStatsMessage
                    ? CacheStatsResult
                    : T extends ClearCacheMessage
                      ? ClearCacheResult
                      : T extends ValidateRuleMessage
                        ? RuleValidationResult
                        : T extends OpenOptionsMessage
                          ? OpenOptionsResult
                          : T extends
                                | AcademicResolveMessage
                                | AcademicGetMessage
                            ? AcademicTermKnowledge
                            : T extends AcademicOpenMessage
                              ? { opened: boolean }
                              : T extends GetLocalModelStatusMessage
                                ? LocalModelStatusItem[]
                                : T extends LoadLocalModelMessage
                                  ? { started: boolean }
                          : T extends AssistantRequestMessage
                            ? AssistantResponse
                            : T extends GetAssistantCapabilitiesMessage
                              ? AssistantCapabilities
                              : T extends OpenSidePanelMessage
                                ? OpenSidePanelResult
                                : T extends LearningSaveArticleMessage
                                  ? LearningSaveArticleResult
                                  : T extends LearningRemoveArticleMessage
                                    ? LearningRemoveArticleResult
                                    : T extends LearningSaveWordMessage
                                      ? LearningSaveWordResult
                                      : T extends LearningRemoveWordMessage
                                        ? LearningRemoveWordResult
                                        : T extends LearningListArticlesMessage
                                          ? LearningListArticlesResult
                                          : T extends LearningListWordsMessage
                                            ? LearningListWordsResult
                                            : T extends LearningListWebsitesMessage
                                              ? LearningListWebsitesResult
                                              : T extends LearningFindWordsByArticleMessage
                                                ? LearningFindWordsByArticleResult
                                                : T extends LearningAddDictionaryEntryMessage
                                                  ? LearningAddDictionaryEntryResult
                                                    : T extends LearningGetDictionaryEntryMessage
                                                      ? LearningGetDictionaryEntryResult
                                                      : T extends LearningListDictionaryEntriesMessage
                                                        ? LearningListDictionaryEntriesResult
                                                        : T extends LearningGetRevisionMessage
                                                          ? LearningGetRevisionResult
                                                          : T extends PageTranslationStateMessage
                                                        ? PageTranslationStateAcknowledgement
                                                        : never;

/** Messages sent directly to a tab's content script. */
export type TabMessage =
  | TranslateResultMessage
  | ConfigChangedMessage
  | ToggleTranslateMessage
  | TranslateInputMessage
  | TranslateSelectionMessage
  | OpenAiWritingMessage
  | GetPageStateMessage
  | GetSelectionTextMessage
  | ToggleVideoSubtitlePreTranslationMessage
  | ControllerCommandMessage
  | LearningChangedMessage;

/** Send a request to the background worker with an inferred response type. */
export async function sendToBackground<T extends BackgroundRequest>(
  message: T,
): Promise<BackgroundResponse<T>> {
  return (await browser.runtime.sendMessage(message)) as BackgroundResponse<T>;
}

/** Send a typed one-off message to a tab. */
export async function sendToTab<T extends TabMessage>(
  tabId: number,
  message: T,
): Promise<void> {
  await browser.tabs.sendMessage(tabId, message);
}

/** Stable name used to identify streaming translation ports. */
export const TRANSLATE_PORT_NAME = "imt:translate";

/** Messages sent from a content script over the translation port. */
export type TranslatePortRequest = TranslatePortMessage | CancelPortMessage;

/** Messages sent from the background over the translation port. */
export type TranslatePortResponse = TranslateResultMessage;

/** A typed facade over the untyped WebExtension Port API. */
export interface TypedTranslatePort<Outbound, Inbound> {
  readonly sender?: browser.Runtime.MessageSender;
  postMessage(message: Outbound): void;
  onMessage(listener: (message: Inbound) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  disconnect(): void;
}

/** Content-side translation port. */
export type ContentTranslatePort = TypedTranslatePort<
  TranslatePortRequest,
  TranslatePortResponse
>;

/** Background-side translation port. */
export type BackgroundTranslatePort = TypedTranslatePort<
  TranslatePortResponse,
  TranslatePortRequest
>;

function wrapPort<Outbound, Inbound>(
  port: browser.Runtime.Port,
): TypedTranslatePort<Outbound, Inbound> {
  return {
    sender: port.sender,
    postMessage: (message) => port.postMessage(message),
    onMessage: (listener) => {
      const rawListener = (message: unknown): void =>
        listener(message as Inbound);
      port.onMessage.addListener(rawListener);
      return () => port.onMessage.removeListener(rawListener);
    },
    onDisconnect: (listener) => {
      port.onDisconnect.addListener(listener);
      return () => port.onDisconnect.removeListener(listener);
    },
    disconnect: () => port.disconnect(),
  };
}

/** Open the content-side port used for streamed translation results. */
export function connectTranslatePort(): ContentTranslatePort {
  return wrapPort<TranslatePortRequest, TranslatePortResponse>(
    browser.runtime.connect({ name: TRANSLATE_PORT_NAME }),
  );
}

/** Subscribe to background-side translation ports; returns an unsubscribe function. */
export function onTranslatePort(
  handler: (port: BackgroundTranslatePort) => void,
): () => void {
  const listener = (port: browser.Runtime.Port): void => {
    if (port.name !== TRANSLATE_PORT_NAME) return;
    handler(wrapPort<TranslatePortResponse, TranslatePortRequest>(port));
  };

  browser.runtime.onConnect.addListener(listener);
  return () => browser.runtime.onConnect.removeListener(listener);
}
