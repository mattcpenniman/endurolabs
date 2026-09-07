// ============================================================
// EnduroLab — List Plans API Route
// ============================================================
// GET /api/plan/list — fetch all saved plans from the database.
// ============================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { planRunLogs, plans, runActivities } from "@/lib/db/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import type { MarathonPlan } from "@/lib/training/models";
import { buildPlanListSummaries } from "@/lib/activities/plan-list-summary";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const allPlans = await db
      .select()
      .from(plans)
      .where(eq(plans.userId, user.id))
      .orderBy(desc(plans.createdAt));

    if (allPlans.length === 0) return NextResponse.json([]);

    const normalizedPlans = allPlans.map((plan) => {
      const planData = plan.planData as MarathonPlan;
      const runnerProfile = planData.runnerProfile ?? plan.runnerProfile;

      return {
        ...plan,
        runnerProfile,
        planData: {
          ...planData,
          runnerProfile,
          raceDay: planData.raceDay ?? runnerProfile.raceDate,
        },
      };
    });

    const completedLogs = await db
      .select({
        planId: planRunLogs.planId,
        actualMileage: planRunLogs.actualMileage,
        mergedActivityId: planRunLogs.mergedActivityId,
      })
      .from(planRunLogs)
      .where(and(
        eq(planRunLogs.userId, user.id),
        eq(planRunLogs.completed, 1),
        inArray(planRunLogs.planId, normalizedPlans.map((plan) => plan.id)),
      ));
    const mergedActivityIds = completedLogs
      .map((log) => log.mergedActivityId)
      .filter((id): id is string => id !== null);
    const activityRows = await db
      .select({
        id: runActivities.id,
        planId: runActivities.planId,
        distanceMeters: runActivities.distanceMeters,
        durationSeconds: runActivities.durationSeconds,
        elevationGainMeters: runActivities.elevationGainMeters,
      })
      .from(runActivities)
      .where(and(
        eq(runActivities.userId, user.id),
        eq(runActivities.excludedFromAnalytics, false),
        mergedActivityIds.length > 0
          ? or(
              inArray(runActivities.planId, normalizedPlans.map((plan) => plan.id)),
              inArray(runActivities.id, mergedActivityIds),
            )
          : inArray(runActivities.planId, normalizedPlans.map((plan) => plan.id)),
      ));
    const summaries = buildPlanListSummaries(
      normalizedPlans.map((plan) => ({ id: plan.id, planData: plan.planData })),
      activityRows,
      completedLogs,
    );

    return NextResponse.json(normalizedPlans.map((plan) => ({
      ...plan,
      summary: summaries.get(plan.id),
    })));
  } catch (error) {
    console.error("Failed to list plans:", error);
    return NextResponse.json(
      { error: "Failed to list plans" },
      { status: 500 }
    );
  }
}
