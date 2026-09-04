// ============================================================
// EnduroLab - Public Shared Race Detail API
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { downsampleActivitySamples, normalizeActivityCadence } from "@/lib/activities/activity-chart";
import { buildActivityMileSplits } from "@/lib/activities/activity-splits";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
): Promise<NextResponse> {
  const { token, id } = await context.params;
  const [activity] = await db.select({
    id: runActivities.id,
    distanceMeters: runActivities.distanceMeters,
    durationSeconds: runActivities.durationSeconds,
    powerSource: runActivities.powerSource,
  }).from(runActivities).where(and(
    eq(runActivities.id, id),
    eq(runActivities.shareToken, token),
    eq(runActivities.eventType, "race"),
  )).limit(1);
  if (!activity) return NextResponse.json({ error: "Shared race not found" }, { status: 404 });

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
    .where(eq(activitySamples.activityId, activity.id))
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
