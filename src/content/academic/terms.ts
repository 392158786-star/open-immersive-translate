const ACRONYM_RE = /\b[A-Z][A-Z0-9-]{1,11}\b/g;
const TERM_RE =
  /\b[A-Z][\p{L}-]*(?:\s+[A-Z]?[\p{L}-]+){0,3}\s+(?:analysis|algorithm|approach|architecture|assessment|classification|concept|framework|hypothesis|language|learning|mapping|mechanism|method|methodology|model|network|ontology|paradigm|phenomenon|principle|process|protocol|research|system|technology|theory|transformer|treatment|workflow)s?\b/gu;
const ORGANIZATION_RE =
  /\b(?:[A-Z][\p{L}-]+(?:\s+(?:and|of|the)\s+|\s+)){1,6}(?:[Aa]gency|[Aa]lliance|[Aa]ssociation|[Bb]ank|[Cc]ommission|[Cc]ommittee|[Cc]ouncil|[Ff]oundation|[Ff]orum|[Ff]und|[Gg]roup|[Ii]nitiative|[Ii]nstitute|[Nn]ations|[Nn]etwork|[Oo]rganization|[Pp]artnership|[Pp]rogram|[Pp]rogramme|[Uu]nion|[Uu]niversity)\b/gu;
const QUOTED_TERM_RE = /[“"]([A-Za-z][A-Za-z0-9 -]{3,60})[”"]/g;
const KNOWN_TERM_RE =
  /\b(?:3d integration|artificial intelligence|attention mechanisms?|belt and road initiative|climate change|digital economy|european union|fiber neural networks|generative ai|global south|green energy transition|hybrid bonding|international monetary fund|kirin|knowledge graph|large language model|logicfolding|low-power design|machine learning|deep learning|ontology|epistemology|hermeneutics|phenomenology|methodology|paradigm|algorithm|corpus|discourse|semantics|pragmatics|quantum computing|semiconductor supply chain|supply chain|system-technology co-optimization|transformer architecture|transformer|united nations|world bank|world trade organization|javascript|typescript|ecmascript|node\.js)\b/giu;
const GREEK_SYMBOL_TERM_RE = /τ\s+scaling\s+law/giu;
const COMMON_ACRONYMS = new Set([
  "AI",
  "ALL",
  "APP",
  "ASIA",
  "BUSINESS",
  "CHINA",
  "CPU",
  "CULTURE",
  "DOWNLOAD",
  "GPU",
  "HOME",
  "LOGIN",
  "MENU",
  "MOBILE",
  "MORE",
  "NEWS",
  "NEWSPAPER",
  "OPINION",
  "OUR",
  "REGIONAL",
  "SEARCH",
  "SIGNIN",
  "SKIP",
  "SPORTS",
  "TRAVEL",
  "VIDEO",
  "WORLD",
]);
const KNOWN_TERM_NAMES = new Set([
  "javascript",
  "typescript",
  "ecmascript",
  "node.js",
]);
const LEADING_ARTICLES = /^(?:The|A|An|This|These|Those)\s+/u;
const NON_TERM_WORDS = new Set([
  "compare",
  "compares",
  "define",
  "defines",
  "has",
  "have",
  "is",
  "make",
  "makes",
  "provide",
  "provides",
  "researchers",
  "saved",
  "show",
  "shows",
  "support",
  "supports",
  "take",
  "takes",
  "use",
  "uses",
]);

export interface ProtectedAcademicText {
  text: string;
  terms: string[];
}

function acceptedTerm(term: string, allowLowercase = false): boolean {
  const normalized = term.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 80) return false;
  if (COMMON_ACRONYMS.has(normalized.toUpperCase())) return false;
  if (KNOWN_TERM_NAMES.has(normalized.toLowerCase())) return true;
  if (!allowLowercase && /^[A-Z][a-z]+$/.test(normalized)) return false;
  if (
    normalized
      .toLowerCase()
      .split(/\s+/)
      .some((word) => NON_TERM_WORDS.has(word))
  ) {
    return false;
  }
  return (
    allowLowercase ||
    /[A-Z]/.test(normalized) ||
    normalized.includes("-")
  );
}

/** Conservative synchronous detector used before sending text to any translator. */
export function detectAcademicTerms(
  text: string,
  maxTerms = 8,
): string[] {
  const found = new Map<string, { term: string; offset: number }>();
  const consider = (
    candidate: string,
    offset: number,
    allowLowercase = false,
  ): void => {
    const normalized = candidate
      .trim()
      .replace(/\s+/g, " ")
      .replace(LEADING_ARTICLES, "");
    if (!acceptedTerm(normalized, allowLowercase)) return;
    const key = normalized.toLowerCase();
    if (!found.has(key)) found.set(key, { term: normalized, offset });
  };

  for (const match of text.matchAll(ACRONYM_RE)) {
    consider(match[0], match.index ?? 0);
  }
  for (const match of text.matchAll(TERM_RE)) {
    consider(match[0], match.index ?? 0);
  }
  for (const match of text.matchAll(ORGANIZATION_RE)) {
    consider(match[0], match.index ?? 0);
  }
  for (const match of text.matchAll(QUOTED_TERM_RE)) {
    consider(match[1] ?? "", match.index ?? 0);
  }
  for (const match of text.matchAll(KNOWN_TERM_RE)) {
    consider(match[0], match.index ?? 0, true);
  }
  for (const match of text.matchAll(GREEK_SYMBOL_TERM_RE)) {
    consider(match[0], match.index ?? 0, true);
  }

  return [...found.entries()]
    .sort((left, right) => left[1].offset - right[1].offset)
    .slice(0, maxTerms)
    .map(([, value]) => value.term);
}

function placeholder(index: number): string {
  return `__${9001 + index}__`;
}

/** Replace protected terms with stable tokens that ordinary translators should keep. */
export function protectAcademicTerms(
  text: string,
  maxTerms = 8,
): ProtectedAcademicText {
  const terms = detectAcademicTerms(text, maxTerms);
  let protectedText = text;
  terms.forEach((term, index) => {
    protectedText = protectedText
      .split(term)
      .join(placeholder(index));
  });
  return { text: protectedText, terms };
}

/** Restore protected English terms after the translator returns. */
export function restoreAcademicTerms(
  text: string,
  terms: readonly string[],
): string {
  return terms.reduce(
    (current, term, index) => {
      const marker = String(9001 + index);
      const token = `(?:(?:__|_)\\s*)?${marker}(?:\\s*(?:__|_))?`;
      return current.replace(
        new RegExp(token, "giu"),
        term,
      );
    },
    text,
  );
}
