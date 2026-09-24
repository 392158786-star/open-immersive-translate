import {
  expect,
  test,
  type BrowserContext,
  type BrowserType,
  type Worker,
} from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

interface ExtensionApi {
  runtime: {
    getManifest(): { permissions?: string[] };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(
      query: Record<string, unknown>,
    ): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  scripting: {
    executeScript(
      details: Record<string, unknown>,
    ): Promise<Array<{ result?: unknown }>>;
  };
}

interface ExtensionWorkerGlobal {
  chrome: ExtensionApi;
}

let server: Server;
let origin: string;
let fixturePdf: Uint8Array;
let profileSequence = 0;

test.beforeAll(async () => {
  const fixture = await readFile(
    path.resolve("tests/e2e/fixtures/article.html"),
    "utf8",
  );
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pdfPage = pdf.addPage([420, 240]);
  pdfPage.drawText("Tiny PDF paragraph for translation.", {
    x: 40,
    y: 160,
    size: 15,
    font,
  });
  fixturePdf = await pdf.save();

  server = createServer((request, response) => {
    if (request.url === "/fixture.pdf") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/pdf",
      });
      response.end(Buffer.from(fixturePdf));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fixture);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not start the fixture server.");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function extensionWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function launchExtension(playwright: {
  chromium: BrowserType;
}, extensionPath = path.resolve("dist")): Promise<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}> {
  const userDataDir = path.join(
    tmpdir(),
    `bilingual-translator-e2e-${process.pid}-${++profileSequence}`,
  );
  const context = await playwright.chromium.launchPersistentContext(
    userDataDir,
    {
      channel: process.env.PW_CHANNEL ?? "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--lang=zh-CN",
      ],
    },
  );
  const worker = await extensionWorker(context);
  return {
    context,
    worker,
    extensionId: new URL(worker.url()).host,
  };
}

async function selectMockService(
  worker: Worker,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await worker.evaluate(async (configPatch) => {
    const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
    let config: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 100 && !config; attempt += 1) {
      const stored = await api.storage.local.get("config");
      if (stored.config && typeof stored.config === "object") {
        config = stored.config as Record<string, unknown>;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (!config) throw new Error("Extension defaults were not installed.");
    const services = config.services as Record<string, unknown>;
    const fastService = services.transmart as
      | Record<string, unknown>
      | undefined;
    const fallbackService = services["youdao-free"] as
      | Record<string, unknown>
      | undefined;
    const localModel = services["local-model"] as
      | Record<string, unknown>
      | undefined;
    if (
      config.service !== "transmart" ||
      fastService?.enabled !== true ||
      fastService.fallbackService !== "youdao-free" ||
      fallbackService?.enabled !== true
    ) {
      throw new Error("Fresh-install fast translation defaults are invalid.");
    }
    if (localModel?.enabled !== true) {
      throw new Error("Fresh-install local fallback defaults are invalid.");
    }
    await api.storage.local.set({
      config: {
        ...config,
        ...configPatch,
        service: "mock",
        services: {
          ...services,
          ...((configPatch.services as Record<string, unknown> | undefined) ??
            {}),
          mock: { kind: "mock", enabled: true },
        },
        floatBall: { enabled: false, position: "right" },
        hover: { enabled: false, holdKey: "Alt" },
        selection: { enabled: false },
        input: { enabled: false, trigger: "//" },
        subtitle: {
          ...(config.subtitle as Record<string, unknown>),
          youtube: false,
        },
      },
    });
  }, patch);
}

async function sendToArticleTab(
  worker: Worker,
  message: Record<string, unknown>,
): Promise<boolean> {
  return worker.evaluate(
    async ({ pageOrigin, runtimeMessage }) => {
      const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
      const tabs = await api.tabs.query({});
      const tab = tabs.find((candidate) =>
        candidate.url?.startsWith(pageOrigin),
      );
      if (tab?.id === undefined) return false;
      try {
        await api.tabs.sendMessage(tab.id, runtimeMessage);
        return true;
      } catch {
        return false;
      }
    },
    { pageOrigin: origin, runtimeMessage: message },
  );
}

async function toggleActivePage(worker: Worker): Promise<boolean> {
  return sendToArticleTab(worker, { type: "toggleTranslate" });
}

async function runPageCommand(
  worker: Worker,
  command: string,
): Promise<boolean> {
  return sendToArticleTab(worker, { type: "pageControllerCommand", command });
}

async function contentState(worker: Worker): Promise<{
  ready: boolean;
  active: boolean;
  error?: string;
}> {
  return worker.evaluate(async (pageOrigin) => {
    const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
    const tabs = await api.tabs.query({});
    const tab = tabs.find((candidate) => candidate.url?.startsWith(pageOrigin));
    if (tab?.id === undefined) return { ready: false, active: false };
    const [execution] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        ready: window.__imt?.ready ?? false,
        active: window.__imt?.active ?? false,
        error: window.__imt?.error ? String(window.__imt.error) : undefined,
      }),
    });
    return execution?.result as {
      ready: boolean;
      active: boolean;
      error?: string;
    };
  }, origin);
}

