/* istanbul ignore file */

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") return "";
  return baseUrl.replace(/\/+$/, "");
}

export function _matchesGateway(requestUrl, baseUrl, locationHref) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return false;
  let absolute;
  try {
    absolute = new URL(requestUrl, locationHref || (typeof window !== "undefined" ? window.location.href : undefined)).href;
  } catch (_e) {
    return false;
  }
  return absolute === normalized || absolute.startsWith(normalized + "/") || absolute.startsWith(normalized + "?") || absolute.startsWith(normalized + "#");
}

export function installGatewayAuthInterceptor(_config) {
  // Full implementation follows in later tasks.
}
