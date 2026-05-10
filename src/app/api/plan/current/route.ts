// ============================================================
// EnduroLab — Current Plan API Route
// ============================================================
// GET /api/plan/current — fetch the signed-in user's current plan id.
// PATCH /api/plan/current — update the signed-in user's current plan id.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans, users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    return NextResponse.json({ currentPlanId: user.currentPlanId });
  } catch (error) {
    console.error("Failed to fetch current plan:", error);
    return NextResponse.json({ error: "Failed to fetch current plan" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = (await request.json()) as { currentPlanId?: string | null };
    const currentPlanId = body.currentPlanId ?? null;

    if (currentPlanId) {
      const [plan] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.id, currentPlanId), eq(plans.userId, user.id)))
        .limit(1);

      if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }
    }

    await db
      .update(users)
      .set({
        currentPlanId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return NextResponse.json({ success: true, currentPlanId });
  } catch (error) {
    console.error("Failed to update current plan:", error);
    return NextResponse.json({ error: "Failed to update current plan" }, { status: 500 });
  }
}
