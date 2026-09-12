import { describe, expect, it } from "vitest";

import {
  splitTranslationSentences,
  splitTranslationText,
} from "../../src/content/controller/translation-segments";

describe("splitTranslationText", () => {
  it("keeps short paragraphs unchanged", () => {
    expect(splitTranslationText("Short source sentence.")).toEqual([
      "Short source sentence.",
    ]);
  });

  it("splits long paragraphs at sentence boundaries", () => {
    const first = "A".repeat(220) + ".";
    const second = "B".repeat(220) + ".";
    const third = "C".repeat(220) + ".";
    const parts = splitTranslationText(`${first} ${second} ${third}`, 480);

    expect(parts).toEqual([`${first} ${second}`, third]);
  });

  it("splits an oversized sentence at a clause boundary", () => {
    const text = `${"A".repeat(260)},${"B".repeat(260)},${"C".repeat(40)}.`;
    const parts = splitTranslationText(text, 480);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 480)).toBe(true);
  });

  it("keeps decimal points inside sentence-level translation units", () => {
    expect(
      splitTranslationSentences(
        "The score is 41.8 BLEU. A second sentence follows.",
      ),
    ).toEqual(["The score is 41.8 BLEU.", "A second sentence follows."]);
  });
});
