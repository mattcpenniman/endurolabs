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

export function restoreGarminClient(auth: StoredGarminAuth): GarminConnectClient {
  if (auth.kind !== "session") throw new Error("Garmin MFA verification is still required");
  return createFromSession(auth.session);
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
