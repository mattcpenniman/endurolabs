// @vitest-environment node
/** Verify OAuth browser binding, verified identity, and existing-account session handoff. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  createGoogleFlow, googleAuthorizationUrl, googleConfig, googleLoginRedirect,
  googleVerifiedEmail, readGoogleFlow, GOOGLE_FLOW_COOKIE, GOOGLE_FLOW_SECONDS,
} from "@/lib/google-auth";

const mocks = vi.hoisted(() => ({
  select: vi.fn(), createSession: vi.fn(), setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/auth", () => ({ createSession: mocks.createSession, setSessionCookie: mocks.setSessionCookie }));

import { GET as callback } from "@/app/api/auth/google/callback/route";
import { GET as start } from "@/app/api/auth/google/route";
import { POST as passwordLogin } from "@/app/api/auth/login/route";

const config = {
  clientId: "test-client", clientSecret: "test-secret",
  origin: "https://training.example.com", redirectUri: "https://training.example.com/api/auth/google/callback",
};

function mockGoogle(profile: Record<string, unknown> = {
  sub: "google-user-1", email: "mattcpenniman@gmail.com", email_verified: true,
}): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "google-access-token" }))
    .mockResolvedValueOnce(Response.json(profile));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

beforeEach(() => {
  vi.stubEnv("APP_URL", config.origin);
  vi.stubEnv("GOOGLE_CLIENT_ID", config.clientId);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", config.clientSecret);
  mocks.select.mockReset();
  mocks.createSession.mockReset().mockResolvedValue("enduro-session");
  mocks.setSessionCookie.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Google OAuth protection", () => {
  it("requires complete configuration and a secure production origin", () => {
    expect(googleConfig()).toEqual(config);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(googleConfig()).toBeNull();
    vi.stubEnv("GOOGLE_CLIENT_SECRET", config.clientSecret);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://training.example.com");
    expect(googleConfig()).toBeNull();
  });

  it("requests only identity scopes, with random state and S256 PKCE", () => {
    const flow = createGoogleFlow("/plan?tab=score");
    const url = new URL(googleAuthorizationUrl(config, flow));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toHaveLength(43);
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(createGoogleFlow(null).state).not.toBe(flow.state);
  });

  it("rejects expired, future, mismatched, missing, and malformed browser state", () => {
    const flow = createGoogleFlow(null);
    expect(readGoogleFlow(JSON.stringify(flow), flow.state)).toEqual(flow);
    expect(readGoogleFlow(JSON.stringify(flow), "wrong")).toBeNull();
    expect(readGoogleFlow(undefined, flow.state)).toBeNull();
    expect(readGoogleFlow("bad-json", flow.state)).toBeNull();
    expect(readGoogleFlow("{}", flow.state)).toBeNull();
    expect(readGoogleFlow(JSON.stringify({ ...flow, createdAt: Date.now() + 60_000 }), flow.state)).toBeNull();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + (GOOGLE_FLOW_SECONDS + 1) * 1000);
    expect(readGoogleFlow(JSON.stringify(flow), flow.state)).toBeNull();
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\nevil.example"])(
    "rejects unsafe post-login redirect %j", (redirect) => {
      expect(googleLoginRedirect(redirect)).toBe("/plan");
    },
  );

  it("exchanges the code with PKCE and reads identity using Google's access token", async () => {
    const fetcher = mockGoogle({ sub: "123", email: "MattCPenniman@gmail.com", email_verified: true });
    expect(await googleVerifiedEmail(config, "auth-code", "verifier")).toBe("mattcpenniman@gmail.com");
    const body = fetcher.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe("Bearer google-access-token");
  });

  it.each([false, "true", undefined])("rejects an unverified Google email (%j)", async (verified) => {
    mockGoogle({ sub: "123", email: "mattcpenniman@gmail.com", email_verified: verified });
    await expect(googleVerifiedEmail(config, "code", "verifier")).rejects.toThrow("not verified");
  });

  it("rejects a failed token exchange before querying identity", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("denied", { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(googleVerifiedEmail(config, "code", "verifier")).rejects.toThrow("exchange failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Google sign-in routes", () => {
  function callbackRequest(stateOverride?: string): NextRequest {
    const flow = createGoogleFlow("/plan?tab=score");
    return new NextRequest(`${config.redirectUri}?code=auth-code&state=${stateOverride ?? flow.state}`, {
      headers: { cookie: `${GOOGLE_FLOW_COOKIE}=${encodeURIComponent(JSON.stringify(flow))}` },
    });
  }

  it("sets a short-lived HTTP-only browser cookie on authorization", async () => {
    const response = await start(new NextRequest(`${config.origin}/api/auth/google?redirect=%2Fplan`));
    expect(response.headers.get("location")).toMatch(/^https:\/\/accounts.google.com\//);
    const cookie = response.cookies.get(GOOGLE_FLOW_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.maxAge).toBe(GOOGLE_FLOW_SECONDS);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("creates a session for the existing user ID without creating or modifying users", async () => {
    mockGoogle();
    const limit = vi.fn().mockResolvedValue([{ id: "existing-matt-user-id" }]);
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });
    const response = await callback(callbackRequest());
    expect(mocks.createSession).toHaveBeenCalledWith("existing-matt-user-id");
    expect(mocks.setSessionCookie).toHaveBeenCalledWith("enduro-session");
    expect(response.headers.get("location")).toBe(`${config.origin}/plan?tab=score`);
    expect(response.cookies.get(GOOGLE_FLOW_COOKIE)?.maxAge).toBe(0);
  });

  it("does not issue a session or contact Google for mismatched state", async () => {
    const fetcher = mockGoogle();
    const response = await callback(callbackRequest("wrong-state"));
    expect(response.headers.get("location")).toContain("error=invalid_state");
    expect(fetcher).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects unknown Google accounts without creating a new user", async () => {
    mockGoogle();
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=account_not_found");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("handles provider failures without issuing a session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    const response = await callback(callbackRequest());
    expect(response.headers.get("location")).toContain("error=google_failed");
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("returns a setup error if credentials are missing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const response = await start(new NextRequest(`${config.origin}/api/auth/google`));
    expect(response.headers.get("location")).toContain("error=google_unavailable");
  });

  it("disables the previous password login endpoint", async () => {
    expect((await passwordLogin()).status).toBe(410);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
