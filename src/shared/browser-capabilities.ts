import browser from "webextension-polyfill";

interface OffscreenCapabilityApi {
  createDocument?: (options: {
    url: string;
    reasons: string[];
    justification: string;
  }) => Promise<void>;
}

interface SidePanelCapabilityApi {
  open?: (options: { tabId: number }) => Promise<void>;
}

function chromeApi():
  | {
      offscreen?: OffscreenCapabilityApi;
      sidePanel?: SidePanelCapabilityApi;
    }
  | undefined {
  return (
    globalThis as unknown as {
      chrome?: {
        offscreen?: OffscreenCapabilityApi;
        sidePanel?: SidePanelCapabilityApi;
      };
    }
  ).chrome;
}

function hasManifestPermission(permission: string): boolean {
  try {
    return (browser.runtime.getManifest().permissions ?? []).includes(
      permission,
    );
  } catch {
    return false;
  }
}

/** Detect the Chromium offscreen API that hosts the local models. */
export function supportsOffscreenDocuments(): boolean {
  return (
    hasManifestPermission("offscreen") &&
    typeof chromeApi()?.offscreen?.createDocument === "function"
  );
}

/** Detect Chromium's native side panel without relying on the browser brand. */
export function supportsNativeSidePanel(): boolean {
  return (
    hasManifestPermission("sidePanel") &&
    typeof chromeApi()?.sidePanel?.open === "function"
  );
}
