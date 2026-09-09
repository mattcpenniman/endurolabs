// ============================================================
// EnduroLab - Garmin Connect Client
// ============================================================

import "server-only";

import {
  AuthContext,
  create,
  createAuthContext,
  createFromSession,
  MfaMethod,
} from "garmin-connect-client";
import type {
  Activity,
  GarminConnectClient,
  PersistedSession,
} from "garmin-connect-client";

import { decryptGarminPassword } from "@/lib/garmin/crypto";

export interface PendingGarminLogin {
  kind: "mfa";
  cookies: string;
  method: MfaMethod;
}

export interface GarminSession {
  kind: "session";
  session: PersistedSession;
}

export type StoredGarminAuth = PendingGarminLogin | GarminSession;

export type GarminLoginResult =
  | { mfaRequired: true; pending: PendingGarminLogin }
  | { mfaRequired: false; client: GarminConnectClient; auth: GarminSession };

/** Username/password pair kept for opt-in "remember me" re-authentication. */
export interface GarminCredentials {
  username: string;
  password: string;
}

/**
 * Read the sealed password for a connection that opted into "remember me".
 * Returns null whenever the runner did not opt in or nothing is stored.
 */
export function garminCredentialsFor(connection: {
  garminUsername: string;
  rememberMe: boolean;
  encryptedPassword: string | null;
}): GarminCredentials | null {
  if (!connection.rememberMe) return null;
  const password = decryptGarminPassword(connection.encryptedPassword);
  return password ? { username: connection.garminUsername, password } : null;
}

/** Raised when the stored OAuth session can no longer be refreshed. */
export class GarminSessionExpiredError extends Error {
  constructor(message = "Garmin session expired. Reconnect Garmin to resume syncing.") {
    super(message);
    this.name = "GarminSessionExpiredError";
  }
}

/**
 * Raised when a "remember me" re-login needs the one-time code Garmin emailed
 * or texted. The caller persists `pending` and asks the runner to forward it.
 */
export class GarminMfaRequiredError extends Error {
  readonly pending: PendingGarminLogin;

  constructor(pending: PendingGarminLogin) {
    super("Garmin sent a new verification code. Enter it to stay connected.");
    this.name = "GarminMfaRequiredError";
    this.pending = pending;
  }
}

export interface GarminSessionResult {
  client: GarminConnectClient;
  /** Latest auth to persist so the refreshed tokens outlive this request. */
  auth: GarminSession;
  /** True when the stored session was dead and credentials re-logged in. */
  reauthenticated: boolean;
}

interface RefreshableGarminClient extends GarminConnectClient {
  httpClient: {
    client: {
      defaults: { timeout: number };
      interceptors: { response: { clear(): void } };
    };
    refreshToken(): Promise<string>;
  };
}

const GARMIN_REQUEST_TIMEOUT_MS = 30_000;
/**
 * Refresh access tokens this far before they actually expire. Garmin access
 * tokens live ~1 day, so a daily refresh keeps an active runner logged in
 * without ever hitting the expired-token path.
 */
const GARMIN_REFRESH_SKEW_SECONDS = 60 * 60;

export function garminTokenNeedsRefresh(
  expiresAt: number | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  skewSeconds = GARMIN_REFRESH_SKEW_SECONDS
): boolean {
  if (expiresAt === undefined) return false;
  return expiresAt - nowSeconds <= skewSeconds;
}

export async function loginToGarmin(username: string, password: string): Promise<GarminLoginResult> {
  const context = await createAuthContext({ username, password });
  if (context.mfaRequired) {
    return {
      mfaRequired: true,
      pending: {
        kind: "mfa",
        cookies: context.getCookies(),
        method: context.mfaMethod ?? MfaMethod.EMAIL,
      },
    };
  }

  const client = await create(context);
  return { mfaRequired: false, client, auth: { kind: "session", session: client.getSession() } };
}

export async function completeGarminMfa(pending: PendingGarminLogin, code: string): Promise<{
  client: GarminConnectClient;
  auth: GarminSession;
}> {
  const context = new AuthContext(true, pending.cookies, pending.method);
  const client = await create(context, code);
  return { client, auth: { kind: "session", session: client.getSession() } };
}

async function restoreGarminSession(auth: GarminSession): Promise<{
  client: GarminConnectClient;
  auth: GarminSession;
}> {
  let client = createFromSession(auth.session) as RefreshableGarminClient;
  client.httpClient.client.defaults.timeout = GARMIN_REQUEST_TIMEOUT_MS;

  if (garminTokenNeedsRefresh(auth.session.oauth2Token.expires_at)) {
    // The package's 401 interceptor recursively waits on itself when OAuth1 is
    // also invalid. Refresh without that interceptor so reconnect errors return.
    client.httpClient.client.interceptors.response.clear();
    try {
      await client.httpClient.refreshToken();
    } catch {
      throw new GarminSessionExpiredError();
    }
    client = createFromSession(client.getSession()) as RefreshableGarminClient;
    client.httpClient.client.defaults.timeout = GARMIN_REQUEST_TIMEOUT_MS;
  }

  return { client, auth: { kind: "session", session: client.getSession() } };
}

