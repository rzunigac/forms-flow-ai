import { _matchesAny, _parsePattern, installBearerTokenInterceptor, parseUrlList } from "../bearerTokenInterceptor";

describe("GatewayAuthInterceptor — URL matching", () => {
  test("URL starting with the gateway base matches", () => {
    expect(_matchesAny("https://gw.example.com/files/abc", ["https://gw.example.com"])).toBe(true);
  });

  test("URL on a different host does not match", () => {
    expect(_matchesAny("https://other.example.com/files/abc", ["https://gw.example.com"])).toBe(false);
  });

  test("relative URL resolves against window.location and matches", () => {
    const loc = "https://gw.example.com/app/";
    expect(_matchesAny("files/abc", ["https://gw.example.com"], loc)).toBe(true);
  });

  test("empty baseUrl never matches", () => {
    expect(_matchesAny("https://gw.example.com/x", [""])).toBe(false);
  });
});

function makeFakeTarget() {
  return {
    fetch: jest.fn(() => Promise.resolve({ ok: true })),
    location: { href: "https://app.example.com/" },
    XMLHttpRequest: class FakeXHR {},
  };
}

describe("GatewayAuthInterceptor — fetch wrapping", () => {
  const BASE = "https://gw.example.com";

  test("adds Authorization header on gateway URL with token present", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch(`${BASE}/files/123`, { method: "DELETE" });

    expect(target.fetch).toHaveBeenCalledTimes(1);
    const [, init] = target.fetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tkn-abc");
  });

  test("passes through without header when URL is not a gateway URL", async () => {
    const target = makeFakeTarget();
    const originalFetch = target.fetch;
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch("https://other.example.com/x");

    const [, init] = originalFetch.mock.calls[0];
    const headers = new Headers((init && init.headers) || {});
    expect(headers.get("Authorization")).toBeNull();
  });

  test("omits Authorization header when getToken returns undefined", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => undefined,
      target,
    });

    await target.fetch(`${BASE}/files/123`);

    const [, init] = target.fetch.mock.calls[0];
    const headers = new Headers((init && init.headers) || {});
    expect(headers.get("Authorization")).toBeNull();
  });

  test("omits Authorization header when getToken returns empty string", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "",
      target,
    });

    await target.fetch(`${BASE}/files/123`);

    const [, init] = target.fetch.mock.calls[0];
    const headers = new Headers((init && init.headers) || {});
    expect(headers.get("Authorization")).toBeNull();
  });

  test("does not overwrite a pre-existing Authorization header", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch(`${BASE}/files/123`, {
      headers: { Authorization: "Bearer preset" },
    });

    const [, init] = target.fetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer preset");
  });
});

describe("GatewayAuthInterceptor — fetch with Request argument", () => {
  const BASE = "https://gw.example.com";

  test("adds Authorization when called with a Request to the gateway", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });

    const req = new Request(`${BASE}/files/123`, { method: "DELETE" });
    await target.fetch(req);

    expect(target.fetch).toHaveBeenCalledTimes(1);
    const [arg] = target.fetch.mock.calls[0];
    expect(arg).toBeInstanceOf(Request);
    expect(arg.headers.get("Authorization")).toBe("Bearer tkn-abc");
  });

  test("original Request object is not mutated", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });

    const req = new Request(`${BASE}/files/123`);
    const originalAuth = req.headers.get("Authorization");
    await target.fetch(req);

    expect(req.headers.get("Authorization")).toBe(originalAuth);
  });
});

