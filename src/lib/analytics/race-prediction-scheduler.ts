// ============================================================
// EnduroLab - Race Prediction Snapshot Scheduler
// ============================================================

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans, racePredictionSnapshots, users } from "@/lib/db/schema";
import type { RunnerProfile } from "@/lib/training/models";
import { buildRacePredictorResponse } from "./race-predictor";
import { buildRacePredictionSnapshotValues } from "./race-prediction-snapshots";
import { loadRaceEvidence } from "@/lib/races/evidence";

const FIXED_HORIZONS = new Set([84, 28, 7, 1]);
const DAY_MS = 86_400_000;

interface SnapshotPlan {
  id: string;
  userId: string;
  raceName: string | null;
  runnerProfile: RunnerProfile;
}

function horizonDays(predictionDate: string, targetDate: string): number {
  return Math.round((Date.parse(`${targetDate}T00:00:00Z`) - Date.parse(`${predictionDate}T00:00:00Z`)) / DAY_MS);
}

export function isFixedRacePredictionHorizon(predictionDate: string, targetDate: string): boolean {
  return FIXED_HORIZONS.has(horizonDays(predictionDate, targetDate));
}

function targetDistanceMeters(profile: RunnerProfile): number {
  if (profile.raceDistance === "5k") return 5000;
  if (profile.raceDistance === "10k") return 10_000;
  if (profile.raceDistance === "half_marathon") return 21_097.5;
  return 42_195;
}

async function issueForPlan(plan: SnapshotPlan, predictionAt: Date): Promise<string | null> {
  const predictionDate = predictionAt.toISOString().slice(0, 10);
  const distanceMeters = targetDistanceMeters(plan.runnerProfile);
  const evidence = await loadRaceEvidence(plan.userId, predictionDate);
  const response = buildRacePredictorResponse({
    races: evidence.races,
    asOf: predictionDate,
    distances: [{ key: "scheduled", label: plan.raceName ?? "Scheduled race", distanceMeters }],
    sourceCoverage: evidence.sourceCoverage,
  });
  const prediction = response.predictions[0];
  if (!prediction) return null;
  const [snapshot] = await db.insert(racePredictionSnapshots).values(buildRacePredictionSnapshotValues({
    userId: plan.userId,
    planId: plan.id,
    targetRaceResultId: null,
    targetDate: plan.runnerProfile.raceDate,
    targetDistanceMeters: distanceMeters,
    targetRaceName: plan.raceName ?? plan.runnerProfile.raceName ?? null,
    predictionAt,
    goalSeconds: plan.runnerProfile.goalMarathonTime > 0
      ? Math.round(plan.runnerProfile.goalMarathonTime * 60)
      : null,
    prediction,
    evidence,
  })).onConflictDoNothing().returning({ id: racePredictionSnapshots.id });
  return snapshot?.id ?? null;
}

/** Issues exact 84/28/7/1-day snapshots for every active current plan. */
export async function issueDueRacePredictionSnapshots(predictionAt = new Date()): Promise<{
  duePlans: number;
  issued: number;
}> {
  const predictionDate = predictionAt.toISOString().slice(0, 10);
  const activePlans = await db.select({
    id: plans.id,
    userId: plans.userId,
    raceName: plans.raceName,
    runnerProfile: plans.runnerProfile,
  }).from(plans).innerJoin(users, eq(users.currentPlanId, plans.id))
    .where(isNull(plans.archivedAt));
  const duePlans = activePlans.filter((plan) => {
    const profile = plan.runnerProfile as RunnerProfile;
    return plan.userId !== null && isFixedRacePredictionHorizon(predictionDate, profile.raceDate);
  });
  let issued = 0;
  for (const plan of duePlans) {
    const snapshotId = await issueForPlan({
      ...plan,
      userId: plan.userId as string,
      runnerProfile: plan.runnerProfile as RunnerProfile,
    }, predictionAt);
    if (snapshotId) issued += 1;
  }
  return { duePlans: duePlans.length, issued };
}

/** Issues an auditable ad hoc snapshot for one plan, still idempotent by horizon. */
export async function issueRacePredictionSnapshotForPlan(
  planId: string,
  predictionAt = new Date(),
): Promise<string | null> {
  const [plan] = await db.select({
    id: plans.id,
    userId: plans.userId,
    raceName: plans.raceName,
    runnerProfile: plans.runnerProfile,
  }).from(plans).where(and(eq(plans.id, planId), isNull(plans.archivedAt))).limit(1);
  if (!plan?.userId) throw new Error("Active plan not found");
  return issueForPlan({
    ...plan,
    userId: plan.userId,
    runnerProfile: plan.runnerProfile as RunnerProfile,
  }, predictionAt);
}
