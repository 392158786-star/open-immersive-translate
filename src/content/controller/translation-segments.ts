const DEFAULT_MAX_SEGMENT_CHARS = 480;
const BOUNDARY_PUNCTUATION = ["\n", "。", "！", "？", "；", ";", ".", "!", "?"];
const SOFT_BOUNDARY_PUNCTUATION = ["，", ",", "：", ":"];

function splitLongUnit(
  text: string,
  maxChars: number,
): string[] {
  const segments: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    let boundary = -1;
    for (const punctuation of BOUNDARY_PUNCTUATION) {
      boundary = Math.max(
        boundary,
        remaining.lastIndexOf(punctuation, maxChars),
      );
    }
    if (boundary < Math.floor(maxChars * 0.55)) {
      for (const punctuation of SOFT_BOUNDARY_PUNCTUATION) {
        boundary = Math.max(
          boundary,
          remaining.lastIndexOf(punctuation, maxChars),
        );
      }
    }
    if (boundary < Math.floor(maxChars * 0.55)) {
      boundary = Math.max(boundary, remaining.lastIndexOf(" ", maxChars));
    }
    if (boundary < Math.floor(maxChars * 0.55)) boundary = maxChars - 1;

    const segment = remaining.slice(0, boundary + 1).trim();
    if (segment) segments.push(segment);
    remaining = remaining.slice(boundary + 1).trim();
  }
  if (remaining) segments.push(remaining);
  return segments;
}

/** Split one source paragraph at sentence boundaries before calling a translation API. */
export function splitTranslationText(
  text: string,
  maxChars = DEFAULT_MAX_SEGMENT_CHARS,
): string[] {
  const source = text.trim();
  if (!source) return [];
  if (source.length <= maxChars) return [source];

  const sentences =
    source.match(
      /[^.!?。！？；;\n]+(?:[.!?。！？；;\n]+["'”’)\]]*|$)/gu,
    ) ?? [source];
  const segments: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };

  for (const sentence of sentences) {
    const normalized = sentence.trim();
    if (!normalized) continue;
    if (normalized.length > maxChars) {
      flush();
      segments.push(...splitLongUnit(normalized, maxChars));
      continue;
    }
    if (current && current.length + normalized.length + 1 > maxChars) {
      flush();
    }
    current += `${current ? " " : ""}${normalized}`;
  }
  flush();
  return segments.length ? segments : [source];
}

/** Split source text into independently translated sentences for bilingual pairing. */
export function splitTranslationSentences(text: string): string[] {
  const source = text.trim();
  if (!source) return [];
  const decimalMarker = "\uE100";
  const protectedSource = source.replace(
    /(\d)\.(?=\d)/gu,
    `$1${decimalMarker}`,
  );
  const sentences =
    protectedSource.match(
      /[^.!?。！？；;\n]+(?:[.!?。！？；;\n]+["'\u2019\u201D)\]]*|$)/gu,
    ) ?? [protectedSource];
  return sentences
    .flatMap((sentence) =>
      splitTranslationText(sentence.split(decimalMarker).join(".").trim()),
    )
    .filter(Boolean);
}