describe("GatewayAuthInterceptor — XHR wrapping", () => {
  const BASE = "https://gw.example.com";

  function makeXhrTarget() {
    const sends = [];
    const headerCalls = [];
    class FakeXHR {
      constructor() {
        this._url = null;
        this._headers = {};
      }
      open(method, url) {
        this._method = method;
        this._url = url;
      }
      setRequestHeader(name, value) {
        this._headers[name] = value;
        headerCalls.push({ name, value, instance: this });
      }
      send(body) {
        sends.push({ instance: this, body });
      }
    }
    return {
      target: {
        fetch: jest.fn(() => Promise.resolve({})),
        location: { href: "https://app.example.com/" },
        XMLHttpRequest: FakeXHR,
      },
      FakeXHR,
      sends,
      headerCalls,
    };
  }

  test("adds Authorization header on XHR.send for gateway URL", () => {
    const ctx = makeXhrTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-xyz",
      target: ctx.target,
    });

    const xhr = new ctx.target.XMLHttpRequest();
    xhr.open("POST", `${BASE}/files`);
    xhr.send("body");

    const authCall = ctx.headerCalls.find((c) => c.name === "Authorization");
    expect(authCall).toBeDefined();
    expect(authCall.value).toBe("Bearer tkn-xyz");
    expect(ctx.sends).toHaveLength(1);
  });

  test("does not add Authorization header when URL is not a gateway URL", () => {
    const ctx = makeXhrTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-xyz",
      target: ctx.target,
    });

    const xhr = new ctx.target.XMLHttpRequest();
    xhr.open("GET", "https://other.example.com/x");
    xhr.send();

    const authCall = ctx.headerCalls.find((c) => c.name === "Authorization");
    expect(authCall).toBeUndefined();
  });

  test("does not add Authorization header when token is empty", () => {
    const ctx = makeXhrTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "",
      target: ctx.target,
    });

    const xhr = new ctx.target.XMLHttpRequest();
    xhr.open("POST", `${BASE}/files`);
    xhr.send();

    expect(ctx.headerCalls.find((c) => c.name === "Authorization")).toBeUndefined();
  });

  test("does not overwrite pre-set Authorization on XHR", () => {
    const ctx = makeXhrTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-xyz",
      target: ctx.target,
    });

    const xhr = new ctx.target.XMLHttpRequest();
    xhr.open("POST", `${BASE}/files`);
    xhr.setRequestHeader("Authorization", "Bearer preset");
    xhr.send();

    const authCalls = ctx.headerCalls.filter((c) => c.name === "Authorization");
    expect(authCalls).toHaveLength(1);
    expect(authCalls[0].value).toBe("Bearer preset");
  });
});

describe("GatewayAuthInterceptor — idempotency", () => {
  const BASE = "https://gw.example.com";

  test("calling install twice leaves fetch wrapped only once", async () => {
    const target = makeFakeTarget();
    const originalFetch = target.fetch;

    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });
    const afterFirst = target.fetch;

    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });
    const afterSecond = target.fetch;

    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond).not.toBe(originalFetch);

    await target.fetch(`${BASE}/files/1`);
    expect(originalFetch).toHaveBeenCalledTimes(1);
    const [, init] = originalFetch.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tkn-abc");
  });

  test("calling install twice leaves XHR.send wrapped only once", () => {
    const target = {
      fetch: jest.fn(() => Promise.resolve({})),
      location: { href: "https://app.example.com/" },
      XMLHttpRequest: class FakeXHR {
        constructor() { this._headers = {}; }
        open(m, u) { this._url = u; }
        setRequestHeader(n, v) { this._headers[n] = v; }
        send() { this._sent = true; }
      },
    };

    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });
    const sendAfterFirst = target.XMLHttpRequest.prototype.send;

    installBearerTokenInterceptor({
      urlPatterns: [BASE],
      getToken: () => "tkn-abc",
      target,
    });
    const sendAfterSecond = target.XMLHttpRequest.prototype.send;

    expect(sendAfterSecond).toBe(sendAfterFirst);
  });
});

describe("BearerTokenInterceptor — multi-URL support (startsWith matching, pre-origin)", () => {
  const BASE_A = "https://api-a.example.com";
  const BASE_B = "https://api-b.example.com";

  test("adds Authorization on fetch to the first configured URL", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE_A, BASE_B],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch(`${BASE_A}/x`);

    const [, init] = target.fetch.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tkn-abc");
  });

  test("adds Authorization on fetch to the second configured URL", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE_A, BASE_B],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch(`${BASE_B}/y`);

    const [, init] = target.fetch.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tkn-abc");
  });

  test("leaves a URL not in the list alone", async () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({
      urlPatterns: [BASE_A, BASE_B],
      getToken: () => "tkn-abc",
      target,
    });

    await target.fetch("https://other.example.com/z");

    const [, init] = target.fetch.mock.calls[0];
    expect(new Headers((init && init.headers) || {}).get("Authorization")).toBeNull();
  });

  test("empty urlPatterns array is a no-op: fetch not wrapped", async () => {
    const target = makeFakeTarget();
    const originalFetch = target.fetch;
    installBearerTokenInterceptor({
      urlPatterns: [],
      getToken: () => "tkn-abc",
      target,
    });
    expect(target.fetch).toBe(originalFetch);
  });
});

