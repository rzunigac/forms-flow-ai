import { _matchesGateway, installGatewayAuthInterceptor } from "../../../services/GatewayAuthInterceptor";

describe("GatewayAuthInterceptor — URL matching", () => {
  test("URL starting with the gateway base matches", () => {
    expect(_matchesGateway("https://gw.example.com/files/abc", "https://gw.example.com")).toBe(true);
  });

  test("URL on a different host does not match", () => {
    expect(_matchesGateway("https://other.example.com/files/abc", "https://gw.example.com")).toBe(false);
  });

  test("trailing slash on baseUrl is normalized", () => {
    expect(_matchesGateway("https://gw.example.com/files/abc", "https://gw.example.com/")).toBe(true);
  });

  test("relative URL resolves against window.location and matches", () => {
    const loc = "https://gw.example.com/app/";
    expect(_matchesGateway("files/abc", "https://gw.example.com", loc)).toBe(true);
  });

  test("empty baseUrl never matches", () => {
    expect(_matchesGateway("https://gw.example.com/x", "")).toBe(false);
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
    installGatewayAuthInterceptor({
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
    installGatewayAuthInterceptor({
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
    installGatewayAuthInterceptor({
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
    installGatewayAuthInterceptor({
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
    installGatewayAuthInterceptor({
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
