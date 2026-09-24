import browser from "webextension-polyfill";

import { init as initPdfInterception } from "../pdf/intercept";
import {
  CONFIG_STORAGE_KEY,
  DEFAULT_CONFIG,
  loadConfig,
  onConfigChange,
  saveConfig,
} from "../shared/config";
import {
  ASSISTANT_PORT_NAME,
  type AssistantRequest,
} from "../shared/k-assistant";
import {
  onTranslatePort,
  sendToTab,
  type BackgroundRequest,
  type ServiceInfo,
  type TranslateMessage,
} from "../shared/messages";
import type { Rule, ServiceConfig } from "../shared/types";
import {
  DEFAULT_LOCAL_ACADEMIC_MODEL,
  DEFAULT_LOCAL_TRANSLATION_MODEL,
} from "../shared/local-models";
import { removeDuplicateTranslation } from "../shared/deduplicate";
import { supportsNativeSidePanel } from "../shared/browser-capabilities";
import {
  clearTranslationCache,
  cleanupTranslationCache,
  getTranslationCacheCount,
} from "./cache";
import {
  isPageTranslationStateMessage,
  PageBadgeController,
  type BadgeActionApi,
} from "./badge";
import {
  getAcademicKnowledge,
  openAcademicKnowledge,
} from "./academic";
import { requestLocalModel } from "./local-model-host";
import { routeExtensionCommand } from "./commands";
import { createContextMenus, routeContextMenuClick } from "./context-menus";
import { matchRule, validateRule } from "./rules/match";
import { getRemoteRules, registerRemoteRules } from "./rules/remote-rules";
import { cancel, cancelTab, translate } from "./scheduler";
import {
  createService,
  getService,
  initTranslationServices,
  listServices,
} from "./services";
import { TranslateError, type TranslationService } from "./services/base";
import { runServiceTest } from "./service-test";
import {
  cancelChatgptOauth,
  getChatgptOauthStatus,
  importCodexCliAuth,
  logoutChatgptOauth,
  registerChatgptOauthPolling,
  startChatgptOauth,
} from "./services/chatgpt-oauth/auth";

interface NativeSidePanelApi {
  open(options: { tabId: number }): Promise<void>;
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
}

const SIDE_PANEL_PATH = "src/ui/sidepanel/index.html";

function sidePanelApi(): NativeSidePanelApi | undefined {
  return (
    globalThis as unknown as {
      chrome?: { sidePanel?: NativeSidePanelApi };
    }
  ).chrome?.sidePanel;
}

async function openSidePanelCompat(
  tabId?: number,
): Promise<{ opened: true; fallback: "native" | "tab" }> {
  const api = sidePanelApi();
  if (
    tabId !== undefined &&
    api &&
    supportsNativeSidePanel()
  ) {
    try {
      await api.open({ tabId });
      return { opened: true, fallback: "native" };
    } catch {
      // Some Chromium derivatives expose the API but reject it at runtime.
    }
  }
  await browser.tabs.create({
    url: browser.runtime.getURL(SIDE_PANEL_PATH),
  });
  return { opened: true, fallback: "tab" };
}

function actionApi(): BadgeActionApi {
  const native = (
    globalThis as unknown as { chrome?: { action?: BadgeActionApi } }
  ).chrome?.action;
  return native ?? (browser.action as unknown as BadgeActionApi);
}

initTranslationServices();
registerRemoteRules();
initPdfInterception();
registerChatgptOauthPolling();
const pageBadges = new PageBadgeController(actionApi());

async function configuredRule(url: string): Promise<Rule> {
  const [config, remoteRules] = await Promise.all([
    loadConfig(),
    getRemoteRules(),
  ]);
  return matchRule(url, config.userRules, {
    remoteRules,
    baseOverrides: {
      translationMode: config.translationMode,
      theme: config.theme,
    },
  });
}

async function serviceList(): Promise<ServiceInfo[]> {
  const config = await loadConfig();
  const builtins = new Map(
    listServices().map((service) => [service.id, service]),
  );

  return Object.entries(config.services).map(([id, serviceConfig]) => {
    const service = builtins.get(id) ?? createService(id, serviceConfig);
    return {
      id,
      name: service.name,
      kind: serviceConfig.kind,
      enabled: serviceConfig.enabled === true,
      placeholder: service.placeholder,
    };
  });
}

