// ============================================================
// EnduroLab - Activity Detail and Analytics Settings API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { downsampleActivitySamples, normalizeActivityCadence } from "@/lib/activities/activity-chart";
import { buildActivityMileSplits } from "@/lib/activities/activity-splits";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  const [activity] = await db.select({
    id: runActivities.id,
    distanceMeters: runActivities.distanceMeters,
    durationSeconds: runActivities.durationSeconds,
    powerSource: runActivities.powerSource,
  })
    .from(runActivities)
    .where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id)))
    .limit(1);
  if (!activity) return NextResponse.json({ error: "Activity not found" }, { status: 404 });

  const samples = await db.select({
    elapsedSeconds: activitySamples.elapsedSeconds,
    heartRate: activitySamples.heartRate,
    power: activitySamples.power,
    cadence: activitySamples.cadence,
    speedMetersPerSecond: activitySamples.speedMetersPerSecond,
    latitude: activitySamples.latitude,
    longitude: activitySamples.longitude,
    elevationMeters: activitySamples.elevationMeters,
    temperatureCelsius: activitySamples.temperatureCelsius,
  }).from(activitySamples)
    .where(eq(activitySamples.activityId, id))
    .orderBy(asc(activitySamples.elapsedSeconds));

  const splits = buildActivityMileSplits({
    summaryDistanceMeters: activity.distanceMeters,
    durationSeconds: activity.durationSeconds,
    hasMeasuredPower: !activity.powerSource.startsWith("estimated_"),
    samples,
  });

  const displaySamples = samples.map((sample) => ({
    ...sample,
    cadence: normalizeActivityCadence(sample.cadence),
  }));

  return NextResponse.json({ samples: downsampleActivitySamples(displaySamples), splits });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    excludedFromAnalytics?: unknown;
    predictionExcluded?: unknown;
    raceClassification?: unknown;
    raceNotes?: unknown;
  };
  const classifications = new Set(["official", "training_race", "pacing_duty", "bad_gps"]);
  const hasAnalyticsSetting = typeof body.excludedFromAnalytics === "boolean";
  const hasPredictionSetting = typeof body.predictionExcluded === "boolean";
  const hasRaceClassification = typeof body.raceClassification === "string"
    && classifications.has(body.raceClassification);
  if (!hasAnalyticsSetting && !hasPredictionSetting && !hasRaceClassification) {
    return NextResponse.json({ error: "A valid analytics setting or raceClassification is required" }, { status: 400 });
  }

  const { id } = await context.params;
  const raceClassification = hasRaceClassification ? body.raceClassification as string : undefined;
  const excludedFromAnalytics = hasAnalyticsSetting
    ? body.excludedFromAnalytics as boolean
    : raceClassification === "bad_gps" ? true : undefined;
  const predictionExcluded = hasPredictionSetting
    ? body.predictionExcluded as boolean
    : raceClassification ? raceClassification !== "official" : undefined;
  const [updated] = await db.update(runActivities).set({
    excludedFromAnalytics,
    predictionExcluded,
    ...(raceClassification ? {
      raceClassification,
      raceNotes: typeof body.raceNotes === "string" ? body.raceNotes.trim().slice(0, 2000) || null : null,
    } : {}),
    updatedAt: new Date(),
  }).where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id)))
    .returning({ id: runActivities.id });
  if (!updated) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  return NextResponse.json({ success: true, excludedFromAnalytics, predictionExcluded, raceClassification });
}