/**
 * Restore a stored Garmin session, refreshing its access token before it
 * expires, and — when the runner opted into "remember me" — transparently
 * re-authenticate with the sealed password once the session is unrecoverable.
 *
 * The returned `auth` is always the newest session and should be persisted so
 * every sync rotates the tokens forward instead of letting them age out.
 */
export async function openGarminSession(
  auth: StoredGarminAuth,
  credentials: GarminCredentials | null = null
): Promise<GarminSessionResult> {
  if (auth.kind !== "session") throw new Error("Garmin MFA verification is still required");
  try {
    const restored = await restoreGarminSession(auth);
    return { ...restored, reauthenticated: false };
  } catch (error) {
    if (!(error instanceof GarminSessionExpiredError) || !credentials?.password) throw error;
    const login = await loginToGarmin(credentials.username, credentials.password);
    if (login.mfaRequired) throw new GarminMfaRequiredError(login.pending);
    return { client: login.client, auth: login.auth, reauthenticated: true };
  }
}

export async function fetchRecentRuns(client: GarminConnectClient, limit = 400): Promise<Activity[]> {
  const requested = Math.min(Math.max(limit, 1), 1000);
  const activities: Activity[] = [];

  while (activities.length < requested) {
    const pageSize = Math.min(200, requested - activities.length);
    const page = await client.getActivities(activities.length, pageSize);
    activities.push(...page);
    if (page.length < pageSize) break;
  }

  return activities.filter((activity) => {
    const type = activity.activityType?.typeKey?.toLowerCase() ?? "";
    return type.includes("running") || type.includes("run");
  });
}

function activityStart(activity: Activity): Date | null {
  const value = (activity as Activity & { startTimeGMT?: string }).startTimeGMT;
  if (!value) return null;
  const parsed = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Fetch newest activities until the latest persisted boundary is crossed. */
export async function fetchRunsSince(
  client: GarminConnectClient,
  lowerBound: Date | null,
  through: Date,
  limit = 400
): Promise<Activity[]> {
  const maximum = Math.min(Math.max(limit, 1), 1000);
  const activities: Activity[] = [];
  let offset = 0;

  while (offset < maximum) {
    const pageSize = Math.min(200, maximum - offset);
    const page = await client.getActivities(offset, pageSize);
    activities.push(...page);
    offset += page.length;
    const crossedBoundary = lowerBound !== null && page.some((activity) => {
      const start = activityStart(activity);
      return start !== null && start <= lowerBound;
    });
    if (page.length < pageSize || crossedBoundary) break;
  }

  return activities.filter((activity) => {
    const type = activity.activityType?.typeKey?.toLowerCase() ?? "";
    const start = activityStart(activity);
    return (type.includes("running") || type.includes("run"))
      && start !== null
      && start <= through
      && (lowerBound === null || start >= lowerBound);
  });
}

interface AuthenticatedGarminClient extends GarminConnectClient {
  httpClient: {
    get<T>(url: string): Promise<T>;
  };
}

export async function fetchHistoryActivitiesPage(
  client: GarminConnectClient,
  offset: number,
  limit = 200,
): Promise<unknown[]> {
  const authenticatedClient = client as AuthenticatedGarminClient;
  if (!authenticatedClient.httpClient?.get) {
    throw new Error("Installed Garmin client does not expose its authenticated transport");
  }
  const page = await authenticatedClient.httpClient.get<unknown>(
    `https://connectapi.garmin.com/activitylist-service/activities/search/activities?start=${offset}&limit=${limit}`
  );
  if (!Array.isArray(page)) throw new Error("Garmin history response was not an activity list");
  return page;
}

export async function fetchActivityDetail(client: GarminConnectClient, activityId: string): Promise<unknown> {
  const authenticatedClient = client as AuthenticatedGarminClient;
  if (!authenticatedClient.httpClient?.get) {
    throw new Error("Installed Garmin client does not expose its authenticated transport");
  }

  const path = `activity-service/activity/${encodeURIComponent(activityId)}/details?maxChartSize=20000&maxPolylineSize=20000`;
  try {
    return await authenticatedClient.httpClient.get(`https://connectapi.garmin.com/${path}`);
  } catch (primaryError) {
    try {
      return await authenticatedClient.httpClient.get(`https://connect.garmin.com/modern/proxy/${path}`);
    } catch {
      throw primaryError;
    }
  }
}