test("translates article paragraphs once and restores the DOM", async ({
  playwright,
}) => {
  const { context, worker } = await launchExtension(playwright);
  try {
    await selectMockService(worker);
    const page = await context.newPage();
    await page.goto(`${origin}/article.html`);
    const originalBody = await page.locator("body").innerHTML();

    await expect
      .poll(() => contentState(worker))
      .toMatchObject({ ready: true });
    expect(await toggleActivePage(worker)).toBe(true);
    await expect.poll(() => contentState(worker)).toMatchObject({
      active: true,
    });
    await expect(page.locator("html")).toHaveClass(
      /imt-translation-scroll-lock/u,
    );
    await expect
      .poll(() =>
        page
          .locator("article > p")
          .evaluateAll((paragraphs) =>
            paragraphs.map(
              (paragraph) =>
                paragraph.querySelectorAll("font[data-imt='target']").length,
            ),
          ),
      )
      .toEqual([1, 1, 1]);

    await expect(
      page.locator("article > p font[data-imt='target']"),
    ).toHaveCount(3);
    await expect(
      page.locator("article > p font[data-imt='target']").first(),
    ).toContainText("[zh]");
    await expect(page.locator("nav font[data-imt='target']")).toHaveCount(0);
    await expect(page.locator("pre font[data-imt='target']")).toHaveCount(0);
    await expect(page.locator("code font[data-imt='target']")).toHaveCount(0);

    expect(await toggleActivePage(worker)).toBe(true);
    await expect.poll(() => contentState(worker)).toMatchObject({
      active: false,
    });
    await expect(page.locator("html")).not.toHaveClass(
      /imt-translation-scroll-lock/u,
    );
    await expect(page.locator("font[data-imt='target']")).toHaveCount(0);
    await expect
      .poll(() => page.locator("body").innerHTML())
      .toBe(originalBody);
  } finally {
    await context.close();
  }
});

test("applies glossary entries and toggles mask and translation-only mode", async ({
  playwright,
}) => {
  const { context, worker } = await launchExtension(playwright);
  try {
    await selectMockService(worker, {
      glossaries: [{ k: "first paragraph", v: "首段术语" }],
      translateToPageEndImmediately: true,
      translationMode: "dual",
    });
    const page = await context.newPage();
    await page.goto(`${origin}/article.html`);
    await expect
      .poll(() => contentState(worker))
      .toMatchObject({ ready: true });
    expect(await toggleActivePage(worker)).toBe(true);

    const firstTranslation = page
      .locator("#first font[data-imt='target']")
      .first();
    await expect(firstTranslation).toContainText(
      "[zh] 翻译文本 首段术语",
    );

    expect(await runPageCommand(worker, "toggleTranslationMask")).toBe(true);
    await expect(page.locator("html")).toHaveClass(/imt-translation-mask/u);

    expect(await runPageCommand(worker, "toggleOnlyTranslation")).toBe(true);
    await expect(page.locator("#first [data-imt='source']")).toHaveClass(
      /imt-source-hidden/u,
    );
    await expect(firstTranslation).toBeVisible();
  } finally {
    await context.close();
  }
});

test("opens a PDF URL and translates its extracted paragraph", async ({
  playwright,
}) => {
  const { context, worker, extensionId } = await launchExtension(playwright);
  try {
    await selectMockService(worker);
    const page = await context.newPage();
    const reader = new URL(
      `chrome-extension://${extensionId}/src/pdf/index.html`,
    );
    reader.searchParams.set("file", `${origin}/fixture.pdf`);
    await page.goto(reader.href);

    await expect(page.locator(".pdf-page-shell")).toHaveCount(1);
    await expect(page.locator(".pdf-translation").first()).toContainText(
      "[zh] 翻译文本",
    );
  } finally {
    await context.close();
  }
});

