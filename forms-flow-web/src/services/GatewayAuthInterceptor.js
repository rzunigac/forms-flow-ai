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
  wrapXhr(t, base, getToken);
  console.log("[GatewayAuthInterceptor] installed for base:", base);
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

function wrapXhr(target, base, getToken) {
  const XHR = target.XMLHttpRequest;
  if (!XHR || !XHR.prototype) return;
  const proto = XHR.prototype;
  if (proto.send && proto.send.__gatewayAuthInstalled) return;

  const originalOpen = proto.open;
  const originalSetRequestHeader = proto.setRequestHeader;
  const originalSend = proto.send;

  proto.open = function (method, url, ...rest) {
    this.__gatewayAuthUrl = url;
    this.__gatewayAuthHasAuthHeader = false;
    return originalOpen.call(this, method, url, ...rest);
  };

  proto.setRequestHeader = function (name, value) {
    if (typeof name === "string" && name.toLowerCase() === "authorization") {
      this.__gatewayAuthHasAuthHeader = true;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  proto.send = function (body) {
    const url = this.__gatewayAuthUrl || "";
    const locationHref = target.location && target.location.href;
    if (_matchesGateway(url, base, locationHref) && !this.__gatewayAuthHasAuthHeader) {
      const token = getToken && getToken();
      if (token) {
        originalSetRequestHeader.call(this, "Authorization", `Bearer ${token}`);
      }
    }
    return originalSend.call(this, body);
  };

  proto.send.__gatewayAuthInstalled = true;
}
