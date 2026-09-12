const PLACEHOLDER_PREFIX = "\uE000";
const PLACEHOLDER_SUFFIX = "\uE001";

function normalize(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourcePattern(source: string): string {
  return source
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escapeRegExp)
    .join("\\s+");
}

function protectedPhrases(source: string, terms: readonly string[]): string[] {
  const properNames =
    source.match(
      /\b(?:[A-Z][a-z]{1,30})(?:\s+[A-Z][a-z]{1,30}){1,3}\b|\b[A-Z][A-Z0-9-]{1,15}\b/g,
    ) ?? [];
  return [...new Set([...terms, ...properNames].filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
}

function protectPhrases(
  text: string,
  phrases: readonly string[],
): { text: string; values: string[] } {
  let protectedText = text;
  const values: string[] = [];
  for (const phrase of phrases) {
    const pattern = new RegExp(escapeRegExp(phrase), "giu");
    protectedText = protectedText.replace(pattern, () => {
      const index = values.push(phrase) - 1;
      return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`;
    });
  }
  return { text: protectedText, values };
}

function restorePhrases(text: string, values: readonly string[]): string {
  return text.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "gu"),
    (_, index: string) => values[Number(index)] ?? "",
  );
}

function containsMeaningfulText(text: string): boolean {
  return (
    text
      .replace(
        new RegExp(`${PLACEHOLDER_PREFIX}\\d+${PLACEHOLDER_SUFFIX}`, "gu"),
        "",
      )
      .replace(/[\p{P}\p{S}\s]/gu, "").length > 0
  );
}

function removeSentenceDuplicates(text: string): string {
  const parts = text
    .split(/(?<=[。！？!?；;.])\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return text;
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = normalize(part).replace(/[\p{P}\s]+$/gu, "");
      if (key.length < 3) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

function removeRepeatedHalf(text: string): string {
  let current = text.trim();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const compact: string[] = [];
    const sourceIndexes: number[] = [];
    for (let index = 0; index < current.length; index += 1) {
      const character = current[index] ?? "";
      if (/\s/u.test(character)) continue;
      compact.push(character.toLocaleLowerCase());
      sourceIndexes.push(index);
    }
    if (compact.length < 4 || compact.length % 2 !== 0) break;

    const midpoint = compact.length / 2;
    if (
      compact.slice(0, midpoint).join("") !==
      compact.slice(midpoint).join("")
    ) {
      break;
    }
    if (!containsMeaningfulText(compact.join(""))) break;

    const cutoff = sourceIndexes[midpoint];
    if (cutoff === undefined) break;
    const next = current.slice(0, cutoff).trim();
    if (!next || next === current) break;
    current = next;
  }
  return current;
}

function removeUnprotectedLatinRuns(text: string): string {
  return text.replace(
    /[A-Za-z][A-Za-z0-9'’-]*(?:\s+[A-Za-z][A-Za-z0-9'’-]*)*/gu,
    (match) => {
      const letters = match.replace(/[^A-Za-z]/g, "");
      return letters.length >= 4 ? " " : match;
    },
  );
}

function removeRepeatedNumberedSection(text: string): string {
  const match = text.match(/^\s*(\d+[.、]\s*)/u);
  if (!match) return text;
  const marker = match[1] ?? "";
  const body = text.slice(match[0].length);
  const nextIndex = body.indexOf(marker);
  if (nextIndex < 8) return text;
  return `${marker}${body.slice(0, nextIndex).trim()}`;
}

function repairNumericSpacing(text: string): string {
  return text
    .replace(/(\d)\.\s+(?=\d)/gu, "$1.")
    .replace(/(\d)\s+\.\s*(?=\d)/gu, "$1.");
}

/** Remove echoed source text and repeated translation fragments while preserving protected terms. */
export function removeDuplicateTranslation(
  source: string,
  translation: string,
  terms: readonly string[] = [],
): string {
  const phrases = protectedPhrases(source, terms);
  const protectedSource = protectPhrases(source, phrases).text;
  const protectedTranslation = protectPhrases(translation, phrases);
  let result = protectedTranslation.text;
  const normalizedSource = normalize(protectedSource);
  const sourceLetters = protectedSource.match(/[A-Za-z]/g)?.length ?? 0;

  if (normalizedSource.length >= 18 || sourceLetters >= 12) {
    const pattern = sourcePattern(protectedSource);
    if (pattern) result = result.replace(new RegExp(pattern, "giu"), " ");
  }

  result = removeSentenceDuplicates(result);
  result = removeRepeatedHalf(result);
  result = removeSentenceDuplicates(result);
  result = removeRepeatedNumberedSection(result);
  if (/[\u3400-\u9FFF]/u.test(result)) {
    result = removeUnprotectedLatinRuns(result);
  }
  return repairNumericSpacing(
    restorePhrases(result, protectedTranslation.values),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Reject obviously corrupted translation payloads before they touch the page. */
export function translationLooksGarbled(
  text: string,
  options: { allowPlaceholders?: boolean } = {},
): boolean {
  if (!text) return true;
  const hasControlCharacter = [...text].some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31)
    );
  });
  return (
    hasControlCharacter ||
    text.includes("\uFFFD") ||
    /(?:锛|鈥|ï¿½|â€|Ã[\u0080-\u00BF]|Â[\u0080-\u00BF])/u.test(text) ||
    /(?:MathJax|Math Menu|数学菜单)/iu.test(text) ||
    /_{8,}/u.test(text) ||
    (!options.allowPlaceholders &&
      /\{\s*\d+\s*\}|__\s*\d+\s*__|#\s*\d+\s*#/u.test(text)) ||
    /(.)\1{29,}/u.test(text)
  );
}
