// ============================================================
// EnduroLab - Public Shared Activity Detail API
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, plans, runActivities } from "@/lib/db/schema";
import { downsampleActivitySamples, normalizeActivityCadence } from "@/lib/activities/activity-chart";
import { buildActivityMileSplits } from "@/lib/activities/activity-splits";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
): Promise<NextResponse> {
  const { token, id } = await context.params;
  const [sharedPlan] = await db.select({ id: plans.id })
    .from(plans)
    .where(eq(plans.shareToken, token))
    .limit(1);
  if (!sharedPlan) return NextResponse.json({ error: "Shared plan not found" }, { status: 404 });

  const [activity] = await db.select({
    id: runActivities.id,
    distanceMeters: runActivities.distanceMeters,
    durationSeconds: runActivities.durationSeconds,
    powerSource: runActivities.powerSource,
  }).from(runActivities)
    .where(and(eq(runActivities.id, id), eq(runActivities.planId, sharedPlan.id)))
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
