// ============================================================
// EnduroLab - Garmin Detail Job API
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections, plans } from "@/lib/db/schema";
import { enqueueGarminJob, processGarminJob } from "@/lib/garmin/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const [connection] = await db.select().from(garminConnections)
    .where(eq(garminConnections.userId, user.id)).limit(1);
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Connect Garmin first" }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    scope?: "recent" | "older" | "all";
    days?: number;
    planId?: string;
  };
  if (body.planId) {
    const [plan] = await db.select({ id: plans.id }).from(plans).where(and(
      eq(plans.id, body.planId),
      eq(plans.userId, user.id),
    )).limit(1);
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  const scope = ["recent", "older", "all"].includes(body.scope ?? "") ? body.scope! : "all";
  const days = Math.min(Math.max(Math.round(body.days ?? 90), 1), 3650);
  const job = await enqueueGarminJob(user.id, connection.id, "detail", {
    scope,
    days,
    through: new Date().toISOString(),
    ...(body.planId ? { planId: body.planId } : {}),
  });
  after(() => processGarminJob(job.id));
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
