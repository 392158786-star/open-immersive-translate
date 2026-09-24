import { afterEach, describe, expect, it, vi } from "vitest";

const browserMock = vi.hoisted(() => ({
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    openOptionsPage: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("webextension-polyfill", () => ({ default: browserMock }));

import {
  FLOAT_BALL_POSITION_KEY,
  init,
} from "../../src/content/features/float-ball";
import type { FeatureContext } from "../../src/content/features/context";

function pointerEvent(type: string, x: number, y: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event as PointerEvent;
}

function context(): FeatureContext {
  return {
    config: {
      floatBall: { enabled: true, position: "right" },
      neverTranslateSites: [],
    } as unknown as FeatureContext["config"],
    rule: { matches: ["<all_urls>"] },
    translateText: vi.fn(),
    translateParagraph: vi.fn(),
    toggleTranslate: vi.fn(),
    isTranslated: vi.fn(() => false),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  document.documentElement
    .querySelectorAll("[data-imt]")
    .forEach((element) => element.remove());
  vi.clearAllMocks();
});

describe("float ball", () => {
  it("persists the final pointer position after a drag", async () => {
    const dispose = init(context());
    const host = document.querySelector<HTMLElement>(
      '[data-imt="float-ball"]',
    )!;
    const button = host.shadowRoot!.querySelector<HTMLButtonElement>(".ball")!;
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 136,
      bottom: 236,
      width: 36,
      height: 36,
      toJSON: () => ({}),
    });

    button.dispatchEvent(pointerEvent("pointerdown", 110, 210));
    window.dispatchEvent(pointerEvent("pointermove", 160, 260));
    window.dispatchEvent(pointerEvent("pointerup", 160, 260));

    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      [FLOAT_BALL_POSITION_KEY]: expect.objectContaining({
        x: 150,
        y: 250,
      }),
    });
    expect(host.style.left).toBe("150px");
    expect(host.style.top).toBe("250px");
    dispose();
  });

  it("keeps the ball inside a smaller viewport", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });
    browserMock.storage.local.get.mockResolvedValueOnce({
      [FLOAT_BALL_POSITION_KEY]: {
        x: 0,
        y: 0,
        xRatio: 1,
        yRatio: 1,
      },
    });
    const dispose = init(context());
    await Promise.resolve();
    await Promise.resolve();
    const host = document.querySelector<HTMLElement>(
      '[data-imt="float-ball"]',
    )!;

    expect(host.style.left).toBe("556px");
    expect(host.style.top).toBe("356px");

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 320,
    });
    window.dispatchEvent(new Event("resize"));

    expect(host.style.left).toBe("276px");
    expect(host.style.top).toBe("276px");
    dispose();
  });

  it("snaps a centered ball to the nearest edge when the viewport changes", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 400,
    });
    browserMock.storage.local.get.mockResolvedValueOnce({
      [FLOAT_BALL_POSITION_KEY]: {
        x: 0,
        y: 0,
        xRatio: 0.5,
        yRatio: 0.5,
      },
    });
    const dispose = init(context());
    const host = document.querySelector<HTMLElement>(
      '[data-imt="float-ball"]',
    )!;

    window.dispatchEvent(new Event("resize"));

    expect(host.style.left).toBe("556px");
    expect(host.style.top).toBe("182px");
    dispose();
  });

  it("resets the saved position when storage removes the position key", () => {
    const dispose = init(context());
    const host = document.querySelector<HTMLElement>(
      '[data-imt="float-ball"]',
    )!;
    const listener = browserMock.storage.onChanged.addListener.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf("function");

    host.style.left = "10px";
    listener({ [FLOAT_BALL_POSITION_KEY]: { oldValue: {} } }, "local");

    expect(host.style.left).toBe("556px");
    expect(host.style.top).toBe("182px");
    dispose();
  });
});
