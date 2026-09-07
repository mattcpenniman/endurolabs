// ============================================================
// EnduroLab - Race Predictor API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { plans, raceResults } from "@/lib/db/schema";
import {
  buildRacePredictorResponse,
  STANDARD_PREDICTION_DISTANCES,
  type RacePredictionDistance,
} from "@/lib/analytics/race-predictor";
import { insertRacePredictionSnapshot } from "@/lib/analytics/race-prediction-snapshots";
import { loadRaceEvidence } from "@/lib/races/evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METERS_PER_MILE = 1609.344;

function predictionDistances(request: NextRequest): RacePredictionDistance[] | null {
  const customMilesValue = request.nextUrl.searchParams.get("distanceMiles");
  if (customMilesValue === null) return [...STANDARD_PREDICTION_DISTANCES];
  const customMiles = Number(customMilesValue);
  if (!Number.isFinite(customMiles) || customMiles < 0.5 || customMiles > 100) return null;
  return [{
    key: "custom",
    label: `${Math.round(customMiles * 100) / 100} Mile Custom`,
    distanceMeters: customMiles * METERS_PER_MILE,
  }];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const asOf = new Date().toISOString().slice(0, 10);
    const distances = predictionDistances(request);
    if (!distances) {
      return NextResponse.json({ error: "Custom distance must be between 0.5 and 100 miles" }, { status: 400 });
    }
    // includeSameDay=true: the product view shows any race you finished *today*,
    // including the one that just happened. Backtests remain strict.
    const evidence = await loadRaceEvidence(user.id, asOf, {
      includeSameDay: true,
      includeTrainingActivities: true,
    });
    return NextResponse.json(buildRacePredictorResponse({
      races: evidence.races,
      activities: [...evidence.trainingActivities, ...evidence.races],
      asOf,
      distances,
      sourceCoverage: evidence.sourceCoverage,
      includeSameDay: true,
    }));
  } catch (error) {
    console.error("Failed to build race predictions:", error);
    return NextResponse.json({ error: "Failed to build race predictions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const targetDate = typeof body.targetDate === "string" ? body.targetDate : "";
    const targetDistanceMeters = typeof body.targetDistanceMeters === "number" ? body.targetDistanceMeters : NaN;
    const predictionAt = new Date();
    const asOf = predictionAt.toISOString().slice(0, 10);
    const parsedTargetDate = new Date(`${targetDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)
      || Number.isNaN(parsedTargetDate.getTime())
      || parsedTargetDate.toISOString().slice(0, 10) !== targetDate
      || targetDate < asOf) {
      return NextResponse.json({ error: "targetDate must be today or a future YYYY-MM-DD date" }, { status: 400 });
    }
    if (!Number.isFinite(targetDistanceMeters) || targetDistanceMeters < 0.5 * METERS_PER_MILE || targetDistanceMeters > 100 * METERS_PER_MILE) {
      return NextResponse.json({ error: "Target distance must be between 0.5 and 100 miles" }, { status: 400 });
    }

    const planId = typeof body.planId === "string" ? body.planId : null;
    const targetRaceResultId = typeof body.targetRaceResultId === "string" ? body.targetRaceResultId : null;
    const [ownedPlan, ownedTarget] = await Promise.all([
      planId ? db.select({ id: plans.id }).from(plans)
        .where(and(eq(plans.id, planId), eq(plans.userId, user.id))).limit(1) : Promise.resolve([]),
      targetRaceResultId ? db.select({ id: raceResults.id }).from(raceResults)
        .where(and(eq(raceResults.id, targetRaceResultId), eq(raceResults.userId, user.id))).limit(1) : Promise.resolve([]),
    ]);
    if (planId && ownedPlan.length === 0) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (targetRaceResultId && ownedTarget.length === 0) return NextResponse.json({ error: "Target race not found" }, { status: 404 });

    const evidence = await loadRaceEvidence(user.id, asOf);
    const response = buildRacePredictorResponse({
      races: evidence.races,
      asOf,
      distances: [{
        key: typeof body.key === "string" ? body.key : "snapshot",
        label: typeof body.label === "string" ? body.label.slice(0, 255) : "Race forecast",
        distanceMeters: targetDistanceMeters,
      }],
      sourceCoverage: evidence.sourceCoverage,
    });
    const prediction = response.predictions[0];
    if (!prediction) return NextResponse.json({ error: "Race history is required" }, { status: 422 });
    const snapshotId = await insertRacePredictionSnapshot({
      userId: user.id,
      planId,
      targetRaceResultId,
      targetDate,
      targetDistanceMeters,
      targetRaceName: typeof body.targetRaceName === "string" ? body.targetRaceName.trim().slice(0, 255) || null : null,
      predictionAt,
      goalSeconds: typeof body.goalSeconds === "number" && body.goalSeconds > 0 ? Math.round(body.goalSeconds) : null,
      prediction,
      evidence,
    });
    return NextResponse.json({ snapshotId, prediction, issuedAt: predictionAt.toISOString() }, { status: 201 });
  } catch (error) {
    console.error("Failed to issue race prediction:", error);
    return NextResponse.json({ error: "Failed to issue race prediction" }, { status: 500 });
  }
}
