// ============================================================
// EnduroLab - Garmin Activity Sync API
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, plans, runActivities } from "@/lib/db/schema";
import { MarathonPlan } from "@/lib/training/models";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import { fetchRunsSince, restoreGarminClient, StoredGarminAuth } from "@/lib/garmin/client";
import { GarminActivityPayload, matchActivityToPlan, normalizeGarminActivity } from "@/lib/garmin/activities";
import { ingestGarminActivityDetail, mapWithConcurrency, recomputeStoredActivityQuality } from "@/lib/garmin/sample-ingestion";
import { recomputeFitnessSnapshotsForActivities } from "@/lib/analytics/fitness-cache";
import { reconcileManualActivityMerges } from "@/lib/activities/manual-merge-persistence";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_TTL_SECONDS = 15 * 60;
const RECENT_DETAIL_DAYS = 90;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [connection] = await db
    .select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, user.id))
    .limit(1);
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Connect Garmin first" }, { status: 409 });
  }

  const workerToken = randomUUID();
  let leaseAcquired = false;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      planId?: string;
      limit?: number;
      detailLimit?: number;
      ttlSeconds?: number;
      force?: boolean;
    };
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

    const nowForLease = new Date();
    const [leasedConnection] = await db.update(garminConnections).set({
      activeWorkerToken: workerToken,
      activeJobLeaseExpiresAt: new Date(nowForLease.getTime() + 5 * 60_000),
      updatedAt: nowForLease,
    }).where(and(
      eq(garminConnections.id, connection.id),
      or(
        isNull(garminConnections.activeWorkerToken),
        lte(garminConnections.activeJobLeaseExpiresAt, nowForLease),
      ),
    )).returning();
    if (!leasedConnection) {
      return NextResponse.json({ error: "Another Garmin import is already running" }, { status: 409 });
    }
    leaseAcquired = true;
    const auth = decryptGarminTokens<StoredGarminAuth>(leasedConnection.encryptedTokens);
    const client = await restoreGarminClient(auth);
    const syncThrough = new Date();
    const ttlSeconds = Math.min(Math.max(Math.round(body.ttlSeconds ?? DEFAULT_TTL_SECONDS), 0), 86_400);
    const summaryIsFresh = !body.force
      && connection.lastSyncAt !== null
      && syncThrough.getTime() - connection.lastSyncAt.getTime() < ttlSeconds * 1000;
    const [latestActivity] = summaryIsFresh ? [] : await db.select({ startTimeGmt: runActivities.startTimeGmt })
      .from(runActivities)
      .where(and(eq(runActivities.userId, user.id), eq(runActivities.source, "garmin")))
      .orderBy(desc(runActivities.startTimeGmt))
      .limit(1);
    const fetched = summaryIsFresh
      ? []
      : await fetchRunsSince(client, latestActivity?.startTimeGmt ?? null, syncThrough, body.limit ?? 400);
    const normalized = fetched.map((activity) => normalizeGarminActivity(activity as GarminActivityPayload));
    const fetchedIds = normalized.map((activity) => activity.providerActivityId);
    const existingActivities = fetchedIds.length > 0
      ? await db.select({
          providerActivityId: runActivities.providerActivityId,
          planId: runActivities.planId,
          weekNumber: runActivities.weekNumber,
          dayOfWeek: runActivities.dayOfWeek,
          plannedWorkoutId: runActivities.plannedWorkoutId,
          matchConfidence: runActivities.matchConfidence,
        })
          .from(runActivities)
          .where(and(
            eq(runActivities.userId, user.id),
            eq(runActivities.source, "garmin"),
            inArray(runActivities.providerActivityId, fetchedIds)
          ))
      : [];
    const existingByProviderId = new Map(
      existingActivities.map((activity) => [activity.providerActivityId, activity])
    );
    const preexistingClaims = planId
      ? await db.select({ plannedWorkoutId: runActivities.plannedWorkoutId })
          .from(runActivities)
          .where(and(
            eq(runActivities.userId, user.id),
            eq(runActivities.source, "garmin"),
            eq(runActivities.planId, planId),
            ...(fetchedIds.length > 0 ? [notInArray(runActivities.providerActivityId, fetchedIds)] : [])
          ))
      : [];
    const claimedWorkoutIds = new Set(
      preexistingClaims.map((row) => row.plannedWorkoutId).filter((id): id is string => Boolean(id))
    );
    let matched = 0;

    for (const activity of [...normalized].reverse()) {
      const match = plan ? matchActivityToPlan(activity, plan, claimedWorkoutIds) : null;
      if (match) {
        claimedWorkoutIds.add(match.plannedWorkoutId);
        matched += 1;
      }
      const existing = existingByProviderId.get(activity.providerActivityId);
      const retained = !match && existing?.planId && existing.planId !== planId ? existing : null;
      const assignment = match ?? retained;
      const now = new Date();
      await db.insert(runActivities).values({
        userId: user.id,
        ...activity,
        planId: assignment?.planId ?? null,
        weekNumber: assignment?.weekNumber ?? null,
        dayOfWeek: assignment?.dayOfWeek ?? null,
        plannedWorkoutId: assignment?.plannedWorkoutId ?? null,
        matchConfidence: assignment?.matchConfidence ?? null,
        syncedAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [runActivities.userId, runActivities.source, runActivities.providerActivityId],
        set: {
          ...activity,
          eventType: sql`coalesce(excluded.event_type, ${runActivities.eventType})`,
          averagePower: sql`coalesce(excluded.average_power, ${runActivities.averagePower})`,
          powerSource: sql`case
            when excluded.average_power is null and ${runActivities.averagePower} is not null
              then ${runActivities.powerSource}
            else excluded.power_source
          end`,
          planId: assignment?.planId ?? null,
          weekNumber: assignment?.weekNumber ?? null,
          dayOfWeek: assignment?.dayOfWeek ?? null,
          plannedWorkoutId: assignment?.plannedWorkoutId ?? null,
          matchConfidence: assignment?.matchConfidence ?? null,
          syncedAt: now,
          updatedAt: now,
        },
      });
    }
    if (normalized.length > 0) await reconcileManualActivityMerges(user.id, planId ?? undefined);

    const detailCutoff = new Date(syncThrough.getTime() - RECENT_DETAIL_DAYS * 86_400_000);
    const detailLimit = Math.min(Math.max(Math.round(body.detailLimit ?? 10), 0), 20);
    const detailActivities = detailLimit > 0 ? await db.select({
      id: runActivities.id,
      providerActivityId: runActivities.providerActivityId,
      startTimeGmt: runActivities.startTimeGmt,
    })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, user.id),
        eq(runActivities.source, "garmin"),
        or(
          isNull(runActivities.detailFetchStatus),
          and(
            eq(runActivities.detailFetchStatus, "failed"),
            or(isNull(runActivities.detailNextRetryAt), lte(runActivities.detailNextRetryAt, syncThrough)),
          ),
        ),
        gte(runActivities.startTimeGmt, detailCutoff),
        lte(runActivities.startTimeGmt, syncThrough)
      ))
      .orderBy(desc(runActivities.startTimeGmt))
      .limit(detailLimit) : [];
    const detailResults = await mapWithConcurrency(
      detailActivities,
      2,
      (activity) => ingestGarminActivityDetail(client, activity),
    );
    const legacyQualityActivities = await db.select({ id: runActivities.id })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, user.id),
        eq(runActivities.source, "garmin"),
        isNotNull(runActivities.samplesFetchedAt),
        isNull(runActivities.qualityScore)
      ))
      .orderBy(desc(runActivities.startTimeGmt))
      .limit(5);
    await mapWithConcurrency(legacyQualityActivities, 2, (activity) => recomputeStoredActivityQuality(activity.id));

    const now = new Date();
    await db.update(garminConnections).set({
      encryptedTokens: encryptGarminTokens({ kind: "session", session: client.getSession() }),
      status: "connected",
      lastSyncAt: summaryIsFresh ? connection.lastSyncAt : now,
      lastError: null,
      activeJobId: null,
      activeWorkerToken: null,
      activeJobLeaseExpiresAt: null,
      updatedAt: now,
    }).where(and(eq(garminConnections.id, connection.id), eq(garminConnections.activeWorkerToken, workerToken)));
    leaseAcquired = false;

    const importedActivityIds = detailResults
      .filter((result) => result.sampleCount !== null && result.sampleCount > 0)
      .map((result) => result.activityId);
    if (importedActivityIds.length > 0) {
      after(async () => {
        try {
          await recomputeFitnessSnapshotsForActivities(user.id, importedActivityIds);
        } catch (error) {
          console.error("Failed to refresh fitness snapshots after Garmin refresh:", error);
        }
      });
    }

    return NextResponse.json({
      success: true,
      skippedByTtl: summaryIsFresh,
      through: syncThrough.toISOString(),
      synced: normalized.length,
      matched,
      details: {
        attempted: detailResults.length,
        imported: detailResults.filter((result) => result.sampleCount !== null).length,
        failed: detailResults.filter((result) => result.sampleCount === null).length,
        samples: detailResults.reduce((sum, result) => sum + (result.sampleCount ?? 0), 0),
        qualityBackfilled: legacyQualityActivities.length,
      },
      lastSyncAt: (summaryIsFresh ? connection.lastSyncAt : now)?.toISOString() ?? null,
    });
  } catch (error) {
    console.error("Failed to sync Garmin activities:", error);
    const message = error instanceof Error && (
      error.message.includes("GARMIN_TOKEN_ENCRYPTION_KEY")
      || error.message.startsWith("Garmin session expired.")
    )
      ? error.message
      : "Garmin sync failed. Reconnect if Garmin has expired the session.";
    await db.update(garminConnections).set({
      status: "error",
      lastError: message,
      ...(leaseAcquired ? { activeJobId: null, activeWorkerToken: null, activeJobLeaseExpiresAt: null } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(garminConnections.id, connection.id),
      ...(leaseAcquired ? [eq(garminConnections.activeWorkerToken, workerToken)] : []),
    ));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
