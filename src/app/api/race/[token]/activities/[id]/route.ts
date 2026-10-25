// ============================================================
// EnduroLab - Public Shared Race Detail API
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { downsampleActivitySamples, normalizeActivityCadence } from "@/lib/activities/activity-chart";
import { buildActivitySplitOptions } from "@/lib/activities/activity-splits";
import { buildDynamicsReport } from "@/lib/activities/running-dynamics";
import { loadRunScores } from "@/lib/analytics/run-score-persistence";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; id: string }> },
): Promise<NextResponse> {
  const { token, id } = await context.params;
  const [activity] = await db.select().from(runActivities).where(and(
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
    verticalOscillationCm: activitySamples.verticalOscillationCm,
    verticalRatioPercent: activitySamples.verticalRatioPercent,
    groundContactTimeMs: activitySamples.groundContactTimeMs,
    groundContactBalanceLeftPercent: activitySamples.groundContactBalanceLeftPercent,
    strideLengthCm: activitySamples.strideLengthCm,
  }).from(activitySamples)
    .where(eq(activitySamples.activityId, activity.id))
    .orderBy(asc(activitySamples.elapsedSeconds));

  const splitOptions = buildActivitySplitOptions({
    summaryDistanceMeters: activity.distanceMeters,
    durationSeconds: activity.durationSeconds,
    hasMeasuredPower: !activity.powerSource.startsWith("estimated_"),
    samples,
  });
  const displaySamples = samples.map((sample) => ({
    ...sample,
    cadence: normalizeActivityCadence(sample.cadence),
  }));

  const runScore = (await loadRunScores([activity])).get(id) ?? null;
  return NextResponse.json({ dynamics: buildDynamicsReport(samples, activity.durationSeconds), samples: downsampleActivitySamples(displaySamples), splits: splitOptions.mile, splitOptions, runScore });
}
