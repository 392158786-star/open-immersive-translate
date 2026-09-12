import { describe, expect, it, vi } from "vitest";

vi.mock("webextension-polyfill", () => ({ default: {} }));

import {
  CONFIG_VERSION,
  DEFAULT_CONFIG,
  migrateConfig,
  serviceConfigSchema,
} from "../../src/shared/config";

describe("configuration migration", () => {
  it("uses the zero-config China-friendly translator by default", () => {
    expect(DEFAULT_CONFIG.service).toBe("youdao-free");
    expect(DEFAULT_CONFIG.targetLanguage).toBe("zh-CN");
    expect(DEFAULT_CONFIG.translationMode).toBe("translation");
    expect(DEFAULT_CONFIG.translateToPageEndImmediately).toBe(true);
    expect(DEFAULT_CONFIG.removeDuplicateTranslations).toBe(true);
    expect(DEFAULT_CONFIG.translationIntegrityMode).toBe(true);
    expect(DEFAULT_CONFIG.autoTranslationColor).toBe(true);
    expect(DEFAULT_CONFIG.translationColor).toBe("#000000");
    expect(DEFAULT_CONFIG.services["youdao-free"]).toMatchObject({
      kind: "youdao-free",
      enabled: true,
      fallbackService: "transmart",
    });
    expect(DEFAULT_CONFIG.services.transmart).toMatchObject({
      kind: "transmart",
      enabled: true,
      fallbackService: "local-model",
    });
    expect(DEFAULT_CONFIG.services.mymemory).toMatchObject({
      kind: "mymemory",
      enabled: false,
      fallbackService: "local-model",
    });
  });

  it("migrates the old local-first default to the fast service chain", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 3,
      service: "local-model",
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.service).toBe("youdao-free");
    expect(migrated.services["youdao-free"]?.fallbackService).toBe(
      "transmart",
    );
    expect(migrated.services.transmart?.fallbackService).toBe("local-model");
    expect(migrated.services.mymemory?.fallbackService).toBe("local-model");
    expect(migrated.services["local-model"]?.fallbackService).toBeUndefined();
  });

  it("migrates version 4 to the Transmart fallback chain", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 4,
      service: "youdao-free",
      services: {
        ...DEFAULT_CONFIG.services,
        "youdao-free": {
          kind: "youdao-free",
          enabled: true,
          fallbackService: "mymemory",
        },
        transmart: {
          kind: "transmart",
          enabled: false,
        },
      },
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.translationMode).toBe("translation");
    expect(migrated.services["youdao-free"]?.fallbackService).toBe(
      "transmart",
    );
    expect(migrated.services.transmart).toMatchObject({
      enabled: true,
      fallbackService: "local-model",
    });
  });

  it("switches version 5 profiles to in-place Chinese replacement", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 5,
      translationMode: "dual",
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.translationMode).toBe("translation");
  });

  it("moves version 6 profiles to the faster Youdao-first chain", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 6,
      service: "youdao-free",
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.service).toBe("youdao-free");
    expect(migrated.services.transmart?.fallbackService).toBe("local-model");
    expect(migrated.services["youdao-free"]?.fallbackService).toBe(
      "transmart",
    );
  });

  it("moves version 7 profiles to whole-page translation", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 7,
      translateToPageEndImmediately: false,
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.translateToPageEndImmediately).toBe(true);
  });

  it("moves version 8 profiles to black translation text", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 8,
      translationColor: undefined,
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.translationColor).toBe("#000000");
  });

  it("moves version 11 profiles to automatic background-aware text color", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 11,
      autoTranslationColor: false,
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.autoTranslationColor).toBe(true);
  });

  it("applies and validates ChatGPT reasoning defaults", () => {
    expect(serviceConfigSchema.parse({ kind: "chatgpt" })).toMatchObject({
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
    expect(() =>
      serviceConfigSchema.parse({
        kind: "chatgpt",
        reasoningEffort: "minimal",
      }),
    ).toThrow();
  });

  it("upgrades legacy phase-one UI fields without losing service settings", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 1,
      services: {
        google: { kind: "google", enabled: true },
        custom: {
          kind: "custom-http",
          enabled: true,
          baseUrl: "https://example.com/translate",
        },
      },
      shortcuts: {
        "toggle-translate": "Alt+Q",
        "toggle-whole-page": "Alt+E",
      },
      subtitle: {
        youtube: false,
        style: {
          mode: "translation",
          fontSize: 28,
          color: "#112233",
          background: "#010203",
          position: "top",
        },
      },
      pdf: { autoOpenOnline: true, translationMode: "translation" },
      globalCss: ".imt-target { color: red; }",
    });

    expect(migrated.version).toBe(CONFIG_VERSION);
    expect(migrated.services.custom).toMatchObject({
      kind: "custom-http",
      enabled: true,
    });
    expect(migrated.services.gemini).toEqual({
      kind: "gemini",
      enabled: false,
    });
    expect(migrated.services.chatgpt).toEqual({
      kind: "chatgpt",
      enabled: false,
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
    expect(migrated.shortcuts.toggleTranslatePage).toBe("Alt+Q");
    expect(migrated.subtitle).toMatchObject({
      youtube: false,
      mode: "translation-only",
      fontSize: 28,
      sourceColor: "#112233",
      translationColor: "#112233",
      backgroundColor: "#010203",
      position: "top",
    });
    expect(migrated.pdf).toMatchObject({
      interceptLinks: true,
      mode: "translation",
    });
    expect(migrated.globalCustomCss).toContain("color: red");
  });

  it("fills ChatGPT reasoning defaults when migrating an existing config", () => {
    const migrated = migrateConfig({
      ...DEFAULT_CONFIG,
      version: 2,
      services: {
        ...DEFAULT_CONFIG.services,
        chatgpt: { kind: "chatgpt", enabled: true, model: "gpt-5.5" },
      },
    });

    expect(migrated.services.chatgpt).toMatchObject({
      enabled: true,
      model: "gpt-5.5",
      reasoningEffort: "low",
      reasoningEffortAssistant: "medium",
    });
  });
});
