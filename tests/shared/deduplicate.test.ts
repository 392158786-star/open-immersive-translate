import { describe, expect, it } from "vitest";

import {
  removeDuplicateTranslation,
  translationLooksGarbled,
} from "../../src/shared/deduplicate";

describe("shared duplicate translation cleanup", () => {
  it("removes short repeated target text", () => {
    expect(
      removeDuplicateTranslation(
        "A concise result is shown once.",
        "\u7b80\u6d01\u7ed3\u679c\u3002\u7b80\u6d01\u7ed3\u679c\u3002",
      ),
    ).toBe("\u7b80\u6d01\u7ed3\u679c\u3002");
    expect(
      removeDuplicateTranslation(
        "Repeated text.",
        "\u91cd\u590d\u91cd\u590d",
      ),
    ).toBe("\u91cd\u590d");
  });

  it("keeps repeated protected names and technical terms", () => {
    expect(
      removeDuplicateTranslation("BRICS BRICS", "BRICS BRICS", ["BRICS"]),
    ).toBe("BRICS BRICS");
    expect(
      removeDuplicateTranslation(
        "Stefan Liller Stefan Liller",
        "Stefan Liller Stefan Liller",
      ),
    ).toBe("Stefan Liller Stefan Liller");
  });

  it("removes source echo even when whitespace changed", () => {
    const source =
      "This sentence should not be repeated after the translated result.";
    expect(
      removeDuplicateTranslation(
        source,
        `${source.replace(/ /g, "  ")} \u8fd9\u662f\u8bd1\u6587\u3002`,
      ),
    ).toBe("\u8fd9\u662f\u8bd1\u6587\u3002");
  });

  it("removes unprotected English fragments from a Chinese translation", () => {
    expect(
      removeDuplicateTranslation(
        "MFGM technology was employed in this study.",
        "\u8fd9\u662f\u8bd1\u6587 MFGM technology was employed \u7ee7\u7eed\u4e2d\u6587\u3002",
        ["MFGM"],
      ),
    ).toBe("\u8fd9\u662f\u8bd1\u6587 MFGM \u7ee7\u7eed\u4e2d\u6587\u3002");
  });

  it("detects corrupted translation payloads", () => {
    expect(translationLooksGarbled("\u66ff\u6362\u7b26\ufffd\u6587\u672c")).toBe(
      true,
    );
    expect(translationLooksGarbled("1. ____________________")).toBe(true);
    expect(translationLooksGarbled("Loading [MathJax]/extensions/MathMenu.")).toBe(
      true,
    );
    expect(translationLooksGarbled("__9001__")).toBe(true);
    expect(translationLooksGarbled("\u6b63\u5e38\u4e2d\u6587\u8bd1\u6587\u3002"))
      .toBe(false);
  });

  it("repairs decimal points split by translation services", () => {
    expect(
      removeDuplicateTranslation(
        "The score is 28.4 BLEU.",
        "\u5f97\u5206\u662f 28. 4 BLEU\u3002",
      ),
    ).toBe("\u5f97\u5206\u662f 28.4 BLEU\u3002");
  });
});
