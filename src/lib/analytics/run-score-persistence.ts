/** Versioned, idempotent run score cache with plan/summary/detail invalidation. */
import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityAnalytics, activitySamples, plans, runActivities } from "@/lib/db/schema";
import { buildRunScore, RUN_SCORE_VERSION, type RunScore } from "./run-score";
import type { MarathonPlan } from "@/lib/training/models";

type ActivityRow = typeof runActivities.$inferSelect;
function normalizePlan(value: unknown): MarathonPlan | null {
  try {
    let decoded = value;
    for (let depth = 0; depth < 2 && typeof decoded === "string"; depth++) decoded = JSON.parse(decoded);
    if (!decoded || typeof decoded !== "object") return null;
    const plan = decoded as MarathonPlan;
    return Array.isArray(plan.weeks) && plan.paceZones && plan.runnerProfile ? plan : null;
  } catch { return null; }
}

/** Batch-load cached scores; rebuild stale entries one trace at a time. */
export async function loadRunScores(rows: ActivityRow[], options: { dryRun?: boolean; force?: boolean } = {}): Promise<Map<string, RunScore>> {
  const result = new Map<string, RunScore>();
  if (!rows.length) return result;
  const planIds = [...new Set(rows.flatMap((row) => row.planId ? [row.planId] : []))];
  const planRows = planIds.length ? await db.select().from(plans).where(inArray(plans.id, planIds)) : [];
  const planMap = new Map(planRows.map((row) => [row.id, { userId: row.userId, plan: normalizePlan(row.planData) }]));
  const cached = await db.select().from(activityAnalytics).where(and(
    inArray(activityAnalytics.activityId, rows.map((row) => row.id)), eq(activityAnalytics.algorithmVersion, RUN_SCORE_VERSION),
  ));
  const cache = new Map(cached.map((row) => [row.activityId, row.metrics as { fingerprint?: string; runScore?: RunScore }]));
  for (const row of rows) {
    const owned = row.planId ? planMap.get(row.planId) : null;
    const plan = owned?.userId === row.userId ? owned.plan : null;
    const workout = plan?.weeks.flatMap((week) => (week.days ?? []).flatMap((day) => [day.workout, day.secondaryWorkout]))
      .find((workout) => workout?.id === row.plannedWorkoutId) ?? null;
    const fingerprint = createHash("sha256").update(JSON.stringify({
      version: RUN_SCORE_VERSION, updated: row.updatedAt, count: row.sampleCount, fetched: row.samplesFetchedAt,
      distance: row.distanceMeters, duration: row.durationSeconds, moving: row.movingDurationSeconds,
      cadence: row.averageCadence, source: row.powerSource, workout, zones: plan?.paceZones,
      power: plan?.powerZones, anchor: plan?.runnerProfile.appleWatchPowerData?.marathonPower,
    })).digest("hex");
    const existing = cache.get(row.id);
    if (!options.force && existing?.fingerprint === fingerprint && existing.runScore?.version === RUN_SCORE_VERSION) {
      result.set(row.id, existing.runScore); continue;
    }
    const samples = await db.select().from(activitySamples).where(eq(activitySamples.activityId, row.id)).orderBy(asc(activitySamples.elapsedSeconds));
    const score = buildRunScore({ ...row, samples, workout, plan });
    if (!options.dryRun) {
      const values = { sourceSampleCount: row.sampleCount, sourceSamplesFetchedAt: row.samplesFetchedAt,
        metrics: { fingerprint, runScore: score }, computedAt: new Date() };
      await db.insert(activityAnalytics).values({ activityId: row.id, algorithmVersion: RUN_SCORE_VERSION, ...values })
        .onConflictDoUpdate({ target: [activityAnalytics.activityId, activityAnalytics.algorithmVersion], set: values });
    }
    result.set(row.id, score);
  }
  return result;
}

export async function recomputeRunScore(activityId: string): Promise<RunScore | null> {
  const rows = await db.select().from(runActivities).where(eq(runActivities.id, activityId));
  return (await loadRunScores(rows, { force: true })).get(activityId) ?? null;
}
