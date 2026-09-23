import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scanPage,
  translatePage,
  switchMode,
  observeDynamicContent,
  clearPageTranslations,
  isParagraphTranslated,
  createDefaultRule,
  injectPageStyles,
} from "../../src/web-demo/page-translator";
import type { CloudDemoConfig } from "../../src/web-demo/translator";

const config: CloudDemoConfig = {
  baseUrl: "http://localhost:8787",
  apiKey: "test-token",
};

function createArticleDocument(): Document {
  const doc = document.implementation.createHTMLDocument("Test Article");
  doc.body.innerHTML = `
    <article>
      <h1>Artificial Intelligence and Translation</h1>
      <p>Artificial intelligence (AI) is transforming how we interact with technology. Large language models like GPT can translate text.</p>
      <p>The BRICS nations are exploring alternatives to SWIFT for cross-border payments. This shift could reshape the global financial landscape.</p>
      <h2>Challenges</h2>
      <p>Machine learning models require significant computational resources. The transformer architecture has become the dominant paradigm.</p>
    </article>
  `;
  return doc;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scanPage", () => {
  it("extracts paragraphs from article DOM", () => {
    const doc = createArticleDocument();
    const { mainArea, paragraphs, pageLanguage } = scanPage(doc);
    expect(mainArea).not.toBeNull();
    expect(paragraphs.length).toBeGreaterThan(0);
    expect(pageLanguage).toBe("en");
  });

  it("detects Chinese page language", () => {
    const doc = document.implementation.createHTMLDocument("中文文章");
    doc.body.innerHTML = `
      <article>
        <p>人工智能正在改变我们与技术交互的方式。大语言模型可以翻译文本、回答问题并编写代码。</p>
        <p>机器学习模型需要大量的计算资源进行训练。变换器架构已成为主导范式。</p>
      </article>
    `;
    const { pageLanguage } = scanPage(doc);
    expect(pageLanguage).toBe("zh-CN");
  });

  it("uses default rule when none provided", () => {
    const doc = createArticleDocument();
    const rule = createDefaultRule();
    expect(rule.matches).toEqual(["*"]);
    const { paragraphs } = scanPage(doc, rule);
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  it("handles element root", () => {
    const doc = createArticleDocument();
    const article = doc.querySelector("article")!;
    const { paragraphs } = scanPage(article);
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  it("samples the scoped article instead of the surrounding Chinese page", () => {
    const doc = document.implementation.createHTMLDocument("混合语言页面");
    doc.body.innerHTML = `
      <header><p>这是演示页面的中文界面说明文字，用于模拟宿主页面语言。</p></header>
      <div id="host">
        <article>
          <p>Artificial intelligence is transforming how we interact with technology and translate documents.</p>
          <p>Machine learning models require significant computational resources for training.</p>
        </article>
      </div>
    `;
    const host = doc.querySelector("#host")!;
    const { pageLanguage } = scanPage(host);
    expect(pageLanguage).toBe("en");
  });
});

describe("translatePage", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("translates all paragraphs with cloud metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "req-1",
            sourceText: "test",
            targetText: "测试",
            cacheLayer: "redis",
            latencyMs: 5,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const doc = createArticleDocument();
    const report = await translatePage(doc, "en", "zh-CN", config, "dual", "none");

    expect(report.paragraphCount).toBeGreaterThan(0);
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.pageLanguage).toBe("en");
    expect(report.cacheLayers).toContain("redis");
    expect(report.fallbackCount).toBe(0);
    expect(report.totalLatencyMs).toBeGreaterThan(0);
  });

  it("falls back to mock when cloud fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Connection refused")),
    );

    const doc = createArticleDocument();
    const report = await translatePage(doc, "en", "zh-CN", config, "dual", "none");

    expect(report.results.length).toBeGreaterThan(0);
    expect(report.fallbackCount).toBeGreaterThan(0);
    expect(report.results.every((r) => r.meta.fallbackUsed)).toBe(true);
    expect(report.results.every((r) => r.meta.serviceUsed === "mock")).toBe(true);
  });

  it("returns empty report for original mode", async () => {
    const doc = createArticleDocument();
    const report = await translatePage(doc, "en", "zh-CN", config, "original", "none");
    expect(report.paragraphCount).toBe(0);
    expect(report.results.length).toBe(0);
  });

  it("tracks per-paragraph metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "req-2",
            sourceText: "test",
            targetText: "测试",
            cacheLayer: "rds",
            latencyMs: 12,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const doc = createArticleDocument();
    const report = await translatePage(doc, "en", "zh-CN", config, "translation", "none");

    for (const result of report.results) {
      expect(result.meta.cacheLayer).toBe("rds");
      expect(result.meta.latencyMs).toBe(12);
      expect(result.meta.serviceUsed).toBe("cloud");
      expect(result.paragraphId).toBeTruthy();
      expect(result.sourceText).toBeTruthy();
    }
  });

  it("detects academic terms in paragraphs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            requestId: "req-3",
            sourceText: "test",
            targetText: "测试",
            cacheLayer: "redis",
            latencyMs: 3,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const doc = createArticleDocument();
    const report = await translatePage(doc, "en", "zh-CN", config, "dual", "none");

    const allTerms = report.results.flatMap((r) => r.terms);
    expect(allTerms.length).toBeGreaterThan(0);
  });
});

describe("switchMode", () => {
  it("clears translations for original mode", () => {
    const doc = createArticleDocument();
    document.body.innerHTML = doc.body.innerHTML;
    switchMode(document, "original");
    expect(document.querySelector("[data-imt]")).toBeNull();
  });

  it("switches between dual and translation modes", () => {
    const doc = createArticleDocument();
    document.body.innerHTML = doc.body.innerHTML;
    switchMode(document, "dual");
    switchMode(document, "translation");
    switchMode(document, "dual");
  });
});

describe("observeDynamicContent", () => {
  it("calls callback when DOM changes", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const callback = vi.fn();
    const dispose = observeDynamicContent(container, callback);

    const p = document.createElement("p");
    p.textContent = "New dynamic content";
    container.append(p);

    setTimeout(() => {
      expect(callback).toHaveBeenCalled();
      dispose();
    }, 300);
  });

  it("returns dispose function", () => {
    const container = document.createElement("div");
    const dispose = observeDynamicContent(container, () => {});
    expect(typeof dispose).toBe("function");
    dispose();
  });
});

describe("clearPageTranslations", () => {
  it("removes all translation markers", () => {
    const doc = createArticleDocument();
    document.body.innerHTML = doc.body.innerHTML;
    clearPageTranslations(document);
    expect(document.querySelector("[data-imt-id]")).toBeNull();
  });
});

describe("isParagraphTranslated", () => {
  it("returns false for unmarked element", () => {
    const el = document.createElement("p");
    expect(isParagraphTranslated(el)).toBe(false);
  });

  it("returns true for marked element", () => {
    const el = document.createElement("p");
    el.setAttribute("data-imt-id", "test-id");
    expect(isParagraphTranslated(el)).toBe(true);
  });
});

describe("injectPageStyles", () => {
  it("injects styles into document", () => {
    injectPageStyles(document);
    const style = document.querySelector("style[data-imt='style']");
    expect(style).not.toBeNull();
  });
});
