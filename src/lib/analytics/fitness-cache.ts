// ============================================================
// EnduroLab - Versioned Fitness Snapshot Cache
// ============================================================
// Persists plan-window Power @ HR headlines and refreshes stale
// windows when their underlying activity data changes.
// ============================================================

import "server-only";

import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, fitnessSnapshots, runActivities } from "@/lib/db/schema";
import { ANALYTICS_QUALITY_THRESHOLD } from "@/lib/analytics/activity-quality";
import { ActivitySampleInput, PowerHeartRateModel, PowerSource } from "@/lib/analytics/models";
import { SampleWithActivityStart } from "@/lib/analytics/plan-fitness";
import { analyzePowerAtHeartRate } from "@/lib/analytics/running-fitness";
import { SpeedPowerModel } from "@/lib/analytics/modeled-power";

export const FITNESS_ALGORITHM_VERSION = "power-hr-v1";

interface FitnessSnapshotMetrics {
  model: PowerHeartRateModel | null;
}

export interface FitnessWindow {
  startDate: string;
  endDate: string;
}

export interface FitnessWindowData {
  samples: SampleWithActivityStart[];
  latestDataAt: Date | null;
}

function windowStartTimestamp(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function windowEndTimestamp(date: string): Date {
  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

function timestampDate(timestamp: Date): string {
  return timestamp.toISOString().slice(0, 10);
}

function inclusiveEndDate(exclusiveEnd: Date): string {
  return new Date(exclusiveEnd.getTime() - 1).toISOString().slice(0, 10);
}

export function normalizePowerSource(source: string): PowerSource {
  if (["garmin", "apple", "apple_watch", "stryd", "coros"].includes(source)) {
    return source as PowerSource;
  }
  return "other";
}

export async function loadFitnessWindowData(
  userId: string,
  window: FitnessWindow,
  powerSource: string,
): Promise<FitnessWindowData> {
  const activities = await db.select({
    id: runActivities.id,
    localDate: runActivities.localDate,
    powerSource: runActivities.powerSource,
    qualityScore: runActivities.qualityScore,
    excludedFromAnalytics: runActivities.excludedFromAnalytics,
    updatedAt: runActivities.updatedAt,
  }).from(runActivities).where(and(
    eq(runActivities.userId, userId),
    gte(runActivities.localDate, window.startDate),
    lt(runActivities.localDate, nextDate(window.endDate)),
  ));

  const latestDataAt = activities.reduce<Date | null>(
    (latest, activity) => !latest || activity.updatedAt > latest ? activity.updatedAt : latest,
    null,
  );
  const eligibleActivities = activities.filter((activity) => (
    activity.powerSource === powerSource
      && !activity.excludedFromAnalytics
      && (activity.qualityScore === null || activity.qualityScore >= ANALYTICS_QUALITY_THRESHOLD)
  ));
  if (eligibleActivities.length === 0) return { samples: [], latestDataAt };

  const activityById = new Map(eligibleActivities.map((activity) => [activity.id, activity]));
  const rows = await db.select({
    activityId: activitySamples.activityId,
    elapsedSeconds: activitySamples.elapsedSeconds,
    heartRate: activitySamples.heartRate,
    power: activitySamples.power,
    speedMetersPerSecond: activitySamples.speedMetersPerSecond,
    cadence: activitySamples.cadence,
  }).from(activitySamples)
    .where(inArray(activitySamples.activityId, eligibleActivities.map((activity) => activity.id)))
    .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds));

  return {
    latestDataAt,
    samples: rows.map((row) => ({
      ...row,
      activityStartDate: activityById.get(row.activityId)!.localDate,
    } satisfies SampleWithActivityStart)),
  };
}

