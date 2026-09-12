/** Keep local decoding bounded while leaving enough room for longer prose. */
export function translationTokenLimit(texts: readonly string[]): number {
  const longest = texts.reduce(
    (maximum, text) => Math.max(maximum, text.trim().length),
    0,
  );
  return Math.min(256, Math.max(64, Math.ceil(longest * 1.8)));
}
