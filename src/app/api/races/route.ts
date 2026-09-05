// ============================================================
// EnduroLab - Race Activity API
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { raceResults, runActivities } from "@/lib/db/schema";
import { serializeRunActivity } from "@/lib/activities/serialize";
import { parseNewRaceResult } from "@/lib/races/results";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const [races, officialResults] = await Promise.all([
      db.select()
        .from(runActivities)
        .where(and(eq(runActivities.userId, user.id), eq(runActivities.eventType, "race")))
        .orderBy(desc(runActivities.startTimeGmt)),
      db.select()
        .from(raceResults)
        .where(eq(raceResults.userId, user.id))
        .orderBy(desc(raceResults.raceDate), desc(raceResults.createdAt)),
    ]);

    return NextResponse.json({ races: races.map(serializeRunActivity), officialResults });
  } catch (error) {
    console.error("Failed to load race activities:", error);
    return NextResponse.json({ error: "Failed to load race activities" }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    let result;
    try {
      result = parseNewRaceResult(await request.json().catch(() => null));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid race result" }, { status: 400 });
    }
    if (result.linkedActivityId) {
      const linkedActivity = await db.select({ id: runActivities.id })
        .from(runActivities)
        .where(and(eq(runActivities.id, result.linkedActivityId), eq(runActivities.userId, user.id)))
        .limit(1);
      if (linkedActivity.length === 0) return NextResponse.json({ error: "Linked activity not found" }, { status: 404 });
    }
    const [created] = await db.insert(raceResults).values({ userId: user.id, ...result }).returning();
    return NextResponse.json({ result: created }, { status: 201 });
  } catch (error) {
    console.error("Failed to save race result:", error);
    return NextResponse.json({ error: "Failed to save race result" }, { status: 500 });
  }
}
