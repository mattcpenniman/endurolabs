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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: RunnerProfile = await request.json();

    // Validate required fields
    if (!body.goalMarathonTime || !body.raceDate) {
      return NextResponse.json(
        { error: "goalMarathonTime and raceDate are required" },
        { status: 400 }
      );
    }

    const plan = generatePlan(body);

    return NextResponse.json(plan, { status: 200 });
  } catch (error) {
    console.error("Plan generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate training plan" },
      { status: 500 }
    );
  }
}