async function configuredService(serviceId: string): Promise<{
  service: TranslationService;
  config: Awaited<ReturnType<typeof loadConfig>>;
}> {
  const config = await loadConfig();
  const serviceConfig = config.services[serviceId];
  if (serviceConfig?.enabled === false) {
    throw new TranslateError(
      "invalid_config",
      `Translation service ${serviceId} is disabled.`,
      { serviceId, retryable: false },
    );
  }
  const service = serviceConfig
    ? createService(serviceId, serviceConfig)
    : getService(serviceId);
  if (!service) {
    throw new TranslateError(
      "invalid_config",
      `Translation service ${serviceId} is not configured.`,
      { serviceId, retryable: false },
    );
  }
  return { service, config };
}

async function runAssistantRequest(
  request: AssistantRequest,
  signal = new AbortController().signal,
): Promise<string> {
  const { service, config } = await configuredService(request.service);
  if (request.kind === "translate") {
    const result = await service.translate(
      {
        texts: [request.text],
        from: request.from ?? config.sourceLanguage,
        to: request.to ?? config.targetLanguage,
        glossary: config.glossaries,
        variant: "selection",
      },
      signal,
    );
    const error = result.errors?.[0];
    if (error) {
      throw new TranslateError("unknown", error.message, {
        serviceId: request.service,
        retryable: error.retryable,
      });
    }
    const text = result.texts[0] ?? "";
    return config.removeDuplicateTranslations
      ? removeDuplicateTranslation(request.text, text) || text
      : text;
  }
  if (!service.completePrompt) {
    throw new TranslateError(
      "invalid_config",
      `Translation service ${request.service} does not support AI assistant actions.`,
      { serviceId: request.service, retryable: false },
    );
  }
  return service.completePrompt(request, signal);
}

async function testService(serviceId: string, unsavedConfig?: ServiceConfig) {
  const config = await loadConfig();
  const serviceConfig = unsavedConfig ?? config.services[serviceId];
  if (!serviceConfig) {
    return {
      ok: false as const,
      latencyMs: 0,
      error: `未找到服务配置：${serviceId}`,
    };
  }
  return runServiceTest(serviceId, serviceConfig, {
    targetLanguage: config.targetLanguage,
  });
}

function runTranslation(request: TranslateMessage): void {
  void translate(request, (message) => {
    void sendToTab(request.tabId, message).catch(() => undefined);
  });
}

