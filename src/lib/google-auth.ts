/**
 * Google OAuth authorization-code flow with PKCE. Google verifies identity;
 * EnduroLab continues to own its existing users and HTTP-only sessions.
 */
import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const GOOGLE_FLOW_COOKIE = "enduro_google_flow";
export const GOOGLE_FLOW_SECONDS = 600;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  origin: string;
}

export interface GoogleFlow {
  state: string;
  verifier: string;
  redirect: string;
  createdAt: number;
}

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;
  if (!clientId || !clientSecret || !appUrl) return null;
  try {
    const url = new URL(appUrl);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      return null;
    }
    return {
      clientId, clientSecret, origin: url.origin,
      redirectUri: `${url.origin}/api/auth/google/callback`,
    };
  } catch {
    return null;
  }
}

/** Reject backslashes and control characters as well as protocol-relative URLs. */
export function googleLoginRedirect(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u0020\u007f]/.test(value)
    ? value : "/plan";
}

export function createGoogleFlow(redirect: string | null): GoogleFlow {
  return {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    redirect: googleLoginRedirect(redirect),
    createdAt: Date.now(),
  };
}

export function googleAuthorizationUrl(config: GoogleConfig, flow: GoogleFlow): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: flow.state,
    code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

export function readGoogleFlow(cookie: string | undefined, state: string | null): GoogleFlow | null {
  if (!cookie || !state) return null;
  try {
    const flow = JSON.parse(cookie) as Partial<GoogleFlow>;
    if (typeof flow.state !== "string" || typeof flow.verifier !== "string" ||
        typeof flow.createdAt !== "number" || typeof flow.redirect !== "string" ||
        flow.verifier.length < 43 || Date.now() < flow.createdAt ||
        Date.now() - flow.createdAt > GOOGLE_FLOW_SECONDS * 1000) return null;
    const expected = Buffer.from(flow.state);
    const actual = Buffer.from(state);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return { ...flow, redirect: googleLoginRedirect(flow.redirect) } as GoogleFlow;
  } catch {
    return null;
  }
}

/** Use Google's authenticated userinfo endpoint; never trust an unverified JWT payload. */
export async function googleVerifiedEmail(config: GoogleConfig, code: string, verifier: string): Promise<string> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error("Google token exchange failed");
  const token = await tokenResponse.json() as { access_token?: unknown };
  if (typeof token.access_token !== "string" || !token.access_token) throw new Error("Missing Google access token");
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!profileResponse.ok) throw new Error("Google identity lookup failed");
  const profile = await profileResponse.json() as { sub?: unknown; email?: unknown; email_verified?: unknown };
  if (typeof profile.sub !== "string" || !profile.sub || profile.email_verified !== true ||
      typeof profile.email !== "string" || !profile.email.includes("@")) {
    throw new Error("Google email is not verified");
  }
  return profile.email.trim().toLowerCase();
}
