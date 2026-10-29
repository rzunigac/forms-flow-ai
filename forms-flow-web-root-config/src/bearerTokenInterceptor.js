// Adds the user's Keycloak access token (Authorization: Bearer) to fetch and XMLHttpRequest calls whose origin
// matches a configured pattern, e.g. a file storage gateway: form.io's "url" storage provider sends DELETE
// without any credentials. Requests that already carry an Authorization header are left alone.

// "https://a.example.com, https://*.b.example.com" -> ["https://a.example.com", "https://*.b.example.com"]
export function parseUrlList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (raw === undefined || raw === null) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function defaultPortFor(scheme) {
  return scheme === "https:" ? "443" : "80";
}

function normalizeHost(host) {
  if (typeof host !== "string") return "";
  return host.toLowerCase().replace(/\.$/, "");
}

export function _parsePattern(raw) {
  if (typeof raw !== "string") return { valid: false, reason: "not a string" };
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, reason: "empty" };

  const m = /^(https?):\/\/(.+)$/i.exec(trimmed);
  if (!m) return { valid: false, reason: "scheme must be http:// or https://" };

  const scheme = m[1].toLowerCase() + ":";
  let rest = m[2];

  // Strip path/query/hash — origin-only matching
  const delimIdx = rest.search(/[/?#]/);
  if (delimIdx !== -1) rest = rest.slice(0, delimIdx);

  // Split host:port (handle IPv6 bracketed hosts too)
  let host, port;
  if (rest.startsWith("[")) {
    const closeIdx = rest.indexOf("]");
    if (closeIdx === -1) return { valid: false, reason: "unterminated IPv6 bracket" };
    host = rest.slice(0, closeIdx + 1);
    const remainder = rest.slice(closeIdx + 1);
    if (!remainder) {
      port = defaultPortFor(scheme);
    } else if (remainder.startsWith(":") && /^\d+$/.test(remainder.slice(1))) {
      port = remainder.slice(1);
    } else {
      return { valid: false, reason: "invalid characters after IPv6 host" };
    }
  } else {
    const colonIdx = rest.lastIndexOf(":");
    if (colonIdx !== -1 && /^\d+$/.test(rest.slice(colonIdx + 1))) {
      host = rest.slice(0, colonIdx);
      port = rest.slice(colonIdx + 1);
    } else {
      host = rest;
      port = defaultPortFor(scheme);
    }
  }

  host = normalizeHost(host);
  if (!host) return { valid: false, reason: "empty host" };

  // Wildcard handling — leftmost-label only. normalizeHost has already stripped any trailing dot.
  if (host.startsWith("*.")) {
    const suffix = host.slice(2);
    if (suffix.indexOf("*") !== -1) return { valid: false, reason: "only one leftmost-label wildcard allowed" };
    const labels = suffix.split(".");
    if (labels.length < 2) return { valid: false, reason: "wildcard suffix must have at least 2 labels" };
    if (labels.some((l) => !l)) return { valid: false, reason: "empty label in wildcard suffix" };
    return { valid: true, scheme, port, suffix, wildcard: true };
  }

  if (host.indexOf("*") !== -1) return { valid: false, reason: "wildcard only allowed as leftmost label (e.g. *.example.com)" };

  return { valid: true, scheme, port, host, wildcard: false };
}

function _parsedOriginOf(requestUrl, locationHref) {
  let url;
  try {
    url = new URL(requestUrl, locationHref || (typeof window !== "undefined" ? window.location.href : undefined));
  } catch (_e) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = normalizeHost(url.hostname);
  if (!host || host.startsWith(".")) return null;
  const port = url.port || defaultPortFor(url.protocol);
  return { scheme: url.protocol, host, port };
}

function _matchesPattern(origin, pattern) {
  if (!origin) return false;
  if (origin.scheme !== pattern.scheme) return false;
  if (origin.port !== pattern.port) return false;
  if (pattern.wildcard) {
    return origin.host.endsWith("." + pattern.suffix);
  }
  return origin.host === pattern.host;
}

function _matchesAnyParsed(requestUrl, parsedPatterns, locationHref) {
  if (!Array.isArray(parsedPatterns) || parsedPatterns.length === 0) return false;
  const origin = _parsedOriginOf(requestUrl, locationHref);
  if (!origin) return false;
  for (const parsed of parsedPatterns) {
    if (_matchesPattern(origin, parsed)) return true;
  }
  return false;
}

export function _matchesAny(requestUrl, rawPatterns, locationHref) {
  if (!Array.isArray(rawPatterns) || rawPatterns.length === 0) return false;
  const parsed = [];
  for (const raw of rawPatterns) {
    const p = _parsePattern(raw);
    if (p.valid) parsed.push(p);
  }
  return _matchesAnyParsed(requestUrl, parsed, locationHref);
}

export function installBearerTokenInterceptor({ urlPatterns, getToken, target }) {
  const t = target || (typeof window !== "undefined" ? window : undefined);
  if (!t) return;

  const rawPatterns = Array.isArray(urlPatterns) ? urlPatterns.filter(Boolean) : [];
  if (rawPatterns.length === 0) return;

  const parsedPatterns = [];
  const validRaws = [];
  for (const raw of rawPatterns) {
    const parsed = _parsePattern(raw);
    if (parsed.valid) {
      parsedPatterns.push(parsed);
      validRaws.push(raw);
    } else {
      console.warn(`[BearerTokenInterceptor] invalid pattern "${raw}" ignored: ${parsed.reason}`);
    }
  }

  if (parsedPatterns.length === 0) {
    console.warn("[BearerTokenInterceptor] no valid patterns — not installing");
    return;
  }

  wrapFetch(t, parsedPatterns, getToken);
  wrapXhr(t, parsedPatterns, getToken);
  console.log("[BearerTokenInterceptor] installed for patterns:", validRaws);
}

function wrapFetch(target, patterns, getToken) {
  const originalFetch = target.fetch;
  if (!originalFetch) return;
  if (originalFetch.__bearerTokenAuthInstalled) return;

  const wrapped = new Proxy(originalFetch, {
    apply(fn, _thisArg, [input, init]) {
      const isRequest = typeof Request !== "undefined" && input instanceof Request;
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const locationHref = target.location && target.location.href;

      if (!_matchesAnyParsed(url, patterns, locationHref)) {
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

  wrapped.__bearerTokenAuthInstalled = true;
  target.fetch = wrapped;
}

function wrapXhr(target, patterns, getToken) {
  const XHR = target.XMLHttpRequest;
  if (!XHR || !XHR.prototype) return;
  const proto = XHR.prototype;
  if (proto.send && proto.send.__bearerTokenAuthInstalled) return;

  const originalOpen = proto.open;
  const originalSetRequestHeader = proto.setRequestHeader;
  const originalSend = proto.send;

  proto.open = function (method, url, ...rest) {
    this.__bearerTokenAuthUrl = url;
    this.__bearerTokenAuthHasAuthHeader = false;
    return originalOpen.call(this, method, url, ...rest);
  };

  proto.setRequestHeader = function (name, value) {
    if (typeof name === "string" && name.toLowerCase() === "authorization") {
      this.__bearerTokenAuthHasAuthHeader = true;
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  proto.send = function (body) {
    const url = this.__bearerTokenAuthUrl || "";
    const locationHref = target.location && target.location.href;
    if (_matchesAnyParsed(url, patterns, locationHref) && !this.__bearerTokenAuthHasAuthHeader) {
      const token = getToken && getToken();
      if (token) {
        originalSetRequestHeader.call(this, "Authorization", `Bearer ${token}`);
      }
    }
    return originalSend.call(this, body);
  };

  proto.send.__bearerTokenAuthInstalled = true;
}
