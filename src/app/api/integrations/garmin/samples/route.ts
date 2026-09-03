// ============================================================
// EnduroLab - Garmin Detail Sample Sync API
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { and, asc, count, eq, gte, lt } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, runActivities } from "@/lib/db/schema";
import { mapGarminActivityDetail } from "@/lib/garmin/activity-detail";
import { fetchActivityDetail, restoreGarminClient, StoredGarminAuth } from "@/lib/garmin/client";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import { mapWithConcurrency, upsertActivitySamples } from "@/lib/garmin/sample-ingestion";
import { recomputeFitnessSnapshotsForActivities } from "@/lib/analytics/fitness-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SyncSamplesRequest {
  scope?: "recent" | "older" | "all";
  days?: number;
  offset?: number;
  batchSize?: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [connection] = await db.select()
    .from(garminConnections)
    .where(eq(garminConnections.userId, user.id))
    .limit(1);
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Connect Garmin first" }, { status: 409 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as SyncSamplesRequest;
    const scope = body.scope ?? "recent";
    const days = Math.min(Math.max(Math.round(body.days ?? 90), 1), 3650);
    const offset = Math.max(Math.round(body.offset ?? 0), 0);
    const batchSize = Math.min(Math.max(Math.round(body.batchSize ?? 10), 1), 20);
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const windowCondition = scope === "recent"
      ? gte(runActivities.startTimeGmt, cutoff)
      : scope === "older"
        ? lt(runActivities.startTimeGmt, cutoff)
        : undefined;
    const conditions = and(
      eq(runActivities.userId, user.id),
      eq(runActivities.source, "garmin"),
      ...(windowCondition ? [windowCondition] : [])
    );

    const [[totalRow], activities] = await Promise.all([
      db.select({ value: count() }).from(runActivities).where(conditions),
      db.select({
        id: runActivities.id,
        providerActivityId: runActivities.providerActivityId,
        startTimeGmt: runActivities.startTimeGmt,
      })
        .from(runActivities)
        .where(conditions)
        .orderBy(asc(runActivities.startTimeGmt), asc(runActivities.id))
        .limit(batchSize)
        .offset(offset),
    ]);

    const auth = decryptGarminTokens<StoredGarminAuth>(connection.encryptedTokens);
    const client = restoreGarminClient(auth);
    const results = await mapWithConcurrency(activities, 2, async (activity) => {
      try {
        const payload = await fetchActivityDetail(client, activity.providerActivityId);
        const mapped = mapGarminActivityDetail(payload, activity.startTimeGmt);
        const sampleCount = await upsertActivitySamples(activity.id, mapped);
        return { activityId: activity.id, providerActivityId: activity.providerActivityId, sampleCount };
      } catch (error) {
        console.error(`Failed to sync Garmin detail for ${activity.providerActivityId}:`, error);
        return {
          activityId: activity.id,
          providerActivityId: activity.providerActivityId,
          sampleCount: null,
          error: error instanceof Error ? error.message : "Detail sync failed",
        };
      }
    });

    await db.update(garminConnections).set({
      encryptedTokens: encryptGarminTokens({ kind: "session", session: client.getSession() }),
      updatedAt: new Date(),
    }).where(eq(garminConnections.id, connection.id));

    const importedActivityIds = results
      .filter((result) => result.sampleCount !== null && result.sampleCount > 0)
      .map((result) => result.activityId);
    if (importedActivityIds.length > 0) {
      after(async () => {
        try {
          await recomputeFitnessSnapshotsForActivities(user.id, importedActivityIds);
        } catch (error) {
          console.error("Failed to refresh fitness snapshots after detail sync:", error);
        }
      });
    }

    const total = totalRow?.value ?? 0;
    const nextOffset = offset + activities.length;
    return NextResponse.json({
      success: true,
      scope,
      total,
      processed: nextOffset,
      imported: results.filter((result) => result.sampleCount !== null).length,
      failed: results.filter((result) => result.sampleCount === null).length,
      samples: results.reduce((sum, result) => sum + (result.sampleCount ?? 0), 0),
      results,
      nextOffset: nextOffset < total ? nextOffset : null,
    });
  } catch (error) {
    console.error("Failed to sync Garmin detail samples:", error);
    const message = error instanceof Error && error.message.includes("GARMIN_TOKEN_ENCRYPTION_KEY")
      ? error.message
      : "Garmin detail sync failed. Reconnect if Garmin has expired the session.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
