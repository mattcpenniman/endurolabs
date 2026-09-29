// ============================================================
// EnduroLab — Apply Power Zone Defaults to the Current Plan
// ============================================================
// Profile-level power anchors are applied to the signed-in
// user's current plan: the plan's runner profile gets the
// anchors and its pace/power zones are recomputed, so the
// impact beacon and power targets use them immediately.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { normalizePlanData } from "@/lib/analytics/race-analysis-loader";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import {
  applyPowerZoneDefaults,
  type PowerZoneDefaults,
} from "@/lib/training/power-anchors";
import type { MarathonPlan } from "@/lib/training/models";

export interface ApplyPowerZoneDefaultsResult {
  updated: boolean;
}

/**
 * Writes the anchors into the current plan's runner profile and recomputes
 * its pace and power zones. Returns `updated: false` when the user has no
 * current plan (or it no longer exists); the stored defaults still apply to
 * future plans.
 */
export async function applyPowerZoneDefaultsToCurrentPlan(input: {
  userId: string;
  planId: string | null;
  defaults: PowerZoneDefaults;
}): Promise<ApplyPowerZoneDefaultsResult> {
  if (!input.planId) return { updated: false };

  const [row] = await db.select({ planData: plans.planData })
    .from(plans)
    .where(and(eq(plans.id, input.planId), eq(plans.userId, input.userId)))
    .limit(1);
  const plan = normalizePlanData(row?.planData);
  if (!plan) return { updated: false };

  const runnerProfile = applyPowerZoneDefaults(plan.runnerProfile, input.defaults);
  const paceZones = calculatePaceZones(runnerProfile);
  const planData: MarathonPlan = {
    ...plan,
    runnerProfile,
    paceZones,
    powerZones: calculatePowerZones(runnerProfile, paceZones),
  };

  await db.update(plans)
    .set({ runnerProfile, planData, updatedAt: new Date() })
    .where(and(eq(plans.id, input.planId), eq(plans.userId, input.userId)));

  return { updated: true };
}