browser.runtime.onMessage.addListener(
  (message: unknown, sender: browser.Runtime.MessageSender) => {
    if (isPageTranslationStateMessage(message)) {
      return pageBadges.handleMessage(message, sender);
    }
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    ) {
      return undefined;
    }

    const request = message as BackgroundRequest;
    switch (request.type) {
      case "getRule":
        return configuredRule(request.url);
      case "getConfig":
        return loadConfig();
      case "setConfig":
        return saveConfig(request.patch);
      case "translate":
        runTranslation(request);
        return Promise.resolve({ accepted: true });
      case "cancel":
        cancel(request.tabId, request.requestId);
        return Promise.resolve({ cancelled: true });
      case "getServices":
        return serviceList();
      case "testService":
        return testService(request.serviceId, request.config);
      case "chatgptOauth.start":
        return startChatgptOauth();
      case "chatgptOauth.status":
        return getChatgptOauthStatus();
      case "chatgptOauth.cancel":
        return cancelChatgptOauth();
      case "chatgptOauth.logout":
        return logoutChatgptOauth();
      case "chatgptOauth.importCli":
        return importCodexCliAuth(request.json);
      case "getCacheStats":
        return getTranslationCacheCount().then((count) => ({ count }));
      case "clearCache":
        return getTranslationCacheCount().then(async (cleared) => {
          await clearTranslationCache();
          return { cleared };
        });
      case "validateRule":
        return Promise.resolve(validateRule(request.rule));
      case "openOptions":
        return browser.runtime.openOptionsPage().then(() => ({ opened: true }));
      case "assistantRequest":
        return runAssistantRequest(request.request).then((text) => ({ text }));
      case "getAssistantCapabilities":
        return configuredService(request.serviceId).then(({ service }) => ({
          streaming: typeof service.onPartial === "function",
        }));
      case "academicResolve":
        return getAcademicKnowledge(request.term, {
          refresh: true,
          context: request.context,
          title: request.title,
          url: request.url,
          domain: request.domain,
          service: request.service,
        });
      case "academicGet":
        return getAcademicKnowledge(request.term);
      case "openAcademic":
        return openAcademicKnowledge(request.term).then((opened) => ({
          opened,
        }));
      case "getLocalModelStatus": {
        return loadConfig().then((config) => {
          const local = config.services["local-model"];
          const models = [
            {
              role: "translation" as const,
              model: local?.model ?? DEFAULT_LOCAL_TRANSLATION_MODEL,
            },
            {
              role: "academic" as const,
              model:
                local?.models?.[0] ??
                DEFAULT_LOCAL_ACADEMIC_MODEL,
            },
          ];
          return Promise.all(
            models.map(async ({ role, model }) => {
              try {
                const response = await requestLocalModel<{
                  ready?: boolean;
                  status?: {
                    status?: string;
                    progress?: number;
                    loaded?: number;
                    total?: number;
                    file?: string;
                  };
                  error?: string;
                }>({
                  action: "status",
                  model,
                  device: local?.localDevice ?? "auto",
                  dtype: local?.localDtype ?? "q4",
                });
                return {
                  role,
                  model,
                  ready: response.ready === true,
                  status: response.error ?? response.status?.status ?? "idle",
                  progress: response.status?.progress ?? 0,
                  loaded: response.status?.loaded ?? 0,
                  total: response.status?.total ?? 0,
                  file: response.status?.file,
                };
              } catch (error) {
                return {
                  role,
                  model,
                  ready: false,
                  status:
                    error instanceof Error ? error.message : String(error),
                  progress: 0,
                  loaded: 0,
                  total: 0,
                };
              }
            }),
          );
        });
      }
      case "loadLocalModel": {
        return loadConfig().then((config) => {
          const local = config.services["local-model"];
          const translationModel =
            local?.model ?? DEFAULT_LOCAL_TRANSLATION_MODEL;
          const academicModel =
            local?.models?.[0] ??
            DEFAULT_LOCAL_ACADEMIC_MODEL;
          const common = {
            action: "load",
            device: local?.localDevice ?? "auto",
            dtype: local?.localDtype ?? "q4",
          };
          if (request.target === "translation" || request.target === "all") {
            void requestLocalModel({
              ...common,
              target: "translation",
              model: translationModel,
            }).catch(() => undefined);
          }
          if (request.target === "academic" || request.target === "all") {
            void requestLocalModel({
              ...common,
              target: "academic",
              model: academicModel,
            }).catch(() => undefined);
          }
          return { started: true };
        });
      }
      case "openSidePanel": {
        return openSidePanelCompat(request.tabId);
      }
      default:
        return undefined;
    }
  },
);

