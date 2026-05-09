// ============================================================
// EnduroLab — Get Plan by ID API Route
// ============================================================
// GET /api/plan/[id] — fetch a saved plan from the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { MarathonPlan, RunnerProfile } from "@/lib/training/models";
import { getCurrentUser } from "@/lib/auth";

function getOrigin(request: NextRequest): string {
  const configuredUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");

  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return request.nextUrl.origin;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;

    const [plan] = await db
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.userId, user.id)));

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
      shareUrl: plan.shareToken ? `${getOrigin(request)}/share/${plan.shareToken}` : null,
    });
  } catch (error) {
    console.error("Failed to fetch plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as { archived?: boolean };
    const archivedAt = body.archived ? new Date() : null;

    const [updatedPlan] = await db
      .update(plans)
      .set({ archivedAt, updatedAt: new Date() })
      .where(and(eq(plans.id, id), eq(plans.userId, user.id)))
      .returning({ id: plans.id });

    if (!updatedPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, id, archivedAt });
  } catch (error) {
    console.error("Failed to update plan:", error);
    return NextResponse.json({ error: "Failed to update plan" }, { status: 500 });
  }
}