test("translates every cue in a local SRT file", async ({ playwright }) => {
  const { context, worker, extensionId } = await launchExtension(playwright);
  try {
    await selectMockService(worker);
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/subtitle-file/index.html`,
    );
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "First cue",
      "",
      "2",
      "00:00:01,500 --> 00:00:02,500",
      "Second cue",
      "",
      "3",
      "00:00:03,000 --> 00:00:04,000",
      "Third cue",
      "",
    ].join("\n");
    await page.locator("input[type='file']").setInputFiles({
      name: "fixture.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(srt),
    });
    await expect(page.locator("tbody tr")).toHaveCount(3);
    await page
      .getByRole("button", {
        name: /翻译全部字幕|Translate all subtitles/u,
      })
      .click();
    await expect(page.locator("tbody tr td:last-child")).toHaveText([
      "[zh] 翻译文本",
      "[zh] 翻译文本",
      "[zh] 翻译文本",
    ]);
  } finally {
    await context.close();
  }
});

test("loads the side panel and round-trips text through the mock service", async ({
  playwright,
}) => {
  const { context, worker, extensionId } = await launchExtension(playwright);
  try {
    await selectMockService(worker);
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/ui/sidepanel/index.html`,
    );
    await page
      .getByRole("textbox", {
        name: /输入要翻译的文字|Enter text to translate/u,
      })
      .fill("Side panel sample");
    await page
      .getByRole("button", { name: /翻译文字|Translate text/u })
      .click();
    await expect(page.locator(".side-output")).toHaveText(
      "[zh] 翻译文本",
    );
  } finally {
    await context.close();
  }
});

test("translates newly visible paragraphs after scrolling a long page", async ({
  playwright,
}) => {
  const { context, worker } = await launchExtension(playwright);
  try {
    await selectMockService(worker, {
      translateToPageEndImmediately: false,
    });
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(() => {
      const article = document.querySelector("main article");
      if (!article) throw new Error("Article fixture is missing.");
      for (let index = 0; index < 120; index += 1) {
        const paragraph = document.createElement("p");
        paragraph.textContent = `Scroll test paragraph ${index} with enough English text for translation.`;
        article.append(paragraph);
      }
    });
    await expect.poll(() => contentState(worker)).toMatchObject({
      ready: true,
    });
    expect(await runPageCommand(worker, "toggleTranslateTheWholePage")).toBe(
      true,
    );
    await expect(page.locator('[data-imt="target"]').first()).toBeVisible();
    const before = await page.locator('[data-imt="target"]').count();
    const translatedHtmlBeforeScroll = await page
      .locator("#first [data-imt='target']")
      .evaluate((element) => {
        const state = window as unknown as {
          __imtScrollMutations: number;
        };
        state.__imtScrollMutations = 0;
        new MutationObserver((records) => {
          state.__imtScrollMutations += records.length;
        }).observe(element, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
        return element.outerHTML;
      });

    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(() => page.locator('[data-imt="target"]').count(), {
        timeout: 5_000,
      })
      .toBeGreaterThan(before);
    await expect(
      page.locator('p', { hasText: "Scroll test paragraph 119" }).last(),
    ).toContainText("[zh]");
    await expect(page.locator("#first [data-imt='target']")).toHaveCount(1);
    expect(
      await page.locator("#first [data-imt='target']").evaluate((element) => ({
        html: element.outerHTML,
        mutations: (
          window as unknown as { __imtScrollMutations: number }
        ).__imtScrollMutations,
      })),
    ).toEqual({
      html: translatedHtmlBeforeScroll,
      mutations: 0,
    });
  } finally {
    await context.close();
  }
});

test("shows the site-scoped word collection drawer and isolates by hostname", async ({
  playwright,
}) => {
  const { context, worker, extensionId } = await launchExtension(playwright);
  try {
    await selectMockService(worker);
    const fixture = await readFile(
      path.resolve("tests/e2e/fixtures/article.html"),
      "utf8",
    );
    const hostA = "http://site-a.example";
    const hostB = "http://site-b.example";
    const fulfillFixture = async (route: {
      fulfill(options: {
        status: number;
        contentType: string;
        body: string;
      }): Promise<void>;
    }): Promise<void> => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: fixture,
      });
    };
    await context.route(`${hostA}/**`, fulfillFixture);
    await context.route(`${hostB}/**`, fulfillFixture);

    const articleUrl = `${hostA}/article.html`;
    const helper = await context.newPage();
    await helper.goto(
      `chrome-extension://${extensionId}/src/ui/sidepanel/index.html`,
    );
    await helper.evaluate(
      async ({ url }) => {
        const api = (
          globalThis as unknown as {
            chrome: {
              runtime: {
                sendMessage(message: unknown): Promise<unknown>;
              };
            };
          }
        ).chrome;
        await api.runtime.sendMessage({
          type: "learningSaveWord",
          url,
          title: "Translation smoke test",
          domain: "Computer science",
          word: "algorithm",
          sentence: "An algorithm is a set of steps.",
          previousSentence: "",
          nextSentence: "",
          paragraphTheme: "Introduction",
          translation: "algorithm translation",
          partOfSpeech: "noun",
          definition: "A procedure for solving a problem.",
        });
      },
      { url: articleUrl },
    );
    await expect(helper.getByRole("tab")).toHaveCount(3);
    await helper.close();

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(articleUrl);
    const collection = page.locator('[data-imt="word-collection"]');
    await expect(collection.locator(".handle")).toBeVisible();
    await expect(collection.locator(".handle-count")).toHaveText("1");

    const handleBox = await collection.locator(".handle").boundingBox();
    expect(handleBox).not.toBeNull();
    expect((handleBox?.x ?? 0) + (handleBox?.width ?? 0)).toBeGreaterThan(
      1280 - 5,
    );

    await collection.locator(".handle").click();
    await expect(collection.locator(".drawer")).toBeVisible();
    await expect(collection.locator(".drawer-list")).toContainText("algorithm");
    await collection.locator(".word-card").click();
    await expect(collection.locator(".drawer-knowledge")).toBeVisible();
    await expect(collection.locator(".drawer-knowledge")).toContainText(
      "noun",
    );

    const otherPage = await context.newPage();
    await otherPage.setViewportSize({ width: 1280, height: 800 });
    await otherPage.goto(`${hostB}/article.html`);
    const otherCollection = otherPage.locator('[data-imt="word-collection"]');
    await expect(otherCollection.locator(".handle")).toBeVisible();
    await expect(otherCollection.locator(".handle-count")).toHaveText("0");
  } finally {
    await context.close();
  }
});

