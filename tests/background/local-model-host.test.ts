import { beforeEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    sendMessage: vi.fn(),
  },
  tabs: {
    query: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 7 })),
    update: vi.fn(async () => ({ id: 7 })),
  },
}));

vi.mock("webextension-polyfill", () => ({ default: browserMock }));
vi.mock("../../src/shared/browser-capabilities", () => ({
  supportsOffscreenDocuments: () => false,
}));

import { requestLocalModel } from "../../src/background/local-model-host";

beforeEach(() => {
  vi.clearAllMocks();
  browserMock.tabs.query.mockResolvedValue([]);
  browserMock.tabs.create.mockResolvedValue({ id: 7 });
  browserMock.tabs.update.mockResolvedValue({ id: 7 });
  browserMock.runtime.sendMessage
    .mockResolvedValueOnce({ ok: true, host: "local-model" })
    .mockResolvedValueOnce({ ok: true, ready: true, texts: ["译文"] });
});

describe("local-model host compatibility", () => {
  it("uses an inactive extension tab when offscreen documents are unavailable", async () => {
    const result = await requestLocalModel({
      action: "translate",
      texts: ["Explore content"],
    });

    expect(browserMock.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/src/local-model/index.html",
      active: false,
      pinned: true,
    });
    expect(browserMock.tabs.update).toHaveBeenCalledWith(7, {
      autoDiscardable: false,
    });
    expect(browserMock.runtime.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        localModelRequest: true,
        action: "translate",
      }),
    );
    expect(result).toEqual({ ok: true, ready: true, texts: ["译文"] });
  });
});
