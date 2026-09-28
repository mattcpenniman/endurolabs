// ============================================================
// EnduroLab - Activity Analytics Summary Persistence
// ============================================================

import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  activityAnalytics,
  activityMetricWindows,
  activitySamples,
  runActivities,
} from "@/lib/db/schema";
import { ACTIVITY_ANALYTICS_VERSION, summarizeActivitySamples } from "@/lib/analytics/activity-summary";
import {
  RACE_EXECUTION_VERSION,
  analyzeRaceExecution,
  type RaceExecutionAnalysis,
} from "@/lib/analytics/race-execution";

const INSERT_BATCH_SIZE = 500;

/** Rebuild one activity's current-version summaries idempotently. */
export async function recomputeActivityAnalytics(activityId: string): Promise<number> {
  const [activity, samples] = await Promise.all([
    db.select({
      sampleCount: runActivities.sampleCount,
      samplesFetchedAt: runActivities.samplesFetchedAt,
    }).from(runActivities).where(eq(runActivities.id, activityId)).limit(1).then((rows) => rows[0]),
    db.select({
      activityId: activitySamples.activityId,
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
      elevationMeters: activitySamples.elevationMeters,
      cadence: activitySamples.cadence,
      latitude: activitySamples.latitude,
      longitude: activitySamples.longitude,
    }).from(activitySamples)
      .where(eq(activitySamples.activityId, activityId))
      .orderBy(asc(activitySamples.elapsedSeconds)),
  ]);
  if (!activity) throw new Error("Run activity not found");
  const summary = summarizeActivitySamples(samples);

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${activityId}:${ACTIVITY_ANALYTICS_VERSION}`}))`);
    const now = new Date();
    const [analytics] = await tx.insert(activityAnalytics).values({
      activityId,
      algorithmVersion: ACTIVITY_ANALYTICS_VERSION,
      sourceSampleCount: activity.sampleCount,
      sourceSamplesFetchedAt: activity.samplesFetchedAt,
      metrics: summary.metrics,
      computedAt: now,
    }).onConflictDoUpdate({
      target: [activityAnalytics.activityId, activityAnalytics.algorithmVersion],
      set: {
        sourceSampleCount: activity.sampleCount,
        sourceSamplesFetchedAt: activity.samplesFetchedAt,
        metrics: summary.metrics,
        computedAt: now,
      },
    }).returning({ id: activityAnalytics.id });
    await tx.delete(activityMetricWindows).where(eq(activityMetricWindows.activityAnalyticsId, analytics.id));
    for (let start = 0; start < summary.windows.length; start += INSERT_BATCH_SIZE) {
      await tx.insert(activityMetricWindows).values(summary.windows.slice(start, start + INSERT_BATCH_SIZE).map((window) => ({
        activityAnalyticsId: analytics.id,
        ...window,
      })));
    }
  });
  return summary.windows.length;
}

/** Rebuilds one activity's race-execution analytics idempotently. Non-race
 *  activities clear any stale row instead of storing one. */
export async function recomputeRaceExecution(
  activityId: string,
  options: { dryRun?: boolean } = {},
): Promise<RaceExecutionAnalysis | null> {
  const [activity, samples] = await Promise.all([
    db.select({
      eventType: runActivities.eventType,
      sampleCount: runActivities.sampleCount,
      samplesFetchedAt: runActivities.samplesFetchedAt,
    }).from(runActivities).where(eq(runActivities.id, activityId)).limit(1).then((rows) => rows[0]),
    db.select({
      elapsedSeconds: activitySamples.elapsedSeconds,
      distanceMeters: activitySamples.distanceMeters,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      cadence: activitySamples.cadence,
    }).from(activitySamples)
      .where(eq(activitySamples.activityId, activityId))
      .orderBy(asc(activitySamples.elapsedSeconds)),
  ]);
  if (!activity) throw new Error("Run activity not found");

  const isRace = activity.eventType === "race";
  const analysis = isRace ? analyzeRaceExecution(samples) : null;
  if (options.dryRun) return analysis;

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${activityId}:${RACE_EXECUTION_VERSION}`}))`);
    if (analysis === null) {
      await tx.delete(activityAnalytics).where(and(
        eq(activityAnalytics.activityId, activityId),
        eq(activityAnalytics.algorithmVersion, RACE_EXECUTION_VERSION),
      ));
      return;
    }
    await tx.insert(activityAnalytics).values({
      activityId,
      algorithmVersion: RACE_EXECUTION_VERSION,
      sourceSampleCount: activity.sampleCount,
      sourceSamplesFetchedAt: activity.samplesFetchedAt,
      metrics: { execution: analysis },
      computedAt: now,
    }).onConflictDoUpdate({
      target: [activityAnalytics.activityId, activityAnalytics.algorithmVersion],
      set: {
        sourceSampleCount: activity.sampleCount,
        sourceSamplesFetchedAt: activity.samplesFetchedAt,
        metrics: { execution: analysis },
        computedAt: now,
      },
    });
  });
  return analysis;
}
