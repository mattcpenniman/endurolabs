// ============================================================
// EnduroLab - Garmin Activity Sync API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, eq, notInArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, plans, runActivities } from "@/lib/db/schema";
import { MarathonPlan } from "@/lib/training/models";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import { fetchRecentRuns, restoreGarminClient, StoredGarminAuth } from "@/lib/garmin/client";
import { GarminActivityPayload, matchActivityToPlan, normalizeGarminActivity } from "@/lib/garmin/activities";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [connection] = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, user.id))
    .limit(1);
  if (!connection) return NextResponse.json({ error: "Connect Garmin first" }, { status: 409 });

  try {
    const body = (await request.json().catch(() => ({}))) as { planId?: string; limit?: number };
    const planId = body.planId ?? user.currentPlanId;
    let plan: MarathonPlan | null = null;
    if (planId) {
      const [planRow] = await db
        .select({ planData: plans.planData })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.userId, user.id)))
        .limit(1);
      if (!planRow) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      plan = planRow.planData as MarathonPlan;
      plan.id = planId;
    }

    const auth = decryptGarminTokens<StoredGarminAuth>(connection.encryptedTokens);
    const client = restoreGarminClient(auth);
    const fetched = await fetchRecentRuns(client, body.limit ?? 100);
    const normalized = fetched.map((activity) => normalizeGarminActivity(activity as GarminActivityPayload));
    const fetchedIds = normalized.map((activity) => activity.providerActivityId);
    const preexistingClaims = planId
      ? await db.select({ plannedWorkoutId: runActivities.plannedWorkoutId })
          .from(runActivities)
          .where(and(
            eq(runActivities.userId, user.id),
            eq(runActivities.planId, planId),
            ...(fetchedIds.length > 0 ? [notInArray(runActivities.providerActivityId, fetchedIds)] : [])
          ))
      : [];
    const claimedWorkoutIds = new Set(
      preexistingClaims.map((row) => row.plannedWorkoutId).filter((id): id is string => Boolean(id))
    );
    let matched = 0;

    for (const activity of normalized.reverse()) {
      const match = plan ? matchActivityToPlan(activity, plan, claimedWorkoutIds) : null;
      if (match) {
        claimedWorkoutIds.add(match.plannedWorkoutId);
        matched += 1;
      }
      const now = new Date();
      await db.insert(runActivities).values({
        userId: user.id,
        ...activity,
        planId: match?.planId ?? null,
        weekNumber: match?.weekNumber ?? null,
        dayOfWeek: match?.dayOfWeek ?? null,
        plannedWorkoutId: match?.plannedWorkoutId ?? null,
        matchConfidence: match?.matchConfidence ?? null,
        syncedAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [runActivities.userId, runActivities.providerActivityId],
        set: {
          ...activity,
          planId: match?.planId ?? null,
          weekNumber: match?.weekNumber ?? null,
          dayOfWeek: match?.dayOfWeek ?? null,
          plannedWorkoutId: match?.plannedWorkoutId ?? null,
          matchConfidence: match?.matchConfidence ?? null,
          syncedAt: now,
          updatedAt: now,
        },
      });
    }

    const now = new Date();
    await db.update(garminConnections).set({
      encryptedTokens: encryptGarminTokens({ kind: "session", session: client.getSession() }),
      status: "connected",
      lastSyncAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(garminConnections.id, connection.id));

    return NextResponse.json({ success: true, synced: normalized.length, matched, lastSyncAt: now.toISOString() });
  } catch (error) {
    console.error("Failed to sync Garmin activities:", error);
    const message = error instanceof Error && error.message.includes("GARMIN_TOKEN_ENCRYPTION_KEY")
      ? error.message
      : "Garmin sync failed. Reconnect if Garmin has expired the session.";
    await db.update(garminConnections).set({
      status: "error",
      lastError: message,
      updatedAt: new Date(),
    }).where(eq(garminConnections.id, connection.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
