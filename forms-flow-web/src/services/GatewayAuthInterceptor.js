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

export function installGatewayAuthInterceptor({ gatewayBaseUrl, getToken, target }) {
  const t = target || (typeof window !== "undefined" ? window : undefined);
  if (!t) return;
  const base = normalizeBaseUrl(gatewayBaseUrl);
  if (!base) return;

  wrapFetch(t, base, getToken);
}

function wrapFetch(target, base, getToken) {
  const originalFetch = target.fetch;
  if (!originalFetch) return;
  if (originalFetch.__gatewayAuthInstalled) return;

  const wrapped = new Proxy(originalFetch, {
    apply(fn, _thisArg, [input, init]) {
      const isRequest = typeof Request !== "undefined" && input instanceof Request;
      const url =
        typeof input === "string" ? input : (input && input.url) || "";
      const locationHref = target.location && target.location.href;

      if (!_matchesGateway(url, base, locationHref)) {
        return fn.call(target, input, init);
      }

      const token = getToken && getToken();
      if (!token) {
        return fn.call(target, input, init);
      }

      if (isRequest) {
        if (input.headers.has("Authorization")) {
          return fn.call(target, input, init);
        }
        const newHeaders = new Headers(input.headers);
        newHeaders.set("Authorization", `Bearer ${token}`);
        const newReq = new Request(input, { headers: newHeaders });
        return fn.call(target, newReq, init);
      }

      const mergedInit = init ? { ...init } : {};
      const headers = new Headers(mergedInit.headers || {});
      if (!headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      mergedInit.headers = headers;
      return fn.call(target, input, mergedInit);
    },
  });

  wrapped.__gatewayAuthInstalled = true;
  target.fetch = wrapped;
}
