import { _matchesAny, installBearerTokenInterceptor } from "../../../services/BearerTokenInterceptor";

describe("GatewayAuthInterceptor — URL matching", () => {
  test("URL starting with the gateway base matches", () => {
    expect(_matchesAny("https://gw.example.com/files/abc", "https://gw.example.com")).toBe(true);
  });

  test("URL on a different host does not match", () => {
    expect(_matchesAny("https://other.example.com/files/abc", "https://gw.example.com")).toBe(false);
  });

  test("trailing slash on baseUrl is normalized", () => {
    expect(_matchesAny("https://gw.example.com/files/abc", "https://gw.example.com/")).toBe(true);
  });

  test("relative URL resolves against window.location and matches", () => {
    const loc = "https://gw.example.com/app/";
    expect(_matchesAny("files/abc", "https://gw.example.com", loc)).toBe(true);
  });

  test("empty baseUrl never matches", () => {
    expect(_matchesAny("https://gw.example.com/x", "")).toBe(false);
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
      getToken: () => "tkn-abc",
      target,
    });
    const afterFirst = target.fetch;

    installBearerTokenInterceptor({
      gatewayBaseUrl: BASE,
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
      gatewayBaseUrl: BASE,
      getToken: () => "tkn-abc",
      target,
    });
    const sendAfterFirst = target.XMLHttpRequest.prototype.send;

    installBearerTokenInterceptor({
      gatewayBaseUrl: BASE,
      getToken: () => "tkn-abc",
      target,
    });
    const sendAfterSecond = target.XMLHttpRequest.prototype.send;

    expect(sendAfterSecond).toBe(sendAfterFirst);
  });
});
