// ============================================================
// EnduroLab - Race Activity API
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import { serializeRunActivity } from "@/lib/activities/serialize";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const races = await db.select()
      .from(runActivities)
      .where(and(eq(runActivities.userId, user.id), eq(runActivities.eventType, "race")))
      .orderBy(desc(runActivities.startTimeGmt));

    return NextResponse.json({ races: races.map(serializeRunActivity) });
  } catch (error) {
    console.error("Failed to load race activities:", error);
    return NextResponse.json({ error: "Failed to load race activities" }, { status: 500 });
  }
}
