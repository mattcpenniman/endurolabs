// ============================================================
// EnduroLab - Canonical Race Result Corrections API
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { raceResultRevisions, raceResults, runActivities } from "@/lib/db/schema";
import { parseNewRaceResult } from "@/lib/races/results";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;
    const [existing] = await db.select().from(raceResults)
      .where(and(eq(raceResults.id, id), eq(raceResults.userId, user.id))).limit(1);
    if (!existing) return NextResponse.json({ error: "Race result not found" }, { status: 404 });

    let result;
    try {
      result = parseNewRaceResult({ ...existing, ...await request.json().catch(() => null) });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid race result" }, { status: 400 });
    }
    if (result.linkedActivityId) {
      const [linkedActivity, conflictingResult] = await Promise.all([
        db.select({ id: runActivities.id }).from(runActivities)
          .where(and(eq(runActivities.id, result.linkedActivityId), eq(runActivities.userId, user.id))).limit(1),
        db.select({ id: raceResults.id }).from(raceResults).where(and(
          eq(raceResults.linkedActivityId, result.linkedActivityId),
          ne(raceResults.id, id),
        )).limit(1),
      ]);
      if (linkedActivity.length === 0) return NextResponse.json({ error: "Linked activity not found" }, { status: 404 });
      if (conflictingResult.length > 0) return NextResponse.json({ error: "Activity is already linked to another result" }, { status: 409 });
    }
    const updated = await db.transaction(async (transaction) => {
      await transaction.insert(raceResultRevisions).values({
        raceResultId: id,
        userId: user.id,
        previousResult: existing,
      });
      const [corrected] = await transaction.update(raceResults).set({ ...result, updatedAt: new Date() })
        .where(and(eq(raceResults.id, id), eq(raceResults.userId, user.id))).returning();
      if (result.linkedActivityId) {
        await transaction.update(runActivities).set({
          raceClassification: result.classification,
          raceNotes: result.notes,
          predictionExcluded: result.classification !== "official" || result.predictionExcluded,
          excludedFromAnalytics: result.classification === "bad_gps",
          updatedAt: new Date(),
        }).where(and(eq(runActivities.id, result.linkedActivityId), eq(runActivities.userId, user.id)));
      }
      return corrected;
    });
    return NextResponse.json({ result: updated });
  } catch (error) {
    console.error("Failed to correct race result:", error);
    return NextResponse.json({ error: "Failed to correct race result" }, { status: 500 });
  }
}
