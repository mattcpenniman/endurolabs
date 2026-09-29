// ============================================================
// EnduroLab — Generate Plan API Route
// ============================================================
// POST /api/plan/generate
// Accepts a RunnerProfile JSON body and returns a complete
// MarathonPlan with pace zones, weekly schedules, and
// goal feasibility assessment.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { RunnerProfile } from "@/lib/training/models";
import { generatePlan } from "@/lib/training/plan-generator";
import { mergePowerZoneDefaults } from "@/lib/training/power-anchors";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body: RunnerProfile = await request.json();

    // Validate required fields
    if (!body.goalMarathonTime || !body.raceDate) {
      return NextResponse.json(
        { error: "goalMarathonTime and raceDate are required" },
        { status: 400 }
      );
    }

    // Stored profile anchors seed power zones when the runner asked for
    // power in the form but supplied no anchors of their own.
    const profile = mergePowerZoneDefaults(body, user.powerZoneDefaults);
    const plan = generatePlan(profile);

    return NextResponse.json(plan, { status: 200 });
  } catch (error) {
    console.error("Plan generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate training plan" },
      { status: 500 }
    );
  }
}
