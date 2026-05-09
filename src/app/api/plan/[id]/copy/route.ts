// ============================================================
// EnduroLab — Copy Plan API Route
// ============================================================
// POST /api/plan/[id]/copy — duplicate one saved plan for the
// authenticated user.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { MarathonPlan } from "@/lib/training/models";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const [sourcePlan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.userId, user.id)))
      .limit(1);

    if (!sourcePlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const copiedId = randomUUID();
    const sourcePlanData = sourcePlan.planData as MarathonPlan;
    const copiedRaceName = sourcePlan.raceName ? `Copy of ${sourcePlan.raceName}` : "Copied plan";
    const copiedPlanData: MarathonPlan = {
      ...sourcePlanData,
      id: copiedId,
      runnerProfile: {
        ...sourcePlanData.runnerProfile,
        raceName: copiedRaceName,
      },
    };

    await db.insert(plans).values({
      id: copiedId,
      userId: user.id,
      runnerProfile: copiedPlanData.runnerProfile,
      planData: copiedPlanData,
      peakMileageOverride: sourcePlan.peakMileageOverride,
      weeksOverride: sourcePlan.weeksOverride,
      raceName: copiedRaceName,
    });

    return NextResponse.json({ success: true, id: copiedId, planData: copiedPlanData });
  } catch (error) {
    console.error("Failed to copy plan:", error);
    return NextResponse.json({ error: "Failed to copy plan" }, { status: 500 });
  }
}
