// ============================================================
// EnduroLab — Save Plan API Route
// ============================================================
// POST /api/plan/save — persist a generated plan to the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { randomUUID } from "crypto";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { getCurrentUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPersistedPlanId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();

    const { id, runnerProfile, planData, peakMileageOverride, weeksOverride, raceName } = body;
    const persistedId = isPersistedPlanId(id) ? id : randomUUID();
    let isUpdatingExistingPlan = false;

    if (isPersistedPlanId(id)) {
      const [existingPlan] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, persistedId), eq(plans.userId, user.id)))
        .limit(1);

      if (!existingPlan) {
        const [planWithId] = await db
          .select({ id: plans.id })
          .from(plans)
          .where(eq(plans.id, persistedId))
          .limit(1);

        if (planWithId) {
          return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }
      }

      isUpdatingExistingPlan = !!existingPlan;
    }

    const normalizedRunnerProfile = {
      ...runnerProfile,
      raceName: raceName || runnerProfile.raceName || undefined,
    };
    const paceZones = calculatePaceZones(normalizedRunnerProfile);
    const persistedPlanData = {
      ...planData,
      id: persistedId,
      runnerProfile: normalizedRunnerProfile,
      paceZones,
      powerZones: calculatePowerZones(normalizedRunnerProfile, paceZones),
    };

    if (isUpdatingExistingPlan) {
      await db
        .update(plans)
        .set({
          runnerProfile: normalizedRunnerProfile,
          planData: persistedPlanData,
          peakMileageOverride,
          weeksOverride,
          raceName,
          updatedAt: new Date(),
        })
        .where(and(eq(plans.id, persistedId), eq(plans.userId, user.id)));
    } else {
      await db.insert(plans).values({
        id: persistedId,
        userId: user.id,
        runnerProfile: normalizedRunnerProfile,
        planData: persistedPlanData,
        peakMileageOverride,
        weeksOverride,
        raceName,
      });
    }

    return NextResponse.json({ success: true, id: persistedId, planData: persistedPlanData });
  } catch (error) {
    console.error("Failed to save plan:", error);
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
