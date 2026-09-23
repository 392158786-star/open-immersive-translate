import { render, type ComponentChildren, type FunctionComponent } from "preact";
import { useState, useCallback, useRef, useEffect } from "preact/hooks";
import {
  translateText,
  detectLanguage,
  detectTerms,
  segmentText,
  deduplicateTranslation,
  translateSubtitle,
  checkHealth,
  getStats,
  createCloudService,
  createFallbackService,
  type CloudDemoConfig,
  type TranslationOutput,
  type HealthReport,
  type StatsReport,
} from "./translator";
import {
  translatePage,
  switchMode,
  observeDynamicContent,
  injectPageStyles,
  clearPageTranslations,
  scanPage,
  type PageTranslationMode,
  type PageTranslationReport,
} from "./page-translator";
import { readApiBaseUrlFromLocation } from "./config";
import type { LangCode } from "../shared/types";
import "./styles.css";

const LANGUAGES: { value: LangCode; label: string }[] = [
  { value: "auto", label: "自动检测" },
  { value: "en", label: "英语" },
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁体中文" },
  { value: "ja", label: "日语" },
  { value: "ko", label: "韩语" },
  { value: "fr", label: "法语" },
  { value: "de", label: "德语" },
  { value: "es", label: "西班牙语" },
];

const SAMPLE_ARTICLE = `<article id="demo-article">
<h1>Artificial Intelligence and the Future of Translation</h1>
<p>Artificial intelligence (AI) is transforming how we interact with technology across the globe. Large language models like GPT and Claude can translate text, answer questions, and write code with remarkable fluency.</p>
<p>The BRICS nations are exploring alternatives to SWIFT for cross-border payments. This shift could reshape the global financial landscape and reduce dependence on Western financial infrastructure.</p>
<p>Machine learning models require significant computational resources for training. The transformer architecture has become the dominant paradigm, enabling breakthroughs in natural language processing and computer vision.</p>
<h2>Challenges and Opportunities</h2>
<p>Despite these advances, challenges remain. Quantum computing promises to revolutionize cryptography and optimization, but practical implementations are still years away. The semiconductor supply chain continues to be a critical bottleneck.</p>
<p>Knowledge graphs offer a structured approach to representing information. Combined with large language models, they can provide more accurate and verifiable results than either technology alone.</p>
</article>`;

const SAMPLE_TEXT = `Artificial intelligence (AI) is transforming how we interact with technology.
Large language models like GPT and Claude can translate text, answer questions, and write code.
The BRICS nations are exploring alternatives to SWIFT for cross-border payments.
Machine learning models require significant computational resources for training.`;

interface SectionProps {
  title: string;
  children: ComponentChildren;
}

const Section: FunctionComponent<SectionProps> = ({ title, children }) => (
  <section class="demo-section">
    <h2>{title}</h2>
    {children}
  </section>
);