describe("BearerTokenInterceptor — strict origin matching", () => {
  test("exact origin matches", () => {
    expect(_matchesAny("https://api.example.com/x", ["https://api.example.com"])).toBe(true);
  });

  test("different scheme does not match", () => {
    expect(_matchesAny("http://api.example.com/x", ["https://api.example.com"])).toBe(false);
  });

  test("different host does not match", () => {
    expect(_matchesAny("https://other.example.com/x", ["https://api.example.com"])).toBe(false);
  });

  test("subdomain of configured host does NOT match an exact pattern", () => {
    expect(_matchesAny("https://foo.api.example.com/x", ["https://api.example.com"])).toBe(false);
  });

  test("suffix-collision host does not match (api.example.com.evil.com)", () => {
    expect(_matchesAny("https://api.example.com.evil.com/x", ["https://api.example.com"])).toBe(false);
  });

  test("prefix-collision host does not match (apiXexample.com)", () => {
    expect(_matchesAny("https://apiXexample.com/x", ["https://api.example.com"])).toBe(false);
  });

  test("explicit default port normalizes to match implicit default port", () => {
    expect(_matchesAny("https://api.example.com:443/x", ["https://api.example.com"])).toBe(true);
    expect(_matchesAny("http://api.example.com:80/x", ["http://api.example.com"])).toBe(true);
  });

  test("non-default port does not match default-port pattern", () => {
    expect(_matchesAny("https://api.example.com:8443/x", ["https://api.example.com"])).toBe(false);
  });

  test("pattern with explicit port matches only that port", () => {
    expect(_matchesAny("https://api.example.com:8443/x", ["https://api.example.com:8443"])).toBe(true);
    expect(_matchesAny("https://api.example.com/x", ["https://api.example.com:8443"])).toBe(false);
  });

  test("trailing dot on request host is normalized", () => {
    expect(_matchesAny("https://api.example.com./x", ["https://api.example.com"])).toBe(true);
  });

  test("case-insensitive host match", () => {
    expect(_matchesAny("https://API.Example.COM/x", ["https://api.example.com"])).toBe(true);
  });

  test("non-URL request falls back cleanly", () => {
    expect(_matchesAny("not a url", ["https://api.example.com"])).toBe(false);
  });

  test("empty patterns list never matches", () => {
    expect(_matchesAny("https://api.example.com/x", [])).toBe(false);
  });
});

describe("BearerTokenInterceptor — wildcard subdomain matching", () => {
  const P = "https://*.example.com";

  test("direct subdomain matches", () => {
    expect(_matchesAny("https://foo.example.com/x", [P])).toBe(true);
  });

  test("multi-label subdomain matches", () => {
    expect(_matchesAny("https://a.b.example.com/x", [P])).toBe(true);
  });

  test("apex host does NOT match a wildcard pattern", () => {
    expect(_matchesAny("https://example.com/x", [P])).toBe(false);
  });

  test("host with collision suffix does not match", () => {
    expect(_matchesAny("https://foo.example.com.evil.com/x", [P])).toBe(false);
  });

  test("host with prefix collision does not match", () => {
    expect(_matchesAny("https://fooexample.com/x", [P])).toBe(false);
  });

  test("wildcard does not cross scheme", () => {
    expect(_matchesAny("http://foo.example.com/x", [P])).toBe(false);
  });

  test("wildcard does not cross port", () => {
    expect(_matchesAny("https://foo.example.com:8443/x", [P])).toBe(false);
  });

  test("wildcard with explicit port matches that port only", () => {
    expect(_matchesAny("https://foo.example.com:8443/x", ["https://*.example.com:8443"])).toBe(true);
    expect(_matchesAny("https://foo.example.com/x", ["https://*.example.com:8443"])).toBe(false);
  });

  test("wildcard host match is case-insensitive", () => {
    expect(_matchesAny("https://FOO.Example.COM/x", [P])).toBe(true);
  });

  test("list can mix exact + wildcard; apex covered by a second exact entry", () => {
    const patterns = ["https://example.com", "https://*.example.com"];
    expect(_matchesAny("https://example.com/x", patterns)).toBe(true);
    expect(_matchesAny("https://foo.example.com/x", patterns)).toBe(true);
  });

  test("host with leading dot does NOT match wildcard (C1 regression)", () => {
    expect(_matchesAny("https://.example.com/x", [P])).toBe(false);
  });

  test("host with double leading dot does NOT match wildcard", () => {
    expect(_matchesAny("https://..example.com/x", [P])).toBe(false);
  });
});

