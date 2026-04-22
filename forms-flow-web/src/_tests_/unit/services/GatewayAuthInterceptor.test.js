import { _matchesGateway } from "../../../services/GatewayAuthInterceptor";

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
