// ============================================================
// EnduroLab - Garmin Historical Summary Job API
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminConnections } from "@/lib/db/schema";
import { enqueueGarminJob, processGarminJob } from "@/lib/garmin/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { since?: string };
  if (!body.since || !/^\d{4}-\d{2}-\d{2}$/.test(body.since) || Number.isNaN(new Date(`${body.since}T00:00:00Z`).getTime())) {
    return NextResponse.json({ error: "A valid since date is required" }, { status: 400 });
  }
  if (body.since > new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: "History date cannot be in the future" }, { status: 400 });
  }
  const [connection] = await db.select().from(garminConnections)
    .where(eq(garminConnections.userId, user.id)).limit(1);
  if (!connection || connection.status !== "connected") {
    return NextResponse.json({ error: "Connect Garmin first" }, { status: 409 });
  }
  const job = await enqueueGarminJob(user.id, connection.id, "history", {
    since: body.since,
    through: new Date().toISOString(),
  });
  after(() => processGarminJob(job.id));
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
}
