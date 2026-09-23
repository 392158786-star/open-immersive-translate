# 网站翻译 Demo 能力覆盖

本文档说明 `src/web-demo/` 相对于浏览器扩展全部翻译能力的覆盖情况。

## 复用模块（直接 import，零拷贝）

| 扩展模块 | Demo 用途 | 浏览器 API 依赖 |
|---------|----------|----------------|
| `shared/lang.ts` | 语言检测 | 无 |
| `shared/deduplicate.ts` | 译文去重 | 无 |
| `shared/types.ts` | 类型定义 | 无 |
| `shared/subtitle-types.ts` | 字幕类型 | 无 |
| `content/extract/scanner.ts` | DOM 正文抽取（`extractParagraphs`） | 仅 DOM |
| `content/extract/language.ts` | 页面语言检测（`detectPageLanguage`） | 无 |
| `content/extract/main-area.ts` | 主内容区域识别（`findMainContent`） | 仅 DOM |
| `content/extract/placeholder.ts` | 富文本占位符编解码（`encode`/`decode`） | 仅 DOM |
| `content/render/inject.ts` | 翻译渲染注入（`renderTranslation`/`setMode`/`removeAll`/`injectStyles`） | 仅 DOM |
| `content/observe/mutation.ts` | 动态内容监听（`observeMutations`） | 仅 `MutationObserver` |
| `content/academic/terms.ts` | 学术术语检测与保护 | 无 |
| `content/controller/translation-segments.ts` | 文本分段 | 无 |
| `content/features/subtitle/parsers.ts` | SRT/WebVTT 解析与序列化 | 仅 `DOMParser` |
| `background/services/cloud.ts` | 云端翻译服务（调用 /v1/translate） | 仅 fetch |
| `background/services/mock.ts` | 本地回退服务 | 无 |
| `background/services/base.ts` | 服务基类与错误体系 | 仅 fetch |

## 已覆盖能力

| 能力 | 覆盖方式 | 说明 |
|------|---------|------|
| **网页正文抽取与分段** | `scanPage()` → `extractParagraphs()` | 从真实 DOM 文章区扫描可翻译段落，复用扩展 scanner |
| **主内容区域识别** | `findMainContent()` | 自动识别 `<article>`/`<main>` 等语义标签 |
| **页面语言检测** | `detectPageLanguage()` | 复用扩展语言检测引擎，支持中英文自动识别 |
| **富文本占位符** | `encode()`/`decode()` | 保留内联元素（`<a>`/`<strong>` 等），翻译后还原 |
| **翻译渲染注入** | `renderTranslation()` | 将翻译结果注入 DOM，复用扩展渲染器 |
| **原文/双语/仅中文模式** | `switchMode()` → `setMode()`/`removeAll()` | 三种模式切换，复用扩展模式系统 |
| **动态内容监听** | `observeDynamicContent()` → `observeMutations()` | `MutationObserver` 监听新增段落，自动排除翻译注入节点 |
| **主题样式注入** | `injectPageStyles()` → `injectStyles()` | 复用扩展 22 种翻译主题 CSS |
| **逐段元数据展示** | `PageTranslationReport` | 每段显示 cacheLayer/latencyMs/serviceUsed/fallbackUsed/terms |
| **学术术语保护** | `detectAcademicTerms()`/`protectAcademicTerms()`/`restoreAcademicTerms()` | 翻译前保护术语，翻译后恢复 |
| 文本翻译 | `translateText()` | 通过 cloud 服务调用 cloud-demo `/v1/translate`，展示 cacheLayer/latencyMs |
| 缓存层展示 | API 响应 `cacheLayer` | 显示 redis/rds/upstream/disabled |
| 延迟展示 | API 响应 `latencyMs` | 毫秒级延迟 |
| 回退机制 | `translateText()` catch → `MockService` | 云端不可用时自动回退，显示 fallbackUsed |
| 健康检查 | `checkHealth()` → `GET /health` | RDS/Redis 探针状态 |
| 缓存统计 | `getStats()` → `GET /v1/stats` | Redis/RDS 命中数、上游调用数 |
| 语言检测 | `detectLanguage()` → `detectLang()` | 复用扩展语言检测引擎 |
| 文本分段 | `segmentText()` → `splitTranslationText()` | 按句切分 |
| 译文去重 | `deduplicateTranslation()` → `removeDuplicateTranslation()` | 去除重复译文 |
| 字幕解析 | `parseSubtitleContent()` → `parseSrt()`/`parseWebVtt()` | SRT/WebVTT 解析 |
| 字幕翻译 | `translateSubtitle()` | 批量翻译字幕条 |
| 字幕序列化 | `serializeSubtitle()` → `serializeSrt()`/`serializeWebVtt()` | 输出翻译后字幕 |
| 服务工厂 | `createCloudService()`/`createFallbackService()` | 验证现有服务可在网页环境实例化 |

