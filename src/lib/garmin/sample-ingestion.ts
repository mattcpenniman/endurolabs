// ============================================================
// EnduroLab - Garmin Sample Persistence
// ============================================================

import "server-only";

import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { GarminActivitySample } from "@/lib/garmin/activity-detail";
import { mapGarminActivityDetail } from "@/lib/garmin/activity-detail";
import { computeActivityQualityScore } from "@/lib/analytics/activity-quality";
import { recomputeActivityAnalytics } from "@/lib/analytics/activity-summary-persistence";
import { fetchActivityDetail } from "@/lib/garmin/client";
import type { GarminConnectClient } from "garmin-connect-client";

const INSERT_BATCH_SIZE = 500;

export async function upsertActivitySamples(activityId: string, samples: GarminActivitySample[]): Promise<number> {
  const [activity] = await db.select({ durationSeconds: runActivities.durationSeconds })
    .from(runActivities)
    .where(eq(runActivities.id, activityId))
    .limit(1);
  if (!activity) throw new Error("Run activity not found");

  for (let start = 0; start < samples.length; start += INSERT_BATCH_SIZE) {
    const values = samples.slice(start, start + INSERT_BATCH_SIZE).map((sample) => ({ activityId, ...sample }));
    await db.insert(activitySamples).values(values).onConflictDoUpdate({
      target: [activitySamples.activityId, activitySamples.elapsedSeconds],
      set: {
        timestamp: sql`excluded.timestamp`,
        distanceMeters: sql`excluded.distance_meters`,
        heartRate: sql`excluded.heart_rate`,
        power: sql`excluded.power`,
        speedMetersPerSecond: sql`excluded.speed_meters_per_second`,
        elevationMeters: sql`excluded.elevation_meters`,
        grade: sql`excluded.grade`,
        cadence: sql`excluded.cadence`,
        latitude: sql`excluded.latitude`,
        longitude: sql`excluded.longitude`,
        temperatureCelsius: sql`excluded.temperature_celsius`,
      },
    });
  }

  await db.delete(activitySamples).where(and(
    eq(activitySamples.activityId, activityId),
    sql`abs(extract(epoch from (${activitySamples.timestamp} - (select ${runActivities.startTimeGmt} from ${runActivities} where ${runActivities.id} = ${activityId}))) - ${activitySamples.elapsedSeconds}) > 2`
  ));

  const [result] = await db.select({ value: count() })
    .from(activitySamples)
    .where(eq(activitySamples.activityId, activityId));
  const sampleCount = result?.value ?? 0;
  const qualityScore = computeActivityQualityScore(samples, activity.durationSeconds);
  await db.update(runActivities).set({
    sampleCount,
    samplesFetchedAt: new Date(),
    qualityScore,
    detailFetchStatus: sampleCount > 0 ? "success" : "empty",
    detailLastAttemptAt: new Date(),
    detailLastError: null,
    detailNextRetryAt: null,
    updatedAt: new Date(),
  }).where(eq(runActivities.id, activityId));
  await recomputeActivityAnalytics(activityId);
  return sampleCount;
}

export interface DetailIngestionResult {
  activityId: string;
  providerActivityId: string;
  status: "success" | "empty" | "mapper_error" | "failed";
  sampleCount: number | null;
  error: string | null;
}

function rawMetricCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const value = payload as { activityDetailMetrics?: unknown; metrics?: unknown };
  if (Array.isArray(value.activityDetailMetrics)) return value.activityDetailMetrics.length;
  if (value.activityDetailMetrics && typeof value.activityDetailMetrics === "object") {
    const nested = (value.activityDetailMetrics as { metrics?: unknown }).metrics;
    if (Array.isArray(nested)) return nested.length;
  }
  return Array.isArray(value.metrics) ? value.metrics.length : 0;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Detail sync failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 1000);
}

/** Fetch, classify, and persist one Garmin detail response. */
export async function ingestGarminActivityDetail(
  client: GarminConnectClient,
  activity: { id: string; providerActivityId: string; startTimeGmt: Date },
): Promise<DetailIngestionResult> {
  const attemptedAt = new Date();
  await db.update(runActivities).set({
    detailAttemptCount: sql`${runActivities.detailAttemptCount} + 1`,
    detailLastAttemptAt: attemptedAt,
    updatedAt: attemptedAt,
  }).where(eq(runActivities.id, activity.id));

  try {
    const payload = await fetchActivityDetail(client, activity.providerActivityId);
    const samples = mapGarminActivityDetail(payload, activity.startTimeGmt);
    if (samples.length === 0 && rawMetricCount(payload) > 0) {
      const error = "Garmin detail payload contained metrics that the current mapper could not read";
      await db.update(runActivities).set({
        detailFetchStatus: "mapper_error",
        detailLastError: error,
        detailNextRetryAt: null,
        updatedAt: new Date(),
      }).where(eq(runActivities.id, activity.id));
      return { activityId: activity.id, providerActivityId: activity.providerActivityId, status: "mapper_error", sampleCount: null, error };
    }

    const sampleCount = await upsertActivitySamples(activity.id, samples);
    return {
      activityId: activity.id,
      providerActivityId: activity.providerActivityId,
      status: sampleCount > 0 ? "success" : "empty",
      sampleCount,
      error: null,
    };
  } catch (cause) {
    const error = errorMessage(cause);
    const [row] = await db.select({ attempts: runActivities.detailAttemptCount })
      .from(runActivities)
      .where(eq(runActivities.id, activity.id))
      .limit(1);
    const attempts = row?.attempts ?? 1;
    const retryDelayMinutes = Math.min(2 ** Math.max(0, attempts - 1) * 5, 24 * 60);
    await db.update(runActivities).set({
      detailFetchStatus: "failed",
      detailLastError: error,
      detailNextRetryAt: new Date(Date.now() + retryDelayMinutes * 60_000),
      updatedAt: new Date(),
    }).where(eq(runActivities.id, activity.id));
    return { activityId: activity.id, providerActivityId: activity.providerActivityId, status: "failed", sampleCount: null, error };
  }
}

export async function recomputeStoredActivityQuality(activityId: string): Promise<number> {
  const [activity, samples] = await Promise.all([
    db.select({ durationSeconds: runActivities.durationSeconds })
      .from(runActivities)
      .where(eq(runActivities.id, activityId))
      .limit(1)
      .then((rows) => rows[0]),
    db.select({
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
      latitude: activitySamples.latitude,
      longitude: activitySamples.longitude,
    }).from(activitySamples).where(eq(activitySamples.activityId, activityId)),
  ]);
  if (!activity) throw new Error("Run activity not found");
  const qualityScore = computeActivityQualityScore(samples, activity.durationSeconds);
  await db.update(runActivities).set({ qualityScore, updatedAt: new Date() })
    .where(eq(runActivities.id, activityId));
  return qualityScore;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}