onTranslatePort((port) => {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) {
    port.disconnect();
    return;
  }

  const requestIds = new Set<string>();
  let disconnected = false;
  port.onMessage((message) => {
    if (message.type === "cancel") {
      cancel(tabId, message.requestId);
      if (message.requestId) requestIds.delete(message.requestId);
      return;
    }

    const request: TranslateMessage = { ...message, tabId };
    requestIds.add(request.requestId);
    void translate(request, (response) => {
      if (response.done) requestIds.delete(request.requestId);
      if (!disconnected) port.postMessage(response);
    });
  });

  port.onDisconnect(() => {
    disconnected = true;
    for (const requestId of requestIds) cancel(tabId, requestId);
    requestIds.clear();
  });
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== ASSISTANT_PORT_NAME) return;
  const controllers = new Map<string, AbortController>();
  let disconnected = false;
  port.onMessage.addListener((message: unknown) => {
    if (
      typeof message !== "object" ||
      message === null ||
      !("type" in message) ||
      message.type !== "assistantRequest" ||
      !("requestId" in message) ||
      typeof message.requestId !== "string" ||
      !("request" in message)
    ) {
      return;
    }
    const requestId = message.requestId;
    const request = message.request as AssistantRequest;
    const controller = new AbortController();
    controllers.set(requestId, controller);
    void configuredService(request.service)
      .then(async ({ service, config }) => {
        const clean = (text: string): string =>
          request.kind === "translate" &&
          config.removeDuplicateTranslations
            ? removeDuplicateTranslation(request.text, text) || text
            : text;
        const emit = (text: string): void => {
          if (!disconnected) {
            port.postMessage({
              type: "assistantPartial",
              requestId,
              text: clean(text),
              done: false,
            });
          }
        };
        const rawText = service.onPartial
          ? await service.onPartial(request, emit, controller.signal)
          : await runAssistantRequest(request, controller.signal);
        if (!disconnected) {
          port.postMessage({
            type: "assistantPartial",
            requestId,
            text: clean(rawText),
            done: true,
          });
        }
      })
      .catch((error: unknown) => {
        if (!disconnected) {
          port.postMessage({
            type: "assistantPartial",
            requestId,
            done: true,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .finally(() => controllers.delete(requestId));
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
  });
});

async function dispatchPageCommand(
  command: string,
  targetTabId?: number,
): Promise<void> {
  const tabId =
    targetTabId ??
    (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) return;
  await browser.tabs.sendMessage(
    tabId,
    { type: "pageControllerCommand", command },
    { frameId: 0 },
  );
}

browser.commands.onCommand.addListener((command) => {
  void routeExtensionCommand(command, {
    async getActiveTabId() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.id;
    },
    sendControllerCommand: (tabId, command) =>
      dispatchPageCommand(command, tabId),
    async sendTabMessage(tabId, message) {
      await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
    },
    async openSidePanel(tabId) {
      await openSidePanelCompat(tabId);
    },
  }).catch(() => undefined);
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  void routeContextMenuClick(info, tab, {
    sendControllerCommand: (tabId, command) =>
      dispatchPageCommand(command, tabId),
    async sendTabMessage(tabId, message) {
      await browser.tabs.sendMessage(tabId, message, { frameId: 0 });
    },
    async openExtensionPage(path) {
      await browser.tabs.create({ url: browser.runtime.getURL(path) });
    },
    async openSidePanel(tabId) {
      await openSidePanelCompat(tabId);
    },
  }).catch(() => undefined);
});

browser.runtime.onInstalled.addListener((details) => {
  void (async () => {
    const stored = await browser.storage.local.get(CONFIG_STORAGE_KEY);
    if (stored[CONFIG_STORAGE_KEY] === undefined) {
      await browser.storage.local.set({ [CONFIG_STORAGE_KEY]: DEFAULT_CONFIG });
    } else {
      await browser.storage.local.set({
        [CONFIG_STORAGE_KEY]: await loadConfig(),
      });
    }
    const config = await loadConfig();
    if (details.reason === "update") await clearTranslationCache();
    await cleanupTranslationCache(config.cache.maxAgeDays);
    if (supportsNativeSidePanel()) {
      await sidePanelApi()?.setPanelBehavior({
        openPanelOnActionClick: false,
      });
    }
    await createContextMenus(
      browser.contextMenus as unknown as Parameters<
        typeof createContextMenus
      >[0],
    );
  })().catch((error: unknown) => {
    console.error("[imt] Installation setup failed", error);
  });
});

onConfigChange((config) => {
  void browser.tabs
    .query({})
    .then((tabs) =>
      Promise.all(
        tabs.map((tab) =>
          tab.id === undefined
            ? Promise.resolve()
            : sendToTab(tab.id, { type: "configChanged", config }).catch(
                () => undefined,
              ),
        ),
      ),
    );
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    void pageBadges.clear(details.tabId).catch(() => undefined);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  cancelTab(tabId);
  pageBadges.forget(tabId);
});
