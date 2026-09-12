import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "双语翻译助手",
  description: "无需配置，打开网页即可进行段落级中英双语翻译。",
  version: "0.3.3",
  permissions: [
    "storage",
    "unlimitedStorage",
    "offscreen",
    "alarms",
    "activeTab",
    "contextMenus",
    "scripting",
    "tabs",
    "webNavigation",
    "webRequest",
    "sidePanel",
  ],
  host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/background/worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["src/pdf/index.html", "assets/pdf.worker.min-*.mjs"],
      matches: ["<all_urls>"],
    },
  ],
  commands: {
    toggleTranslatePage: {
      suggested_key: { default: "Alt+A" },
      description: "Toggle page translation",
    },
    toggleTranslateTheWholePage: {
      suggested_key: { default: "Alt+W" },
      description: "Toggle whole-page translation",
    },
    toggleTranslateTheMainPage: {
      suggested_key: { default: "Alt+M" },
      description: "Toggle main-area translation",
    },
    toggleOnlyTranslation: {
      suggested_key: { default: "Alt+T" },
      description: "Toggle translation-only mode",
    },
    toggleTranslateToThePageEndImmediately: {
      description: "Translate immediately to page end",
    },
    toggleTranslationMask: { description: "Toggle translation mask" },
    toggleMouseHoverTranslateDirectly: {
      description: "Toggle direct hover translation",
    },
    toggleVideoSubtitlePreTranslation: {
      description: "Toggle video subtitle pre-translation",
    },
    translateWithGoogle: { description: "Translate with Google" },
    translateWithBing: { description: "Translate with Bing" },
    translateWithDeepL: { description: "Translate with DeepL" },
    translateWithOpenAI: { description: "Translate with OpenAI" },
    translateWithClaude: { description: "Translate with Claude" },
    translateWithGemini: { description: "Translate with Gemini" },
    translateWithCustom1: { description: "Translate with Custom 1" },
    translateWithCustom2: { description: "Translate with Custom 2" },
    translateWithCustom3: { description: "Translate with Custom 3" },
    translateInputBox: {
      description: "Translate the active input",
    },
    toggleSidePanel: {
      description: "Open the translation side panel",
    },
    openAiWritingModal: { description: "Open AI writing" },
  },
  side_panel: {
    default_path: "src/ui/sidepanel/index.html",
  },
  options_page: "options.html",
  action: {
    default_popup: "popup.html",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
  },
});