## 未直接覆盖（需扩展环境）

| 能力 | 原因 | 适配说明 |
|------|------|---------|
| 翻译控制器 | `TranslationController` 依赖 `browser.runtime.connect` Port 通信 | Demo 绕过 Port 层，直接调用 `extractParagraphs` + `renderTranslation` + `translateText` 自建管线 |
| 视口观察 | `observeViewport` 需要 `IntersectionObserver` + `requestIdleCallback` | 模块为纯 DOM，可注入目标页面使用；Demo 用 `observeMutations` 覆盖动态内容 |
| 悬浮球/悬停/划词/输入框翻译 | 依赖 `browser.storage`/`browser.runtime` | 需扩展环境，Demo 不覆盖 |
| 知识卡 | 依赖 `browser.runtime.sendMessage` 调用 background | 需扩展环境；术语检测/保护已覆盖 |
| PDF 翻译 | 依赖 `browser.runtime.getURL`/`browser.tabs` + pdfjs-dist | 需扩展环境，独立页面；扩展 `config.pdf` 配置保留 |
| 视频内字幕实时捕获 | 依赖 `browser.runtime.getURL` 拦截器注入 main world | 字幕文件翻译已覆盖；实时捕获需扩展环境 |
| 侧边栏对话与 AI 写作 | 依赖 `browser.runtime.onMessage` + `createAssistantClient` | 需扩展环境；扩展 `config.sidePanel`/`config.aiWriting` 配置保留 |
| 本地模型 | 依赖 offscreen document + `browser.runtime` | 需扩展环境；扩展 `config.services.local` 配置保留 |
| ChatGPT OAuth | 依赖 `browser.storage`/`browser.alarms` | 需扩展环境 |
| 远程规则 | 依赖 `browser.storage`/`browser.alarms` | 需扩展环境 |
| URL 变化监听 | `onUrlChange` patch `history.pushState` | SPA 导航场景，Demo 为单页不覆盖 |
| 帧同步 | `createFrameSync` 依赖 `window.postMessage` | 跨 iframe 通信，Demo 为单页不覆盖 |

## 构建与运行

```bash
# 构建网站 Demo
vite build --config vite.web-demo.config.ts

# 输出目录
dist-web-demo/
```

## 测试覆盖

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/web-demo/translator.test.ts` | translateText（cloud/fallback/401/空输入）、detectLanguage、detectTerms、segmentText、deduplicateTranslation、subtitle parsing、service factories |
| `tests/web-demo/page-translator.test.ts` | scanPage（DOM 抽取/语言检测）、translatePage（cloud/fallback/original/metadata/terms）、switchMode、observeDynamicContent、clearPageTranslations、isParagraphTranslated、injectPageStyles |

## 设计原则

1. **零拷贝**：所有翻译逻辑通过 import 复用，不重写核心模块
2. **不破坏扩展**：新增文件独立于扩展构建入口，不修改现有 vite.config.ts
3. **优雅降级**：云端不可用时自动回退 MockService，不中断翻译
4. **元数据透传**：直接 fetch `/v1/translate` 获取 cacheLayer/latencyMs 用于展示
5. **DOM 原生**：网页翻译流程完全复用扩展的 `extractParagraphs` + `renderTranslation` + `observeMutations`，不使用替代算法
