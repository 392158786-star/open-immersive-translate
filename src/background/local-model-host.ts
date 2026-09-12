import browser from "webextension-polyfill";

import { supportsOffscreenDocuments } from "../shared/browser-capabilities";

interface OffscreenApi {
  createDocument(options: {
    url: string;
    reasons: string[];
    justification: string;
  }): Promise<void>;
}

interface RuntimeContextsApi {
  getContexts(options: {
    contextTypes: string[];
    documentUrls?: string[];
  }): Promise<unknown[]>;
}

const LOCAL_MODEL_HOST_PATH = "src/local-model/index.html";
const HOST_READY_TIMEOUT_MS = 20_000;

let creating: Promise<void> | undefined;

function offscreenDocumentUrl(): string {
  return browser.runtime.getURL(LOCAL_MODEL_HOST_PATH);
}

async function ensureOffscreenDocument(): Promise<void> {
  const chromeApi = (
    globalThis as unknown as {
      chrome?: {
        offscreen?: OffscreenApi;
        runtime?: RuntimeContextsApi;
      };
    }
  ).chrome;
  if (!chromeApi?.offscreen || !supportsOffscreenDocuments()) {
    throw new Error("The offscreen document API is unavailable.");
  }

  const url = offscreenDocumentUrl();
  try {
    const contexts =
      (await chromeApi.runtime?.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [url],
      })) ?? [];
    if (contexts.length) return;
  } catch {
    // Older Chromium builds lack runtime.getContexts. The creation promise
    // below still serializes attempts in this service worker instance.
  }

  if (!creating) {
    creating = chromeApi.offscreen
      .createDocument({
        url,
        reasons: ["WORKERS", "BLOBS"],
        justification: "Run downloadable on-device translation and AI models.",
      })
      .finally(() => {
        creating = undefined;
      });
  }
  await creating;
}

function isLocalModelStatus(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === true &&
    (value as { host?: unknown }).host === "local-model"
  );
}

async function waitForLocalModelHost(): Promise<void> {
  const deadline = Date.now() + HOST_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await browser.runtime.sendMessage({
        localModelRequest: true,
        action: "status",
      });
      if (isLocalModelStatus(response)) return;
    } catch {
      // The extension host page may still be loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The compatibility local-model page did not become ready.");
}

async function ensureHostTab(): Promise<void> {
  const url = offscreenDocumentUrl();
  const tabs = await browser.tabs.query({});
  const existing = tabs.find(
    (tab) => tab.url === url || tab.url?.startsWith(`${url}#`),
  );
  if (existing?.id !== undefined) {
    await browser.tabs
      .update(existing.id, { autoDiscardable: false } as never)
      .catch(() => undefined);
    return;
  }

  if (!creating) {
    creating = browser.tabs
      .create({ url, active: false, pinned: true })
      .then(async (tab) => {
        if (tab.id !== undefined) {
          await browser.tabs
            .update(tab.id, { autoDiscardable: false } as never)
            .catch(() => undefined);
        }
      })
      .finally(() => {
        creating = undefined;
      });
  }
  await creating;
}

/**
 * Send one request to the local-model host.
 *
 * Full Chromium browsers use an offscreen document. Domestic Chromium builds
 * often omit that API, so the same extension page is kept in an inactive tab.
 */
export async function requestLocalModel<T>(
  message: Record<string, unknown>,
): Promise<T> {
  if (supportsOffscreenDocuments()) {
    await ensureOffscreenDocument();
  } else {
    await ensureHostTab();
    await waitForLocalModelHost();
  }
  return (await browser.runtime.sendMessage({
    ...message,
    localModelRequest: true,
  })) as T;
}
