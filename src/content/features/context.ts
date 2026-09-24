import type { Config, ReadingMode, Rule } from "../../shared/types";

/** Dependencies shared by page interaction features. */
export interface FeatureContext {
  config: Config;
  rule: Rule;
  translateText(text: string, from: string, to: string): Promise<string>;
  translateParagraph(container: Element): Promise<void>;
  setReadingMode?(mode: ReadingMode): void;
  toggleTranslate(scope?: "main" | "whole"): void;
  isTranslated(): boolean;
}
