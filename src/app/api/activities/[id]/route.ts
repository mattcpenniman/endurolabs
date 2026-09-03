// ============================================================
// EnduroLab - Activity Analytics Settings API
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { excludedFromAnalytics?: unknown };
  if (typeof body.excludedFromAnalytics !== "boolean") {
    return NextResponse.json({ error: "excludedFromAnalytics must be a boolean" }, { status: 400 });
  }

  const { id } = await context.params;
  const [updated] = await db.update(runActivities).set({
    excludedFromAnalytics: body.excludedFromAnalytics,
    updatedAt: new Date(),
  }).where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id)))
    .returning({ id: runActivities.id });
  if (!updated) return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  return NextResponse.json({ success: true, excludedFromAnalytics: body.excludedFromAnalytics });
}
