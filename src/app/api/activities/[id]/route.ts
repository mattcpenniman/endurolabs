// ============================================================
// EnduroLab - Activity Detail and Analytics Settings API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { activitySamples, runActivities } from "@/lib/db/schema";
import { downsampleActivitySamples } from "@/lib/activities/activity-chart";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await context.params;
  const [activity] = await db.select({ id: runActivities.id })
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

  return NextResponse.json({ samples: downsampleActivitySamples(samples) });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { excludedFromAnalytics?: unknown };
  if (typeof body.excludedFromAnalytics !== "boolean") {
    return NextResponse.json({ error: "excludedFromAnalytics must be a boolean" }, { status: 400 });
  }

  const { id } = await context.params;
  const [updated] = await db.update(runActivities).set({
    excludedFromAnalytics: body.excludedFromAnalytics,
    updatedAt: new Date(),
  }).where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id)))
    .returning({ id: runActivities.id });
  if (!updated) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  return NextResponse.json({ success: true, excludedFromAnalytics: body.excludedFromAnalytics });
}