function App(): preact.JSX.Element {
  const [baseUrl, setBaseUrl] = useState(() =>
    readApiBaseUrlFromLocation(
      typeof window !== "undefined" ? window.location.search : "",
      import.meta.env.VITE_CLOUD_API_BASE ?? null,
    ),
  );
  const [apiKey, setApiKey] = useState("");
  const [fromLang, setFromLang] = useState<LangCode>("auto");
  const [toLang, setToLang] = useState<LangCode>("zh-CN");
  const [pageMode, setPageMode] = useState<PageTranslationMode>("original");
  const [pageReport, setPageReport] = useState<PageTranslationReport | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [sourceText, setSourceText] = useState(SAMPLE_TEXT);
  const [result, setResult] = useState<TranslationOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [stats, setStats] = useState<StatsReport | null>(null);
  const [detectedLang, setDetectedLang] = useState<string>("");
  const [termsResult, setTermsResult] = useState<{
    terms: string[];
    protectedText: string;
  } | null>(null);
  const [segments, setSegments] = useState<string[]>([]);
  const [subtitleInput, setSubtitleInput] = useState(
    "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n2\n00:00:05,000 --> 00:00:08,000\nGoodbye world\n",
  );
  const [subtitleResult, setSubtitleResult] = useState<string>("");
  const [dedupResult, setDedupResult] = useState<string>("");
  const [dynamicCount, setDynamicCount] = useState(0);

  const articleRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<(() => void) | null>(null);

  const config: CloudDemoConfig = { baseUrl, apiKey };

  useEffect(() => {
    if (articleRef.current) {
      articleRef.current.innerHTML = SAMPLE_ARTICLE;
    }
  }, []);

  useEffect(() => {
    if (articleRef.current) {
      observerRef.current = observeDynamicContent(articleRef.current, () => {
        setDynamicCount((c) => c + 1);
      });
    }
    return () => {
      observerRef.current?.();
    };
  }, []);

  const handleTranslatePage = useCallback(async () => {
    if (!articleRef.current) return;
    setPageLoading(true);
    try {
      const doc = document;
      injectPageStyles(doc);
      const translationMode = pageMode === "original" ? "dual" : pageMode;
      if (pageMode === "original") setPageMode("dual");
      const report = await translatePage(
        articleRef.current,
        fromLang,
        toLang,
        config,
        translationMode,
        "none",
      );
      setPageReport(report);
    } catch {
      setPageReport({
        pageLanguage: "auto",
        mainContentSelector: "",
        paragraphCount: 0,
        results: [],
        totalLatencyMs: 0,
        cacheLayers: [],
        fallbackCount: 0,
      });
    }
    setPageLoading(false);
  }, [fromLang, toLang, baseUrl, apiKey, pageMode]);

  const handleSwitchMode = useCallback((mode: PageTranslationMode) => {
    setPageMode(mode);
    if (articleRef.current) {
      switchMode(articleRef.current, mode);
    }
  }, []);

  const handleAddDynamic = useCallback(() => {
    if (!articleRef.current) return;
    const p = document.createElement("p");
    p.textContent = `Dynamic paragraph ${Date.now()}: The European Union is investing heavily in green energy transition and digital economy initiatives.`;
    articleRef.current.querySelector("article")?.append(p);
  }, []);

  const handleScanPage = useCallback(() => {
    if (!articleRef.current) return;
    const { mainArea, paragraphs, pageLanguage } = scanPage(articleRef.current);
    setPageReport({
      pageLanguage,
      mainContentSelector: mainArea?.tagName ?? "",
      paragraphCount: paragraphs.length,
      results: paragraphs.map((p) => ({
        paragraphId: p.id,
        sourceText: p.text,
        translatedText: "",
        meta: {
          requestId: "",
          cacheLayer: "none",
          latencyMs: 0,
          serviceUsed: "none",
          fallbackUsed: false,
        },
        terms: [],
      })),
      totalLatencyMs: 0,
      cacheLayers: [],
      fallbackCount: 0,
    });
  }, []);

  const handleTranslate = useCallback(async () => {
    setLoading(true);
    try {
      const output = await translateText(sourceText, fromLang, toLang, config);
      setResult(output);
    } catch (err) {
      setResult({
        text: "",
        meta: {
          requestId: "",
          cacheLayer: "error",
          latencyMs: 0,
          serviceUsed: "none",
          fallbackUsed: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    setLoading(false);
  }, [sourceText, fromLang, toLang, baseUrl, apiKey]);

  const handleHealth = useCallback(async () => {
    const report = await checkHealth(config);
    setHealth(report);
  }, [baseUrl, apiKey]);

  const handleStats = useCallback(async () => {
    const report = await getStats(config);
    setStats(report);
  }, [baseUrl, apiKey]);

  const handleDetect = useCallback(() => {
    setDetectedLang(detectLanguage(sourceText));
  }, [sourceText]);

  const handleTerms = useCallback(() => {
    const r = detectTerms(sourceText);
    setTermsResult(r);
  }, [sourceText]);

  const handleSegment = useCallback(() => {
    setSegments(segmentText(sourceText));
  }, [sourceText]);

  const handleDedup = useCallback(() => {
    if (result) {
      setDedupResult(
        deduplicateTranslation(sourceText, result.text, termsResult?.terms ?? []),
      );
    }
  }, [sourceText, result, termsResult]);

  const handleSubtitle = useCallback(async () => {
    const r = await translateSubtitle(subtitleInput, "srt", fromLang, toLang, config);
    setSubtitleResult(r.serialized);
  }, [subtitleInput, fromLang, toLang, baseUrl, apiKey]);

  const cloudService = createCloudService(config);
  const fallbackService = createFallbackService();

  return (
    <div class="demo-app">
      <header class="demo-header">
        <h1>网站翻译 Demo — 华为云融合</h1>
        <p>复用扩展翻译引擎，通过 cloud 服务调用 cloud-demo API，失败回退本地 Mock</p>
      </header>

      <Section title="云端配置">
        <div class="config-row">
          <label>API 地址</label>
          <input
            type="text"
            value={baseUrl}
            onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
          />
          <label>API Token</label>
          <input
            type="password"
            value={apiKey}
            onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
            placeholder="留空则不携带 Bearer"
          />
        </div>
        <div class="service-info">
          <span>CloudService: {cloudService.id} (maxBatch={cloudService.maxBatchSize})</span>
          <span>FallbackService: {fallbackService.id} (maxBatch={fallbackService.maxBatchSize})</span>
        </div>
      </Section>

      <Section title="网页文章翻译（DOM 正文抽取 + 渲染注入）">
        <div class="lang-row">
          <label>源语言</label>
          <select
            value={fromLang}
            onChange={(e) => setFromLang((e.target as HTMLSelectElement).value as LangCode)}
          >
            {LANGUAGES.map((l) => <option value={l.value}>{l.label}</option>)}
          </select>
          <label>目标语言</label>
          <select
            value={toLang}
            onChange={(e) => setToLang((e.target as HTMLSelectElement).value as LangCode)}
          >
            {LANGUAGES.filter((l) => l.value !== "auto").map((l) => (
              <option value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div class="mode-row">
          <button class={pageMode === "original" ? "active" : ""} onClick={() => handleSwitchMode("original")}>原文</button>
          <button class={pageMode === "dual" ? "active" : ""} onClick={() => handleSwitchMode("dual")}>双语</button>
          <button class={pageMode === "translation" ? "active" : ""} onClick={() => handleSwitchMode("translation")}>仅中文</button>
        </div>
        <div class="action-row">
          <button onClick={handleTranslatePage} disabled={pageLoading}>
            {pageLoading ? "翻译中…" : "翻译网页"}
          </button>
          <button onClick={handleScanPage}>扫描段落</button>
          <button onClick={handleAddDynamic}>新增动态段落</button>
          <button onClick={() => { clearPageTranslations(articleRef.current ?? document.body); setPageReport(null); }}>清除翻译</button>
        </div>
        <div ref={articleRef} class="article-container" />
        {dynamicCount > 0 && (
          <div class="info-box">MutationObserver 检测到 {dynamicCount} 次动态内容变化</div>
        )}
        {pageReport && (
          <div class="page-report">
            <div>页面语言: {pageReport.pageLanguage} | 主区域: {pageReport.mainContentSelector} | 段落数: {pageReport.paragraphCount}</div>
            <div>总延迟: {pageReport.totalLatencyMs}ms | 缓存层: {pageReport.cacheLayers.join(", ") || "无"} | 回退次数: {pageReport.fallbackCount}</div>
            {pageReport.results.length > 0 && (
              <div class="table-scroll">
                <table class="meta-table">
                  <thead>
                    <tr><th>#</th><th>源文本</th><th>缓存层</th><th>延迟</th><th>服务</th><th>回退</th><th>术语</th></tr>
                  </thead>
                  <tbody>
                    {pageReport.results.map((r, i) => (
                      <tr key={r.paragraphId}>
                        <td>{i + 1}</td>
                        <td class="src-cell">{r.sourceText.substring(0, 60)}{r.sourceText.length > 60 ? "…" : ""}</td>
                        <td>{r.meta.cacheLayer}</td>
                        <td>{r.meta.latencyMs}ms</td>
                        <td>{r.meta.serviceUsed}</td>
                        <td>{r.meta.fallbackUsed ? "是" : "否"}</td>
                        <td>{r.terms.length > 0 ? r.terms.join(", ") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="文本翻译（单段）">
        <textarea
          class="source-input"
          value={sourceText}
          onInput={(e) => setSourceText((e.target as HTMLTextAreaElement).value)}
          rows={4}
        />
        <button onClick={handleTranslate} disabled={loading}>
          {loading ? "翻译中…" : "翻译"}
        </button>
        {result && (
          <div class="result-box">
            <div class="result-text">{result.text || "（空）"}</div>
            <div class="result-meta">
              <span class="meta-pill" data-layer={result.meta.cacheLayer}>
                缓存层: {result.meta.cacheLayer}
              </span>
              <span class="meta-pill">延迟: {result.meta.latencyMs}ms</span>
              <span class="meta-pill">服务: {result.meta.serviceUsed}</span>
              <span class={`meta-pill ${result.meta.fallbackUsed ? "fallback" : ""}`}>
                回退: {result.meta.fallbackUsed ? "是" : "否"}
              </span>
              {result.meta.error && (
                <span class="meta-pill error">错误: {result.meta.error}</span>
              )}
            </div>
          </div>
        )}
      </Section>

      <Section title="缓存与健康状态">
        <div class="action-row">
          <button onClick={handleHealth}>检查健康</button>
          <button onClick={handleStats}>获取统计</button>
        </div>
        {health && (
          <div class="health-box">
            <div>状态: {health.status}</div>
            <div>API: {health.checks.api.status}</div>
            <div>RDS: {health.checks.rds.status} {health.checks.rds.latencyMs !== undefined ? `(${health.checks.rds.latencyMs}ms)` : ""}</div>
            <div>Redis: {health.checks.redis.status} {health.checks.redis.latencyMs !== undefined ? `(${health.checks.redis.latencyMs}ms)` : ""}</div>
            {health.checks.upstream && (
              <div>
                上游模型: {health.checks.upstream.status}
                {health.checks.upstream.detail ? ` — ${health.checks.upstream.detail}` : ""}
              </div>
            )}
          </div>
        )}
        {stats && (
          <div class="stats-box">
            <div>记忆条目: {stats.totalMemory}</div>
            <div>累计命中: {stats.totalHits}</div>
            <div>累计请求: {stats.totalRequests}</div>
            <div>Redis 命中: {stats.redisHits}</div>
            <div>RDS 命中: {stats.rdsHits}</div>
            <div>上游调用: {stats.upstreamRequests}</div>
          </div>
        )}
      </Section>

      <Section title="语言检测">
        <button onClick={handleDetect}>检测源文本语言</button>
        {detectedLang && <div class="info-box">检测到: {detectedLang}</div>}
      </Section>

      <Section title="学术术语保护">
        <button onClick={handleTerms}>检测术语</button>
        {termsResult && (
          <div class="terms-box">
            <div>检测到 {termsResult.terms.length} 个术语: {termsResult.terms.join(", ")}</div>
            <pre>{termsResult.protectedText}</pre>
          </div>
        )}
      </Section>

      <Section title="文本分段">
        <button onClick={handleSegment}>分段</button>
        {segments.length > 0 && (
          <div class="segments-box">
            {segments.map((s, i) => (
              <div class="segment-item">[{i}] {s}</div>
            ))}
          </div>
        )}
      </Section>

      <Section title="去重">
        <button onClick={handleDedup} disabled={!result}>去重翻译结果</button>
        {dedupResult && <div class="info-box">{dedupResult}</div>}
      </Section>

      <Section title="字幕翻译">
        <textarea
          class="subtitle-input"
          value={subtitleInput}
          onInput={(e) => setSubtitleInput((e.target as HTMLTextAreaElement).value)}
          rows={6}
        />
        <button onClick={handleSubtitle}>翻译字幕</button>
        {subtitleResult && <pre class="subtitle-result">{subtitleResult}</pre>}
      </Section>

      <footer class="demo-footer">
        <span>复用模块: content/extract/scanner, content/extract/language, content/extract/main-area, content/extract/placeholder, content/render/inject, content/observe/mutation, content/academic/terms, content/controller/translation-segments, content/features/subtitle/parsers, background/services/cloud, background/services/mock</span>
      </footer>
    </div>
  );
}

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
