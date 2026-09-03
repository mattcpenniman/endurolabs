// ============================================================
// EnduroLab — Plan Run Logs API Route
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { planRunLogs, plans } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { DailyLog, MarathonPlan } from "@/lib/training/models";
import { isWeekFullyLogged } from "@/lib/training/progress-tracker";
import { reconcileManualActivityMerges } from "@/lib/activities/manual-merge-persistence";

function serializeLog(row: typeof planRunLogs.$inferSelect): DailyLog {
  return {
    weekNumber: row.weekNumber,
    date: row.date,
    dayOfWeek: row.dayOfWeek,
    runId: row.runId,
    plannedWorkoutId: row.plannedWorkoutId,
    mergedActivityId: row.mergedActivityId,
    garminDistance: row.garminDistance === null ? null : row.garminDistance / 100,
    garminVariance: row.garminVariance === null ? null : row.garminVariance / 100,
    garminValidationStatus:
      row.garminValidationStatus === "validated" || row.garminValidationStatus === "variance"
        ? row.garminValidationStatus
        : null,
    runTitle: row.runTitle ?? undefined,
    isAdditionalRun: row.isAdditionalRun === 1,
    actualMileage: row.actualMileage / 100,
    completed: row.completed === 1,
    feelRating: row.feelRating,
    notes: row.notes,
    loggedAt: row.loggedAt.toISOString(),
  };
}

async function verifyPlanAccess(planId: string, userId: string): Promise<boolean> {
  const [plan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);

  return Boolean(plan);
}

async function isLockedWeek(planId: string, userId: string, weekNumber: number): Promise<boolean> {
  const [plan] = await db
    .select({ planData: plans.planData })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);
  const week = (plan?.planData as MarathonPlan | undefined)?.weeks.find(
    (candidate) => candidate.weekNumber === weekNumber
  );
  if (!week) return false;

  const rows = await db
    .select()
    .from(planRunLogs)
    .where(and(
      eq(planRunLogs.planId, planId),
      eq(planRunLogs.userId, userId),
      eq(planRunLogs.weekNumber, weekNumber)
    ));

  return isWeekFullyLogged(week, rows.map(serializeLog));
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    if (!(await verifyPlanAccess(id, user.id))) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(planRunLogs)
      .where(and(eq(planRunLogs.planId, id), eq(planRunLogs.userId, user.id)))
      .orderBy(asc(planRunLogs.weekNumber), asc(planRunLogs.date), asc(planRunLogs.createdAt));

    return NextResponse.json(rows.map(serializeLog));
  } catch (error) {
    console.error("Failed to fetch plan run logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    if (!(await verifyPlanAccess(id, user.id))) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const log = (await request.json()) as DailyLog;
    if (!Number.isFinite(log.weekNumber)) {
      return NextResponse.json({ error: "Invalid week number" }, { status: 400 });
    }
    if (await isLockedWeek(id, user.id, log.weekNumber)) {
      return NextResponse.json({ error: "Week is fully logged and locked" }, { status: 409 });
    }
    const actualMileage = Math.max(0, Math.round(log.actualMileage * 100));
    const timestamp = new Date(log.loggedAt);

    await db
      .insert(planRunLogs)
      .values({
        userId: user.id,
        planId: id,
        weekNumber: log.weekNumber,
        date: log.date,
        dayOfWeek: log.dayOfWeek,
        runId: log.runId,
        plannedWorkoutId: log.plannedWorkoutId ?? null,
        runTitle: log.runTitle ?? null,
        isAdditionalRun: log.isAdditionalRun ? 1 : 0,
        actualMileage,
        completed: log.completed ? 1 : 0,
        feelRating: log.feelRating,
        notes: log.notes ?? "",
        loggedAt: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [planRunLogs.planId, planRunLogs.weekNumber, planRunLogs.dayOfWeek, planRunLogs.runId],
        set: {
          date: log.date,
          dayOfWeek: log.dayOfWeek,
          plannedWorkoutId: log.plannedWorkoutId ?? null,
          runTitle: log.runTitle ?? null,
          isAdditionalRun: log.isAdditionalRun ? 1 : 0,
          actualMileage,
          completed: log.completed ? 1 : 0,
          feelRating: log.feelRating,
          notes: log.notes ?? "",
          mergedActivityId: null,
          mergedAt: null,
          garminDistance: null,
          garminVariance: null,
          garminValidationStatus: null,
          loggedAt: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
          updatedAt: new Date(),
        },
      });

    await reconcileManualActivityMerges(user.id, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to save plan run log:", error);
    return NextResponse.json({ error: "Failed to save log" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    if (!(await verifyPlanAccess(id, user.id))) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const runId = request.nextUrl.searchParams.get("runId");
    const weekNumber = Number(request.nextUrl.searchParams.get("weekNumber"));
    const dayOfWeek = request.nextUrl.searchParams.get("dayOfWeek");

    if (!runId || !dayOfWeek || !Number.isFinite(weekNumber)) {
      return NextResponse.json({ error: "Missing log identifiers" }, { status: 400 });
    }

    if (await isLockedWeek(id, user.id, weekNumber)) {
      return NextResponse.json({ error: "Week is fully logged and locked" }, { status: 409 });
    }

    await db
      .delete(planRunLogs)
      .where(
        and(
          eq(planRunLogs.planId, id),
          eq(planRunLogs.userId, user.id),
          eq(planRunLogs.weekNumber, weekNumber),
          eq(planRunLogs.dayOfWeek, dayOfWeek),
          eq(planRunLogs.runId, runId)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete plan run log:", error);
    return NextResponse.json({ error: "Failed to delete log" }, { status: 500 });
  }
}
