// ============================================================
// EnduroLab — Courses Compare API
// ============================================================
// GET /api/courses/compare?target=<courseId>[&reference=<courseId>]
//   Returns elevation profiles, grade distribution, and a
//   plain-language elevation/pace note for the target course
//   against the athlete's stored sample baseline.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { courses, plans, runActivities, activitySamples } from "@/lib/db/schema";
import { MarathonPlan } from "@/lib/training/models";
import {
  buildCourseComparison,
  CourseSeriesInput,
} from "@/lib/courses/comparison";
import {
  ElevationGradeActivityInput,
  ElevationGradeWeekWindow,
} from "@/lib/analytics/elevation-grade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCoursePoints(points: unknown): CourseSeriesInput["points"] {
  const list = Array.isArray(points) ? points : [];
  let cumulative = 0;
  let previous: { latitude: number; longitude: number } | null = null;
  const out: CourseSeriesInput["points"] = [];
  for (const raw of list) {
    const [lat, lon, ele] = Array.isArray(raw) ? raw : [];
    if (!Number.isFinite(lat as number) || !Number.isFinite(lon as number)) continue;
    if (previous !== null) {
      cumulative += haversineMeters(previous, { latitude: lat as number, longitude: lon as number });
    }
    out.push({
      latitude: lat as number,
      longitude: lon as number,
      elevationMeters: Number.isFinite(ele as number) ? (ele as number) : null,
      cumulativeMeters: cumulative,
    });
    previous = { latitude: lat as number, longitude: lon as number };
  }
  return out;
}

function haversineMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000;
  const toRad = (v: number): number => (v * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toElevationSource(value: unknown): "gpx" | "open-elevation" {
  return value === "open-elevation" ? "open-elevation" : "gpx";
}

async function loadAthleteBaseline(userId: string): Promise<{
  activities: ElevationGradeActivityInput[];
  weeks: ElevationGradeWeekWindow[];
}> {
  const planRows = await db
    .select({ id: plans.id, planData: plans.planData })
    .from(plans)
    .where(and(eq(plans.userId, userId), isNull(plans.archivedAt)))
    .orderBy(asc(plans.updatedAt))
    .limit(1);
  const plan = (planRows[0]?.planData as unknown as MarathonPlan | null) ?? null;
  const weeks: ElevationGradeWeekWindow[] = plan
    ? plan.weeks.map((week) => ({
        weekNumber: week.weekNumber,
        startDate: week.startDate.slice(0, 10),
        endDate: (week.days[week.days.length - 1]?.date ?? week.endDate).slice(0, 10),
      }))
    : [
        {
          weekNumber: 1,
          startDate: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10),
          endDate: new Date().toISOString().slice(0, 10),
        },
      ];

  const activityRows = await db
    .select({
      id: runActivities.id,
      localDate: runActivities.localDate,
      distanceMeters: runActivities.distanceMeters,
      sampleCount: runActivities.sampleCount,
    })
    .from(runActivities)
    .where(and(
      eq(runActivities.userId, userId),
      eq(runActivities.excludedFromAnalytics, false),
    ))
    .orderBy(asc(runActivities.localDate))
    .limit(200);
  const eligible = activityRows.filter((row) => row.sampleCount > 0);
  if (eligible.length === 0) return { activities: [], weeks };

  const sampleRows = await db
    .select({
      activityId: activitySamples.activityId,
      elapsedSeconds: activitySamples.elapsedSeconds,
      heartRate: activitySamples.heartRate,
      power: activitySamples.power,
      speedMetersPerSecond: activitySamples.speedMetersPerSecond,
      elevationMeters: activitySamples.elevationMeters,
      latitude: activitySamples.latitude,
      longitude: activitySamples.longitude,
    })
    .from(activitySamples)
    .where(inArray(activitySamples.activityId, eligible.map((row) => row.id)));

  const samplesByActivity = new Map<string, typeof sampleRows>();
  for (const s of sampleRows) {
    const bucket = samplesByActivity.get(s.activityId) ?? [];
    bucket.push(s);
    samplesByActivity.set(s.activityId, bucket);
  }
  const byId = new Map(eligible.map((row) => [row.id, row] as const));

  return {
    weeks,
    activities: eligible
      .map((row) => {
        const list = samplesByActivity.get(row.id) ?? [];
        if (list.length === 0) return null;
        const meta = byId.get(row.id);
        if (!meta) return null;
        return {
          activityId: row.id,
          activityStartDate: meta.localDate,
          summaryDistanceMeters: meta.distanceMeters,
          samples: list.map((s) => ({
            activityId: s.activityId,
            elapsedSeconds: s.elapsedSeconds,
            heartRate: s.heartRate,
            power: s.power,
            speedMetersPerSecond: s.speedMetersPerSecond,
            elevationMeters: s.elevationMeters,
            latitude: s.latitude,
            longitude: s.longitude,
          })),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const targetId = request.nextUrl.searchParams.get("target");
    const referenceId = request.nextUrl.searchParams.get("reference");
    if (!targetId) return NextResponse.json({ error: "target is required" }, { status: 400 });

    const fetchOwned = async (id: string): Promise<null | typeof courses.$inferSelect> => {
      const rows = await db
        .select()
        .from(courses)
        .where(and(eq(courses.id, id), eq(courses.userId, user.id)))
        .limit(1);
      return rows[0] ?? null;
    };
    const [targetRow, referenceRow] = await Promise.all([
      fetchOwned(targetId),
      referenceId ? fetchOwned(referenceId) : Promise.resolve(null),
    ]);
    if (!targetRow) return NextResponse.json({ error: "Target course not found" }, { status: 404 });

    const series: CourseSeriesInput[] = [
      { name: targetRow.name, role: "target", points: toCoursePoints(targetRow.points), elevationSource: toElevationSource(targetRow.elevationSource) },
    ];
    if (referenceRow) {
      series.push({ name: referenceRow.name, role: "training", points: toCoursePoints(referenceRow.points), elevationSource: toElevationSource(referenceRow.elevationSource) });
    }

    const baseline = await loadAthleteBaseline(user.id);
    return NextResponse.json(buildCourseComparison({
      targetSeries: series,
      athleteActivities: baseline.activities,
      athleteWeeks: baseline.weeks,
    }));
  } catch (error) {
    console.error("Failed to compare courses:", error);
    return NextResponse.json({ error: "Failed to compare courses" }, { status: 500 });
  }
}
