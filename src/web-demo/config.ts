const DEFAULT_API_BASE = "http://localhost:8787";

export function resolveApiBaseUrl(
  urlParam?: string | null,
  buildVar?: string | null,
): string {
  if (urlParam && urlParam.trim()) {
    try {
      new URL(urlParam.trim());
      return urlParam.trim();
    } catch {
      // fall through to next priority
    }
  }
  if (buildVar && buildVar.trim()) {
    try {
      new URL(buildVar.trim());
      return buildVar.trim();
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_API_BASE;
}

export function readApiBaseUrlFromLocation(
  search: string,
  buildVar?: string | null,
): string {
  const params = new URLSearchParams(search);
  return resolveApiBaseUrl(params.get("api"), buildVar);
}

export const DEFAULT_CLOUD_API_BASE = DEFAULT_API_BASE;