// ============================================================
// EnduroLab — Save Plan API Route
// ============================================================
// POST /api/plan/save — persist a generated plan to the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { randomUUID } from "crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPersistedPlanId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { id, runnerProfile, planData, peakMileageOverride, weeksOverride, raceName } = body;
    const persistedId = isPersistedPlanId(id) ? id : randomUUID();
    const persistedPlanData = {
      ...planData,
      id: persistedId,
    };

    await db
      .insert(plans)
      .values({
        id: persistedId,
        runnerProfile,
        planData: persistedPlanData,
        peakMileageOverride,
        weeksOverride,
        raceName,
      })
      .onConflictDoUpdate({
        target: plans.id,
        set: {
          runnerProfile,
          planData: persistedPlanData,
          peakMileageOverride,
          weeksOverride,
          raceName,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ success: true, id: persistedId, planData: persistedPlanData });
  } catch (error) {
    console.error("Failed to save plan:", error);
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
