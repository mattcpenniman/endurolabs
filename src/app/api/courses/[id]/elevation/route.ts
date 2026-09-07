// ============================================================
// EnduroLab - Course Elevation Backfill
// ============================================================
// POST /api/courses/:id/elevation
//   Backfills missing per-point elevations for a saved course
//   from the Open-Elevation API and persists them to the
//   courses table so the service is never re-queried.
//   All-or-nothing: on any lookup failure NO changes are
//   written. Idempotent: re-running on an already-backfilled
//   course with no nulls is a no-op that skips the API.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";
import {
  courseElevationSummary,
  gradeBands,
} from "@/lib/courses/gpx";
import {
  fetchElevations,
  OpenElevationError,
} from "@/lib/courses/elevation-backfill";

export const runtime = "nodejs";

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;

type StoredPoint = [number, number, number | null];

interface StoredCourse {
  id: string;
  name: string;
  distanceMeters: number;
  points: StoredPoint[];
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const { id } = await context.params;
    const rows = await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, id), eq(courses.userId, user.id)))
      .limit(1);
    const course = rows[0] as StoredCourse | undefined;
    if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const points = Array.isArray(course.points) ? (course.points as StoredPoint[]) : [];
    const missingIndexes = points
      .map((point, index) => (point[2] === null || point[2] === undefined ? index : -1))
      .filter((index) => index !== -1);
    if (missingIndexes.length === 0) {
      return NextResponse.json({
        backfilled: 0,
        message: "This course already has complete elevation data; nothing to backfill.",
      });
    }

    const nullCount = missingIndexes.length;
    // Query only the missing points — points that already carry real
    // elevation must never be overwritten with a DEM value.
    const lookedUp = await fetchElevations(
      missingIndexes.map((index) => {
        const [latitude, longitude] = points[index];
        return { latitude, longitude };
      }),
    );
    // lookedUp follows missingIndexes order (built by a filter over a
    // sorted map), so walk both in lockstep.
    const lookedUpByIndex = new Map<number, number>();
    missingIndexes.forEach((pointIndex, offset) => lookedUpByIndex.set(pointIndex, lookedUp[offset]));
    const merged: Array<[number, number, number]> = points.map(([latitude, longitude, existing], index) => {
      if (existing !== null && existing !== undefined) return [latitude, longitude, existing];
      const value = lookedUpByIndex.get(index);
      if (value === undefined) {
        throw new OpenElevationError("malformed", "An elevation lookup result was missing.");
      }
      return [latitude, longitude, value];
    });

    // Recompute the elevation aggregates from the merged trace so the
    // stored summary matches what the comparison view shows. Distance is
    // haversine on the stored point order — identical to the GPX path,
    // whose distance was also haversine on the same points.
    const coursePoints: Array<{
      latitude: number;
      longitude: number;
      elevationMeters: number | null;
      cumulativeMeters: number;
    }> = [];
    let cumulative = 0;
    let previous: { latitude: number; longitude: number } | null = null;
    for (const [latitude, longitude, elevationMeters] of merged) {
      if (previous !== null) cumulative += haversineMeters(previous, { latitude, longitude });
      coursePoints.push({ latitude, longitude, elevationMeters, cumulativeMeters: cumulative });
      previous = { latitude, longitude };
    }
    const elevation = courseElevationSummary(coursePoints);
    const elevationGainFeetPerMile = elevation.elevationCoverage >= 0.3
      ? Math.round((elevation.gainMeters / METERS_PER_FOOT) / Math.max(course.distanceMeters / METERS_PER_MILE, 0.01) * 10) / 10
      : null;

    await db
      .update(courses)
      .set({
        points: merged,
        elevationGainMeters: Math.round(elevation.gainMeters),
        elevationLossMeters: Math.round(elevation.lossMeters),
        elevationNetMeters: Math.round(elevation.netMeters),
        elevationGainFeetPerMile,
        gradeBands: gradeBands(coursePoints),
        elevationSource: "open-elevation",
        elevationBackfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(courses.id, id), eq(courses.userId, user.id)));

    return NextResponse.json({
      backfilled: nullCount,
      elevationGainMeters: Math.round(elevation.gainMeters),
      elevationGainFeetPerMile,
      message: `Backfilled ${nullCount} of ${points.length} points from Open-Elevation (30 m DEM).`,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof OpenElevationError) {
      const status = error.status === "rate_limited" ? 429 : error.status === "malformed" ? 502 : 502;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Failed to backfill course elevation:", error);
    return NextResponse.json({ error: "Failed to backfill course elevation" }, { status: 500 });
  }
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
