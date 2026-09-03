// ============================================================
// EnduroLab - Garmin Job Worker Endpoint
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { garminSyncJobs } from "@/lib/db/schema";
import { processGarminJob } from "@/lib/garmin/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.GARMIN_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const now = new Date();
  const [job] = await db.select({ id: garminSyncJobs.id }).from(garminSyncJobs)
    .where(or(
      and(
        eq(garminSyncJobs.status, "queued"),
        or(isNull(garminSyncJobs.leaseExpiresAt), lte(garminSyncJobs.leaseExpiresAt, now)),
      ),
      and(eq(garminSyncJobs.status, "running"), lte(garminSyncJobs.leaseExpiresAt, now)),
    ))
    .orderBy(asc(garminSyncJobs.createdAt))
    .limit(1);
  if (!job) return NextResponse.json({ processed: false });
  await processGarminJob(job.id);
  return NextResponse.json({ processed: true, jobId: job.id });
}
