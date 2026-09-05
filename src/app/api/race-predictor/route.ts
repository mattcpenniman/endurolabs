// ============================================================
// EnduroLab - Race Predictor API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { asc, and, eq, lte } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import {
  buildRacePredictorResponse,
  STANDARD_PREDICTION_DISTANCES,
  type RacePredictionDistance,
} from "@/lib/analytics/race-predictor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METERS_PER_MILE = 1609.344;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const asOf = new Date().toISOString().slice(0, 10);
    const customMilesValue = request.nextUrl.searchParams.get("distanceMiles");
    let distances: RacePredictionDistance[] = [...STANDARD_PREDICTION_DISTANCES];
    if (customMilesValue !== null) {
      const customMiles = Number(customMilesValue);
      if (!Number.isFinite(customMiles) || customMiles < 0.5 || customMiles > 100) {
        return NextResponse.json({ error: "Custom distance must be between 0.5 and 100 miles" }, { status: 400 });
      }
      distances = [{
        key: "custom",
        label: `${Math.round(customMiles * 100) / 100} Mile Custom`,
        distanceMeters: customMiles * METERS_PER_MILE,
      }];
    }

    const races = await db.select({
      id: runActivities.id,
      localDate: runActivities.localDate,
      distanceMeters: runActivities.distanceMeters,
      durationSeconds: runActivities.durationSeconds,
      movingDurationSeconds: runActivities.movingDurationSeconds,
      eventType: runActivities.eventType,
      averageHeartRate: runActivities.averageHeartRate,
      averagePower: runActivities.averagePower,
      calculatedPower: runActivities.calculatedPower,
      elevationGainMeters: runActivities.elevationGainMeters,
      excludedFromAnalytics: runActivities.excludedFromAnalytics,
    })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, user.id),
        eq(runActivities.eventType, "race"),
        lte(runActivities.localDate, asOf),
      ))
      .orderBy(asc(runActivities.localDate), asc(runActivities.startTimeGmt));

    return NextResponse.json(buildRacePredictorResponse({ races, asOf, distances }));
  } catch (error) {
    console.error("Failed to build race predictions:", error);
    return NextResponse.json({ error: "Failed to build race predictions" }, { status: 500 });
  }
}
