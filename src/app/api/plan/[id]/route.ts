// ============================================================
// EnduroLab — Get Plan by ID API Route
// ============================================================
// GET /api/plan/[id] — fetch a saved plan from the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { MarathonPlan, RunnerProfile } from "@/lib/training/models";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, id));

    if (!plan) {
      return NextResponse.json(
        { error: "Plan not found" },
        { status: 404 }
      );
    }

    const planData = plan.planData as MarathonPlan;
    const runnerProfile = (planData.runnerProfile ?? plan.runnerProfile) as RunnerProfile;
    const paceZones = calculatePaceZones(runnerProfile);

    return NextResponse.json({
      ...plan,
      runnerProfile,
      planData: {
        ...planData,
        runnerProfile,
        paceZones,
        powerZones: calculatePowerZones(runnerProfile, paceZones),
      },
    });
  } catch (error) {
    console.error("Failed to fetch plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}