describe("BearerTokenInterceptor — install-time pattern validation", () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  function installWith(urlPatterns) {
    const target = {
      fetch: jest.fn(() => Promise.resolve({})),
      location: { href: "https://app.example.com/" },
      XMLHttpRequest: class FakeXHR {},
    };
    installBearerTokenInterceptor({
      urlPatterns,
      getToken: () => "tkn",
      target,
    });
    return target;
  }

  test("logs warning for *.com and skips it", async () => {
    const target = installWith(["https://*.com"]);
    await target.fetch("https://foo.com/x");
    const [, init] = target.fetch.mock.calls[0];
    expect(new Headers((init && init.headers) || {}).get("Authorization")).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('"https://*.com"'))
    ).toBe(true);
  });

  test("logs warning for bare https://*", () => {
    installWith(["https://*"]);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('"https://*"'))
    ).toBe(true);
  });

  test("logs warning for non-http scheme", () => {
    installWith(["ftp://api.example.com"]);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('"ftp://api.example.com"'))
    ).toBe(true);
  });

  test("logs warning for non-leftmost wildcard", () => {
    installWith(["https://foo.*.com"]);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('"https://foo.*.com"'))
    ).toBe(true);
  });

  test("logs warning for partial-label wildcard", () => {
    installWith(["https://*foo.example.com"]);
    expect(
      warnSpy.mock.calls.some((c) => String(c[0]).includes('"https://*foo.example.com"'))
    ).toBe(true);
  });

  test("valid and invalid patterns coexist; valid ones still work", async () => {
    const target = installWith(["https://*.com", "https://api.example.com"]);
    await target.fetch("https://api.example.com/x");
    const [, init] = target.fetch.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tkn");
    expect(warnSpy).toHaveBeenCalled();
  });

  test("install is a no-op when EVERY pattern is invalid (no wrap)", () => {
    const target = {
      fetch: jest.fn(() => Promise.resolve({})),
      location: { href: "https://app.example.com/" },
      XMLHttpRequest: class FakeXHR {},
    };
    const originalFetch = target.fetch;
    installBearerTokenInterceptor({
      urlPatterns: ["ftp://x", "https://*"],
      getToken: () => "tkn",
      target,
    });
    expect(target.fetch).toBe(originalFetch);
  });
});

describe("BearerTokenInterceptor — _parsePattern direct tests", () => {
  test("accepts a valid exact pattern", () => {
    expect(_parsePattern("https://api.example.com")).toMatchObject({
      valid: true,
      scheme: "https:",
      port: "443",
      host: "api.example.com",
      wildcard: false,
    });
  });

  test("accepts a valid wildcard pattern", () => {
    expect(_parsePattern("https://*.example.com")).toMatchObject({
      valid: true,
      scheme: "https:",
      port: "443",
      suffix: "example.com",
      wildcard: true,
    });
  });

  test("rejects non-http scheme", () => {
    expect(_parsePattern("ftp://api.example.com")).toMatchObject({
      valid: false,
      reason: expect.stringContaining("scheme"),
    });
  });

  test("rejects *.com (single-label suffix)", () => {
    expect(_parsePattern("https://*.com")).toMatchObject({
      valid: false,
      reason: expect.stringContaining("at least 2 labels"),
    });
  });

  test("rejects non-leftmost wildcard foo.*.com", () => {
    expect(_parsePattern("https://foo.*.com")).toMatchObject({
      valid: false,
      reason: expect.stringContaining("leftmost"),
    });
  });

  test("rejects partial-label wildcard *foo.example.com", () => {
    expect(_parsePattern("https://*foo.example.com")).toMatchObject({
      valid: false,
      reason: expect.stringContaining("leftmost"),
    });
  });

  test("rejects empty string", () => {
    expect(_parsePattern("")).toMatchObject({ valid: false });
  });

  test("rejects non-string input", () => {
    expect(_parsePattern(null)).toMatchObject({ valid: false });
    expect(_parsePattern(undefined)).toMatchObject({ valid: false });
    expect(_parsePattern(42)).toMatchObject({ valid: false });
  });
});

describe("BearerTokenInterceptor — URL list setting", () => {
  test("splits a comma-separated string, trimming and dropping empty entries", () => {
    expect(parseUrlList(" https://a.example.com, ,https://*.b.example.com ,")).toEqual([
      "https://a.example.com",
      "https://*.b.example.com",
    ]);
  });

  test("accepts an array and treats a missing value as empty", () => {
    expect(parseUrlList(["https://a.example.com", " "])).toEqual(["https://a.example.com"]);
    expect(parseUrlList(undefined)).toEqual([]);
    expect(parseUrlList("")).toEqual([]);
  });
});

describe("BearerTokenInterceptor — fetch with a URL object", () => {
  test("adds Authorization when fetch is called with a URL instance", async () => {
    const target = makeFakeTarget();
    const originalFetch = target.fetch;
    installBearerTokenInterceptor({ urlPatterns: ["https://gw.example.com"], getToken: () => "tkn-url", target });

    await target.fetch(new URL("https://gw.example.com/files/1"), { method: "DELETE" });

    const [, init] = originalFetch.mock.calls[0];
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tkn-url");
  });
});

describe("BearerTokenInterceptor — patterns with a path", () => {
  let warnSpy;
  beforeEach(() => { warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  test("warns that the path is ignored and still matches the whole origin", () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({ urlPatterns: ["https://gw.example.com/storage"], getToken: () => "t", target });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("the path is ignored"));
    expect(_matchesAny("https://gw.example.com/other", ["https://gw.example.com/storage"])).toBe(true);
  });

  test("a trailing slash alone is not a path", () => {
    const target = makeFakeTarget();
    installBearerTokenInterceptor({ urlPatterns: ["https://gw.example.com/"], getToken: () => "t", target });

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("the path is ignored"));
  });
});
