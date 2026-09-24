/** Deterministic identity helpers for the local learning store. */

/** Compute a deterministic SHA-256 hex digest. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Extract a normalized hostname from a URL, falling back to the raw value. */
export function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Normalize a word for identity comparison. */
export function normalizeWord(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

const TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu;

/** Remove navigation-only and campaign-only parts from an article URL. */
export function normalizeArticleUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** Deterministic article ID derived from the canonicalized URL. */
export function canonicalArticleId(
  url: string,
  title = "",
): Promise<string> {
  void title;
  return sha256Hex(`article|${normalizeArticleUrl(url)}`);
}

/** Deterministic normalized word key. */
export function normalizedWordKey(word: string): Promise<string> {
  return sha256Hex(normalizeWord(word));
}

/** Deterministic website ID derived from a URL hostname. */
export function websiteIdFromUrl(url: string): Promise<string> {
  return sha256Hex(`website|${hostnameFromUrl(url)}`);
}

/** Deterministic hash for a word's surrounding context. */
export function contextHash(context: {
  sentence: string;
  previousSentence: string;
  nextSentence: string;
  paragraphTheme: string;
}): Promise<string> {
  return sha256Hex(
    `${context.paragraphTheme}\n${context.previousSentence}\n${context.sentence}\n${context.nextSentence}`,
  );
}