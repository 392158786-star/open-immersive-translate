import { describe, expect, it } from "vitest";

import { removeDuplicateTranslation } from "../../src/shared/deduplicate";

describe("removeDuplicateTranslation", () => {
  it("removes an echoed English source while keeping the Chinese translation", () => {
    const source =
      "BRICS paves the way and the Global South has its say";
    const translated =
      "BRICS paves the way and the Global South has its say BRICS（金砖国家）铺平道路，全球南方拥有发言权。";

    expect(
      removeDuplicateTranslation(source, translated, ["BRICS", "Global South"]),
    ).toBe("BRICS（金砖国家）铺平道路，全球南方拥有发言权。");
  });

  it("removes repeated Chinese sentence fragments", () => {
    expect(
      removeDuplicateTranslation(
        "A repeated translation will be cleaned.",
        "这是完整的译文。这是完整的译文。这是下一句。",
      ),
    ).toBe("这是完整的译文。 这是下一句。");
  });

  it("keeps protected technical terms and person names", () => {
    const source =
      "Stefan Liller discussed BRICS cooperation with global partners.";
    const translated =
      "Stefan Liller 谈到金砖国家（BRICS）与全球伙伴的合作。";

    expect(
      removeDuplicateTranslation(source, translated, ["BRICS"]),
    ).toBe("Stefan Liller 谈到金砖国家（BRICS）与全球伙伴的合作。");
  });
});
