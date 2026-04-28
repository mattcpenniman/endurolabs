// ============================================================
// EnduroLab — Save Plan API Route
// ============================================================
// POST /api/plan/save — persist a generated plan to the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { id, runnerProfile, planData, peakMileageOverride, weeksOverride, raceName } = body;

    // If plan already has an ID, update it; otherwise insert new
    if (id) {
      await db
        .update(plans)
        .set({
          runnerProfile,
          planData,
          peakMileageOverride,
          weeksOverride,
          raceName,
          updatedAt: new Date(),
        })
        .where(eq(plans.id, id));

      return NextResponse.json({ success: true, id });
    }

    const [newPlan] = await db
      .insert(plans)
      .values({
        runnerProfile,
        planData,
        peakMileageOverride,
        weeksOverride,
        raceName,
      })
      .returning({ id: plans.id });

    return NextResponse.json({ success: true, id: newPlan?.id ?? null });
  } catch (error) {
    console.error("Failed to save plan:", error);
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
