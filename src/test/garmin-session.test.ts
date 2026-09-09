// ============================================================
// EnduroLab - Garmin Session Lifetime Tests
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("garmin-connect-client", () => ({
  MfaMethod: { EMAIL: "email", SMS: "sms", PHONE: "phone" },
  AuthContext: vi.fn(),
  createAuthContext: vi.fn(),
  create: vi.fn(),
  createFromSession: vi.fn(),
}));

import { create, createAuthContext, createFromSession } from "garmin-connect-client";
import {
  GarminMfaRequiredError,
  GarminSessionExpiredError,
  garminCredentialsFor,
  garminTokenNeedsRefresh,
  openGarminSession,
} from "@/lib/garmin/client";
import { decryptGarminPassword, encryptGarminPassword } from "@/lib/garmin/crypto";

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function session(expiresAt: number) {
  return {
    kind: "session" as const,
    session: {
      cookies: JSON.stringify({ cookies: [] }),
      oauth1Token: { oauth_token: "o1", oauth_token_secret: "s1" },
      oauth2Token: {
        access_token: "a1",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "r1",
        refresh_token_expires_in: 3600 * 24 * 365,
        expires_at: expiresAt,
      },
    },
  };
}

function fakeClient(persistedSession: ReturnType<typeof session>["session"], refresh: "ok" | "fails") {
  const clear = vi.fn();
  const refreshToken = vi.fn(async () => {
    if (refresh === "fails") throw new Error("401 Unauthorized");
    return "rotated-access-token";
  });
  return {
    getSession: vi.fn(() => persistedSession),
    httpClient: {
      client: { defaults: { timeout: 0 }, interceptors: { response: { clear } } },
      refreshToken,
    },
    _clear: clear,
  };
}

describe("Garmin token refresh window", () => {
  it("refreshes before the access token actually expires", () => {
    expect(garminTokenNeedsRefresh(NOW_SECONDS + 600, NOW_SECONDS)).toBe(true);
    expect(garminTokenNeedsRefresh(NOW_SECONDS - 1, NOW_SECONDS)).toBe(true);
    expect(garminTokenNeedsRefresh(NOW_SECONDS + 7200, NOW_SECONDS)).toBe(false);
    expect(garminTokenNeedsRefresh(undefined, NOW_SECONDS)).toBe(false);
  });
});

describe("openGarminSession", () => {
  beforeEach(() => {
    vi.mocked(createFromSession).mockReset();
    vi.mocked(createAuthContext).mockReset();
    vi.mocked(create).mockReset();
  });

  it("leaves a still-valid session untouched and returns it for persistence", async () => {
    const stored = session(NOW_SECONDS + 7200);
    const client = fakeClient(stored.session, "ok");
    vi.mocked(createFromSession).mockReturnValue(client as never);

    const opened = await openGarminSession(stored);

    expect(opened.reauthenticated).toBe(false);
    expect(client.httpClient.refreshToken).not.toHaveBeenCalled();
    expect(opened.auth).toEqual(stored);
  });

  it("rotates a near-expiry access token instead of letting the login age out", async () => {
    const stored = session(NOW_SECONDS + 600);
    const rotated = session(NOW_SECONDS + 86_400);
    const first = fakeClient(stored.session, "ok");
    const second = fakeClient(rotated.session, "ok");
    vi.mocked(createFromSession).mockReturnValueOnce(first as never).mockReturnValueOnce(second as never);

    const opened = await openGarminSession(stored);

    expect(first.httpClient.refreshToken).toHaveBeenCalledTimes(1);
    expect(first._clear).toHaveBeenCalledTimes(1);
    expect(opened.auth).toEqual(rotated);
    expect(opened.reauthenticated).toBe(false);
  });

  it("re-authenticates with the sealed password when the session is dead", async () => {
    const stored = session(NOW_SECONDS - 86_400);
    const dead = fakeClient(stored.session, "fails");
    vi.mocked(createFromSession).mockReturnValue(dead as never);
    const renewed = session(NOW_SECONDS + 86_400);
    const relogged = fakeClient(renewed.session, "ok");
    vi.mocked(createAuthContext).mockResolvedValue({ mfaRequired: false } as never);
    vi.mocked(create).mockResolvedValue(relogged as never);

    const opened = await openGarminSession(stored, { username: "runner@example.com", password: "hunter2" });

    expect(createAuthContext).toHaveBeenCalledWith({ username: "runner@example.com", password: "hunter2" });
    expect(opened.reauthenticated).toBe(true);
    expect(opened.auth).toEqual(renewed);
  });

  it("asks for the forwarded one-time code when the re-login needs MFA", async () => {
    const stored = session(NOW_SECONDS - 86_400);
    const dead = fakeClient(stored.session, "fails");
    vi.mocked(createFromSession).mockReturnValue(dead as never);
    vi.mocked(createAuthContext).mockResolvedValue({
      mfaRequired: true,
      mfaMethod: "email",
      getCookies: () => JSON.stringify({ cookies: [] }),
    } as never);

    const error = await openGarminSession(stored, {
      username: "runner@example.com",
      password: "hunter2",
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GarminMfaRequiredError);
    expect((error as GarminMfaRequiredError).pending).toMatchObject({ kind: "mfa", method: "email" });
  });

  it("still reports an expired session when the runner did not choose remember me", async () => {
    const stored = session(NOW_SECONDS - 86_400);
    const dead = fakeClient(stored.session, "fails");
    vi.mocked(createFromSession).mockReturnValue(dead as never);

    const error = await openGarminSession(stored).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(GarminSessionExpiredError);
    expect(createAuthContext).not.toHaveBeenCalled();
  });
});

describe("remember-me credential storage", () => {
  beforeEach(() => {
    process.env.GARMIN_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123";
  });

  it("seals and recovers the password", () => {
    const sealed = encryptGarminPassword("hunter2");
    expect(sealed).not.toContain("hunter2");
    expect(decryptGarminPassword(sealed)).toBe("hunter2");
  });

  it("returns null for a missing or malformed payload", () => {
    expect(decryptGarminPassword(null)).toBeNull();
    expect(decryptGarminPassword("not-a-payload")).toBeNull();
  });

  it("only hands back credentials for a connection that opted in", () => {
    const sealed = encryptGarminPassword("hunter2");
    expect(garminCredentialsFor({
      garminUsername: "runner@example.com",
      rememberMe: true,
      encryptedPassword: sealed,
    })).toEqual({ username: "runner@example.com", password: "hunter2" });
    expect(garminCredentialsFor({
      garminUsername: "runner@example.com",
      rememberMe: false,
      encryptedPassword: sealed,
    })).toBeNull();
    expect(garminCredentialsFor({
      garminUsername: "runner@example.com",
      rememberMe: true,
      encryptedPassword: null,
    })).toBeNull();
  });
});