test("falls back to extension tabs in the domestic Chromium build", async ({
  playwright,
}) => {
  const { context, worker } = await launchExtension(
    playwright,
    path.resolve("dist-chromium-compat"),
  );
  try {
    await worker.evaluate(async () => {
      const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
      let config: Record<string, unknown> | undefined;
      for (let attempt = 0; attempt < 100 && !config; attempt += 1) {
        const stored = await api.storage.local.get("config");
        if (stored.config && typeof stored.config === "object") {
          config = stored.config as Record<string, unknown>;
        } else {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      if (!config) throw new Error("Extension defaults were not installed.");
      const services = config.services as Record<string, unknown>;
      await api.storage.local.set({
        config: {
          ...config,
          service: "local-model",
          translateMainOnly: false,
          translationMode: "dual",
          services: {
            ...services,
            "local-model": {
              ...(services["local-model"] as Record<string, unknown>),
              enabled: true,
            },
          },
        },
      });
    });
    const permissions = await worker.evaluate(() => {
      const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
      return api.runtime.getManifest().permissions ?? [];
    });
    expect(permissions).not.toContain("offscreen");
    expect(permissions).not.toContain("sidePanel");

    const page = await context.newPage();
    await page.goto(origin);
    await page.locator('[data-imt="float-ball"] .ball').waitFor({
      state: "visible",
    });
    await page
      .locator('[data-imt="float-ball"] .ball')
      .evaluate((element) => (element as HTMLElement).click());
    await page
      .locator('[data-imt="float-ball"] [data-action="dual"]')
      .evaluate((element) => (element as HTMLElement).click());

    await expect
      .poll(
        () =>
          context
            .pages()
            .some((candidate) =>
              candidate.url().includes("/src/local-model/index.html"),
            ),
        { timeout: 20_000 },
      )
      .toBe(true);

    const modelPage = context
      .pages()
      .find((candidate) =>
        candidate.url().includes("/src/local-model/index.html"),
      );
    expect(modelPage).toBeDefined();
    const activeTabId = await worker.evaluate(
      async () => {
        const api = (globalThis as unknown as ExtensionWorkerGlobal).chrome;
        return (
          await api.tabs.query({ active: true, currentWindow: true })
        )[0]?.id;
      },
    );
    const response = await modelPage?.evaluate(async (tabId) => {
      const api = (
        globalThis as unknown as {
          chrome: {
            runtime: {
              sendMessage(message: unknown): Promise<unknown>;
            };
          };
        }
      ).chrome;
      return api.runtime.sendMessage({ type: "openSidePanel", tabId });
    }, activeTabId);

    expect(response).toEqual({ opened: true, fallback: "tab" });
    await expect
      .poll(
        () =>
          context
            .pages()
            .some((candidate) =>
              candidate.url().includes("/src/ui/sidepanel/index.html"),
            ),
        { timeout: 5_000 },
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
