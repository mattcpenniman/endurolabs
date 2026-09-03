// ============================================================
// EnduroLab - Garmin Job Status API
// ============================================================

import { after, NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { garminSyncJobs } from "@/lib/db/schema";
import { processGarminJob } from "@/lib/garmin/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await params;
  const [job] = await db.select().from(garminSyncJobs)
    .where(and(eq(garminSyncJobs.id, id), eq(garminSyncJobs.userId, user.id))).limit(1);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (
    (job.status === "queued" && (!job.leaseExpiresAt || job.leaseExpiresAt <= new Date()))
    || (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt <= new Date())
  ) {
    after(() => processGarminJob(job.id));
  }
  return NextResponse.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    total: job.totalItems,
    processed: job.processedItems,
    succeeded: job.succeededItems,
    empty: job.emptyItems,
    failed: job.failedItems,
    samples: job.sampleCount,
    error: job.lastError,
  });
}
