import { afterEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.hoisted(() => vi.fn());

vi.mock("webextension-polyfill", () => ({
  default: {
    runtime: {
      sendMessage,
    },
  },
}));

import {
  detectAcademicTerms,
  protectAcademicTerms,
  restoreAcademicTerms,
} from "../../src/content/academic/terms";
import { init as initAcademicTerms } from "../../src/content/features/academic-terms";
import type { FeatureContext } from "../../src/content/features/context";
import type { Config, Rule } from "../../src/shared/types";

afterEach(() => {
  document.body.replaceChildren();
  sendMessage.mockReset();
});

describe("academic term protection", () => {
  it("detects technical phrases without common prose false positives", () => {
    expect(
      detectAcademicTerms(
        "The Transformer architecture uses an attention mechanism for an ontology.",
      ),
    ).toEqual([
      "Transformer architecture",
      "attention mechanism",
      "ontology",
    ]);
    expect(
      detectAcademicTerms("Researchers compare this approach with another model."),
    ).toEqual([]);
    expect(detectAcademicTerms("Saved research and RSS feed")).toEqual(["RSS"]);
    expect(detectAcademicTerms("JavaScript and HTML")).toEqual([
      "JavaScript",
      "HTML",
    ]);
    expect(
      detectAcademicTerms(
        "BRICS and the Global South are reshaping the digital economy.",
      ),
    ).toEqual(["BRICS", "Global South", "digital economy"]);
    expect(
      detectAcademicTerms(
        "The International Renewable Energy Agency works with the World Bank.",
      ),
    ).toEqual(["International Renewable Energy Agency", "World Bank"]);
    expect(detectAcademicTerms("HOME CHINA WORLD BUSINESS")).toEqual([]);
    expect(detectAcademicTerms("DOWNLOAD APP")).toEqual([]);
    expect(
      detectAcademicTerms(
        "LogicFolding uses the τ scaling law, Kirin measurements, 3D integration, hybrid bonding, and fiber neural networks.",
      ),
    ).toEqual([
      "LogicFolding",
      "τ scaling law",
      "Kirin",
      "3D integration",
      "hybrid bonding",
      "fiber neural networks",
    ]);
  });

  it("protects terms and restores their original casing", () => {
    const protectedText = protectAcademicTerms(
      "The Transformer architecture supports an ontology.",
    );
    expect(protectedText.text).not.toContain("Transformer architecture");
    expect(protectedText.text).not.toContain("ontology");
    expect(
      restoreAcademicTerms(protectedText.text, protectedText.terms),
    ).toBe("The Transformer architecture supports an ontology.");
    expect(
      restoreAcademicTerms(
        "The __9001__ supports an __9002__.",
        ["Transformer architecture", "ontology"],
      ),
    ).toBe("The Transformer architecture supports an ontology.");
    expect(
      restoreAcademicTerms(
        "The 9001 supports an _9002_.",
        ["Transformer architecture", "ontology"],
      ),
    ).toBe("The Transformer architecture supports an ontology.");
  });

  it("creates an inline knowledge term when remote resolution is unavailable", async () => {
    sendMessage.mockResolvedValue(undefined);
    document.body.innerHTML =
      '<font data-imt="target" data-imt-academic-terms=\'["BRICS"]\'>BRICS paves the way.</font>';
    const context = {
      config: {
        academic: {
          enabled: true,
          showInlineTranslation: true,
          service: undefined,
        },
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
      } as Config,
      rule: {} as Rule,
      translateText: vi.fn(async () => "金砖国家"),
      translateParagraph: vi.fn(async () => undefined),
      toggleTranslate: vi.fn(),
      isTranslated: vi.fn(() => true),
    } satisfies FeatureContext;
    const dispose = initAcademicTerms(context);

    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-imt="academic-term"]')?.textContent,
      ).toBe("BRICS");
      expect(
        document.querySelector('[data-imt="academic-meaning"]')?.textContent,
      ).toContain("金砖国家");
    });
    expect(document.querySelector("font")?.textContent).toBe(
      "BRICS（金砖国家） paves the way.",
    );
    dispose();
  });

  it("creates immediate knowledge cards for chip-domain terms", async () => {
    sendMessage.mockResolvedValue(undefined);
    document.body.innerHTML =
      '<font data-imt="target" data-imt-academic-terms=\'["τ scaling law","Kirin"]\'>τ scaling law and Kirin.</font>';
    const context = {
      config: {
        academic: {
          enabled: true,
          showInlineTranslation: true,
          service: undefined,
        },
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
      } as Config,
      rule: {} as Rule,
      translateText: vi.fn(async (text: string) =>
        text === "Kirin" ? "\u9e92\u9e9f\u82af\u7247" : "\u03c4 \u6807\u5ea6\u5b9a\u5f8b",
      ),
      translateParagraph: vi.fn(async () => undefined),
      toggleTranslate: vi.fn(),
      isTranslated: vi.fn(() => true),
    } satisfies FeatureContext;
    const dispose = initAcademicTerms(context);

    await vi.waitFor(() => {
      expect(
        document.querySelectorAll('[data-imt="academic-term"]'),
      ).toHaveLength(2);
    });
    expect(document.querySelector("font")?.textContent).toContain(
      "\u03c4 \u6807\u5ea6\u5b9a\u5f8b",
    );
    expect(document.querySelector("font")?.textContent).toContain(
      "\u9e92\u9e9f\u82af\u7247",
    );
    dispose();
  });
});
