// ============================================================
// EnduroLab - Garmin Connection API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, plans, runActivities } from "@/lib/db/schema";
import { decryptGarminTokens, encryptGarminPassword, encryptGarminTokens } from "@/lib/garmin/crypto";
import {
  completeGarminMfa,
  garminCredentialsFor,
  loginToGarmin,
  StoredGarminAuth,
} from "@/lib/garmin/client";
import { serializeRunActivity } from "@/lib/activities/serialize";

export const runtime = "nodejs";

function isStaleGarminMfaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("session expired");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const planId = request.nextUrl.searchParams.get("planId");
    if (planId) {
      const [ownedPlan] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.userId, user.id)))
        .limit(1);
      if (!ownedPlan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const [connection] = await db
      .select()
      .from(garminConnections)
      .where(eq(garminConnections.userId, user.id))
      .limit(1);
    const activities = await db
      .select()
      .from(runActivities)
      .where(planId
        ? and(eq(runActivities.userId, user.id), eq(runActivities.source, "garmin"), eq(runActivities.planId, planId))
        : and(eq(runActivities.userId, user.id), eq(runActivities.source, "garmin")))
      .orderBy(desc(runActivities.startTimeGmt))
      .limit(1000);

    return NextResponse.json({
      connected: connection?.status === "connected",
      mfaRequired: connection?.status === "mfa_required",
      mfaMethod: connection?.status === "mfa_required" ? "email or SMS" : null,
      username: connection?.garminUsername,
      displayName: connection?.garminDisplayName,
      status: connection?.status,
      rememberMe: connection?.rememberMe ?? false,
      lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
      lastError: connection?.lastError ?? null,
      activities: activities.map(serializeRunActivity),
    });
  } catch (error) {
    console.error("Failed to load Garmin integration:", error);
    return NextResponse.json({ error: "Failed to load Garmin integration" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const workerToken = randomUUID();
  let lockedConnectionId: string | null = null;
  const releaseLease = async (connectionId: string): Promise<void> => {
    await db.update(garminConnections).set({
      activeJobId: null,
      activeWorkerToken: null,
      activeJobLeaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(garminConnections.id, connectionId),
      eq(garminConnections.activeWorkerToken, workerToken),
    ));
  };
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = (await request.json()) as {
      username?: string;
      password?: string;
      mfaCode?: string;
      rememberMe?: boolean;
    };

    if (body.mfaCode) {
      const [pendingConnection] = await db
        .select()
        .from(garminConnections)
        .where(and(eq(garminConnections.userId, user.id), eq(garminConnections.status, "mfa_required")))
        .limit(1);
      if (!pendingConnection) {
        return NextResponse.json({ error: "Start Garmin sign-in again before entering a verification code" }, { status: 409 });
      }
      const now = new Date();
      const [locked] = await db.update(garminConnections).set({
        activeWorkerToken: workerToken,
        activeJobLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        updatedAt: now,
      }).where(and(
        eq(garminConnections.id, pendingConnection.id),
        or(isNull(garminConnections.activeWorkerToken), lte(garminConnections.activeJobLeaseExpiresAt, now)),
      )).returning({ id: garminConnections.id });
      if (!locked) return NextResponse.json({ error: "Another Garmin import is already running" }, { status: 409 });
      lockedConnectionId = locked.id;
      const stored = decryptGarminTokens<StoredGarminAuth>(pendingConnection.encryptedTokens);
      if (stored.kind !== "mfa") {
        await releaseLease(pendingConnection.id);
        lockedConnectionId = null;
        return NextResponse.json({ error: "Garmin verification session expired; start sign-in again" }, { status: 409 });
      }
      const code = body.mfaCode.trim();
      let auth: StoredGarminAuth;
      try {
        const completed = await completeGarminMfa(stored, code);
        auth = completed.auth;
      } catch (error) {
        // The remembered password lets Garmin re-issue a code when the pending
        // login window closed while the runner was fetching the forwarded one.
        const credentials = garminCredentialsFor(pendingConnection);
        if (!credentials || !isStaleGarminMfaError(error)) throw error;
        const relogin = await loginToGarmin(credentials.username, credentials.password);
        if (relogin.mfaRequired) {
          await db.update(garminConnections).set({
            encryptedTokens: encryptGarminTokens(relogin.pending),
            status: "mfa_required",
            lastError: null,
            activeJobId: null,
            activeWorkerToken: null,
            activeJobLeaseExpiresAt: null,
            updatedAt: new Date(),
          }).where(and(eq(garminConnections.id, pendingConnection.id), eq(garminConnections.activeWorkerToken, workerToken)));
          lockedConnectionId = null;
          return NextResponse.json({
            connected: false,
            mfaRequired: true,
            mfaMethod: relogin.pending.method,
            message: "That code expired, so Garmin sent a new one. Enter it to stay connected.",
          });
        }
        auth = relogin.auth;
      }
      await db.update(garminConnections).set({
        encryptedTokens: encryptGarminTokens(auth),
        status: "connected",
        lastError: null,
        activeJobId: null,
        activeWorkerToken: null,
        activeJobLeaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(eq(garminConnections.id, pendingConnection.id), eq(garminConnections.activeWorkerToken, workerToken)));
      lockedConnectionId = null;
      return NextResponse.json({ connected: true });
    }

    const username = body.username?.trim();
    if (!username || !body.password) {
      return NextResponse.json({ error: "Garmin email and password are required" }, { status: 400 });
    }
    const rememberMe = body.rememberMe === true;
    const encryptedPassword = rememberMe ? encryptGarminPassword(body.password) : null;

    const [existingConnection] = await db.select({ id: garminConnections.id }).from(garminConnections)
      .where(eq(garminConnections.userId, user.id)).limit(1);
    if (existingConnection) {
      const now = new Date();
      const [locked] = await db.update(garminConnections).set({
        activeWorkerToken: workerToken,
        activeJobLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        updatedAt: now,
      }).where(and(
        eq(garminConnections.id, existingConnection.id),
        or(isNull(garminConnections.activeWorkerToken), lte(garminConnections.activeJobLeaseExpiresAt, now)),
      )).returning({ id: garminConnections.id });
      if (!locked) return NextResponse.json({ error: "Another Garmin import is already running" }, { status: 409 });
      lockedConnectionId = locked.id;
    }

    const connected = await loginToGarmin(username, body.password);
    const now = new Date();
    const status = connected.mfaRequired ? "mfa_required" : "connected";
    const storedAuth = connected.mfaRequired ? connected.pending : connected.auth;
    await db.insert(garminConnections).values({
      userId: user.id,
      garminUsername: username,
      garminDisplayName: null,
      encryptedTokens: encryptGarminTokens(storedAuth),
      encryptedPassword,
      rememberMe,
      status,
      lastError: null,
      activeJobId: null,
      activeWorkerToken: null,
      activeJobLeaseExpiresAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: garminConnections.userId,
      set: {
        garminUsername: username,
        garminDisplayName: null,
        encryptedTokens: encryptGarminTokens(storedAuth),
        encryptedPassword,
        rememberMe,
        status,
        lastError: null,
        activeJobId: null,
        activeWorkerToken: null,
        activeJobLeaseExpiresAt: null,
        updatedAt: now,
      },
    });
    lockedConnectionId = null;

    if (connected.mfaRequired) {
      return NextResponse.json({
        connected: false,
        mfaRequired: true,
        mfaMethod: connected.pending.method,
      }, { status: 202 });
    }
    return NextResponse.json({ connected: true });
  } catch (error) {
    if (lockedConnectionId) {
      await releaseLease(lockedConnectionId);
    }
    console.error("Failed to connect Garmin:", error);
    const rawMessage = error instanceof Error ? error.message : "";
    const message = rawMessage.includes("GARMIN_TOKEN_ENCRYPTION_KEY")
      ? rawMessage
      : rawMessage.toLowerCase().includes("mfa")
        ? "Garmin verification failed. Request a new code and try again."
        : "Garmin sign-in failed. Check your email and password, then try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    await db.delete(garminConnections).where(eq(garminConnections.userId, user.id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to disconnect Garmin:", error);
    return NextResponse.json({ error: "Failed to disconnect Garmin" }, { status: 500 });
  }
}
