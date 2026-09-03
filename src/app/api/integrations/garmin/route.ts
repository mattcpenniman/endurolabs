// ============================================================
// EnduroLab - Garmin Connection API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, plans, runActivities } from "@/lib/db/schema";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import { completeGarminMfa, loginToGarmin, PendingGarminLogin, StoredGarminAuth } from "@/lib/garmin/client";
import { RunActivity } from "@/lib/activities/models";

export const runtime = "nodejs";

function serializeActivity(row: typeof runActivities.$inferSelect): RunActivity {
  const distanceMiles = row.distanceMeters / 1609.344;
  return {
    id: row.id,
    providerActivityId: row.providerActivityId,
    source: row.source,
    powerSource: row.powerSource,
    activityName: row.activityName,
    activityType: row.activityType,
    localDate: row.localDate,
    startTimeLocal: row.startTimeLocal,
    startTimeGmt: row.startTimeGmt.toISOString(),
    distanceMiles: Math.round(distanceMiles * 100) / 100,
    durationSeconds: row.durationSeconds,
    movingDurationSeconds: row.movingDurationSeconds,
    averagePaceMinutesPerMile: distanceMiles > 0 ? row.durationSeconds / 60 / distanceMiles : null,
    elevationGainMeters: row.elevationGainMeters,
    averageHeartRate: row.averageHeartRate,
    maxHeartRate: row.maxHeartRate,
    averageCadence: row.averageCadence,
    averagePower: row.averagePower,
    calories: row.calories,
    deviceName: row.deviceName,
    planId: row.planId,
    weekNumber: row.weekNumber,
    dayOfWeek: row.dayOfWeek,
    plannedWorkoutId: row.plannedWorkoutId,
    matchConfidence: row.matchConfidence as RunActivity["matchConfidence"],
    qualityScore: row.qualityScore,
    excludedFromAnalytics: row.excludedFromAnalytics,
    sampleCount: row.sampleCount,
    samplesFetchedAt: row.samplesFetchedAt?.toISOString() ?? null,
    detailFetchStatus: row.detailFetchStatus,
    detailLastError: row.detailLastError,
    syncedAt: row.syncedAt.toISOString(),
  };
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
      lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
      lastError: connection?.lastError ?? null,
      activities: activities.map(serializeActivity),
    });
  } catch (error) {
    console.error("Failed to load Garmin integration:", error);
    return NextResponse.json({ error: "Failed to load Garmin integration" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const workerToken = randomUUID();
  let lockedConnectionId: string | null = null;
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const body = (await request.json()) as { username?: string; password?: string; mfaCode?: string };

    if (body.mfaCode) {
      const [pendingConnection] = await db
        .select()
        .from(garminConnections)
        .where(and(eq(garminConnections.userId, user.id), eq(garminConnections.status, "mfa_required")))
        .limit(1);
      if (!pendingConnection) {
        return NextResponse.json({ error: "Start Garmin sign-in again before entering a verification code" }, { status: 409 });
      }
      const stored = decryptGarminTokens<StoredGarminAuth>(pendingConnection.encryptedTokens);
      if (stored.kind !== "mfa") {
        return NextResponse.json({ error: "Garmin verification session expired; start sign-in again" }, { status: 409 });
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
      const completed = await completeGarminMfa(stored as PendingGarminLogin, body.mfaCode.trim());
      await db.update(garminConnections).set({
        encryptedTokens: encryptGarminTokens(completed.auth),
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
      await db.update(garminConnections).set({
        activeJobId: null,
        activeWorkerToken: null,
        activeJobLeaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(garminConnections.id, lockedConnectionId),
        eq(garminConnections.activeWorkerToken, workerToken),
      ));
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