/** Load HR/speed traces and model power in memory for explicitly estimated activities. */
export async function loadModeledFitnessWindowData(
  userId: string,
  window: FitnessWindow,
  model: SpeedPowerModel,
): Promise<FitnessWindowData> {
  const activities = await db.select({
    id: runActivities.id,
    localDate: runActivities.localDate,
    updatedAt: runActivities.updatedAt,
  }).from(runActivities).where(and(
    eq(runActivities.userId, userId),
    eq(runActivities.powerSource, "estimated_speed_v1"),
    eq(runActivities.excludedFromAnalytics, false),
    gte(runActivities.localDate, window.startDate),
    lt(runActivities.localDate, nextDate(window.endDate)),
  ));
  if (activities.length === 0) return { samples: [], latestDataAt: null };

  const activityById = new Map(activities.map((activity) => [activity.id, activity]));
  const rows = await db.select({
    activityId: activitySamples.activityId,
    elapsedSeconds: activitySamples.elapsedSeconds,
    heartRate: activitySamples.heartRate,
    speedMetersPerSecond: activitySamples.speedMetersPerSecond,
    cadence: activitySamples.cadence,
  }).from(activitySamples)
    .where(inArray(activitySamples.activityId, activities.map((activity) => activity.id)))
    .orderBy(asc(activitySamples.activityId), asc(activitySamples.elapsedSeconds));

  return {
    latestDataAt: activities.reduce<Date | null>(
      (latest, activity) => !latest || activity.updatedAt > latest ? activity.updatedAt : latest,
      null,
    ),
    samples: rows.map((row) => ({
      ...row,
      power: row.speedMetersPerSecond === null
        ? null
        : model.intercept + model.slope * row.speedMetersPerSecond,
      activityStartDate: activityById.get(row.activityId)!.localDate,
    } satisfies SampleWithActivityStart)),
  };
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export async function getPlanFitnessHeadline(params: {
  userId: string;
  window: FitnessWindow;
  powerSource: string;
  data?: FitnessWindowData;
  force?: boolean;
}): Promise<PowerHeartRateModel | null> {
  const windowStart = windowStartTimestamp(params.window.startDate);
  const windowEnd = windowEndTimestamp(params.window.endDate);
  const data = params.data ?? await loadFitnessWindowData(params.userId, params.window, params.powerSource);
  const [cached] = params.force ? [] : await db.select({
    metrics: fitnessSnapshots.metrics,
    computedAt: fitnessSnapshots.computedAt,
  }).from(fitnessSnapshots).where(and(
    eq(fitnessSnapshots.userId, params.userId),
    eq(fitnessSnapshots.windowStart, windowStart),
    eq(fitnessSnapshots.windowEnd, windowEnd),
    eq(fitnessSnapshots.powerSource, params.powerSource),
    eq(fitnessSnapshots.algorithmVersion, FITNESS_ALGORITHM_VERSION),
  )).limit(1);

  if (cached && (!data.latestDataAt || cached.computedAt >= data.latestDataAt)) {
    return (cached.metrics as FitnessSnapshotMetrics).model;
  }

  const model = data.samples.length > 0
    ? analyzePowerAtHeartRate(
        data.samples as ActivitySampleInput[],
        undefined,
        null,
        normalizePowerSource(params.powerSource),
      )
    : null;
  const now = new Date();
  await db.insert(fitnessSnapshots).values({
    userId: params.userId,
    windowStart,
    windowEnd,
    powerSource: params.powerSource,
    algorithmVersion: FITNESS_ALGORITHM_VERSION,
    metrics: { model } satisfies FitnessSnapshotMetrics,
    computedAt: now,
  }).onConflictDoUpdate({
    target: [
      fitnessSnapshots.userId,
      fitnessSnapshots.windowStart,
      fitnessSnapshots.windowEnd,
      fitnessSnapshots.powerSource,
      fitnessSnapshots.algorithmVersion,
    ],
    set: {
      metrics: { model } satisfies FitnessSnapshotMetrics,
      computedAt: now,
    },
  });
  return model;
}

export async function recomputeFitnessSnapshotsForActivities(
  userId: string,
  activityIds: string[],
): Promise<number> {
  if (activityIds.length === 0) return 0;
  const [activities, snapshots] = await Promise.all([
    db.select({
      localDate: runActivities.localDate,
      powerSource: runActivities.powerSource,
    }).from(runActivities).where(and(
      eq(runActivities.userId, userId),
      inArray(runActivities.id, activityIds),
    )),
    db.select().from(fitnessSnapshots).where(and(
      eq(fitnessSnapshots.userId, userId),
      eq(fitnessSnapshots.algorithmVersion, FITNESS_ALGORITHM_VERSION),
    )),
  ]);

  const affected = snapshots.filter((snapshot) => activities.some((activity) => (
    activity.powerSource === snapshot.powerSource
      && activity.localDate >= timestampDate(snapshot.windowStart)
      && activity.localDate <= inclusiveEndDate(snapshot.windowEnd)
  )));
  await Promise.all(affected.map((snapshot) => getPlanFitnessHeadline({
    userId,
    window: {
      startDate: timestampDate(snapshot.windowStart),
      endDate: inclusiveEndDate(snapshot.windowEnd),
    },
    powerSource: snapshot.powerSource,
    force: true,
  })));
  return affected.length;
}
