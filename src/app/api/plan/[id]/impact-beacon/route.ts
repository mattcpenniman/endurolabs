// ============================================================
// EnduroLab — Plan Impact Beacon API Route
// ============================================================
// Returns the plan-vs-actual impact beacon: where the athlete
// stands against the goal-derived plan on the readiness metrics,
// and the largest behind-plan gap the validation table allows to
// be presented as impact. Read-only.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  buildImpactBeacon,
  impactBeaconBaselineWindow,
  planStartDate,
} from "@/lib/analytics/impact-beacon";
import {
  loadImpactBeaconBaselineRuns,
  loadImpactBeaconPlan,
  loadImpactBeaconRuns,
} from "@/lib/analytics/plan-impact-beacon-loader";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const plan = await loadImpactBeaconPlan(user.id, id);
    if (!plan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const asOf = new Date().toISOString().slice(0, 10);
    const planStart = planStartDate(plan);
    const baselineWindow = impactBeaconBaselineWindow(asOf);
    const runs = planStart !== null && planStart > asOf
      ? await loadImpactBeaconBaselineRuns({
          userId: user.id,
          since: baselineWindow.start,
          asOf: baselineWindow.end,
        })
      : await loadImpactBeaconRuns({ userId: user.id, planId: id, asOf });
    const report = buildImpactBeacon({ plan, runs, asOf });
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to build plan impact beacon:", error);
    return NextResponse.json({ error: "Failed to build impact beacon" }, { status: 500 });
  }
}