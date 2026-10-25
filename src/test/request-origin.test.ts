/** Origin checks retain CSRF protection through TLS proxies and public aliases. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isValidRequestOrigin } from "@/lib/request-origin";

afterEach(() => vi.unstubAllEnvs());
function valid(origin: string, headers: Record<string, string> = {}): boolean {
  return isValidRequestOrigin(new NextRequest("http://localhost:3000/api/plan/test/garmin-workout", {
    headers: { origin, ...headers },
  }));
}
describe("Garmin write origins", () => {
  it("accepts configured public origin and a public alias behind a TLS proxy", () => {
    vi.stubEnv("APP_URL", "https://training.example.com");
    expect(valid("https://training.example.com")).toBe(true);
    expect(valid("https://www.training.example.com", { "x-forwarded-host": "www.training.example.com", "x-forwarded-proto": "https" })).toBe(true);
    expect(valid("https://www.training.example.com", { host: "www.training.example.com" })).toBe(true);
  });
  it("accepts proxy origin without configuration and a normal direct origin", () => {
    vi.stubEnv("APP_URL", ""); vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(valid("https://training.example.com", { "x-forwarded-host": "training.example.com", "x-forwarded-proto": "https" })).toBe(true);
    expect(valid("http://localhost:3000")).toBe(true);
  });
  it("accepts the deployed Apache www redirect when Next fills the internal HTTP scheme", () => {
    vi.stubEnv("APP_URL", "https://spacetimeapollo.com");
    expect(valid("https://www.spacetimeapollo.com", {
      host: "www.spacetimeapollo.com",
      "x-forwarded-host": "www.spacetimeapollo.com",
      "x-forwarded-proto": "http",
      "x-forwarded-port": "3001",
    })).toBe(true);
  });
  it.each(["https://attacker.test", "https://www.spacetimeapollo.com.attacker.test", "https://www.spacetimeapollo.com:444"])("rejects a foreign host/port even with the internal HTTP scheme: %s", (origin) => {
    vi.stubEnv("APP_URL", "https://spacetimeapollo.com");
    expect(valid(origin, { host: "www.spacetimeapollo.com", "x-forwarded-host": "www.spacetimeapollo.com", "x-forwarded-proto": "http" })).toBe(false);
  });
  it("does not downgrade an HTTPS proxy origin to HTTP on a public alias", () => {
    vi.stubEnv("APP_URL", "https://spacetimeapollo.com");
    expect(valid("http://www.spacetimeapollo.com", {
      host: "www.spacetimeapollo.com", "x-forwarded-host": "www.spacetimeapollo.com", "x-forwarded-proto": "https",
    })).toBe(false);
  });
  it.each(["https://attacker.test", "null", "https://training.example.com.attacker.test", "https://training.example.com/path", "http://training.example.com"])("rejects foreign, opaque and mismatched origins: %s", (origin) => {
    vi.stubEnv("APP_URL", "https://training.example.com");
    expect(valid(origin, { "x-forwarded-host": "training.example.com", "x-forwarded-proto": "https" })).toBe(false);
  });
  it("fails closed on malformed configuration and permits authenticated native requests", () => {
    vi.stubEnv("APP_URL", "invalid");
    expect(valid("https://attacker.test")).toBe(false);
    expect(isValidRequestOrigin(new NextRequest("http://localhost:3000"))).toBe(true);
  });
});
