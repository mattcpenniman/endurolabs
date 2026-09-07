// ============================================================
// EnduroLab — Courses API
// ============================================================
// POST /api/courses           Upload GPX text; parses and persists.
// GET  /api/courses           List the athlete's saved courses.
// DELETE /api/courses         Remove a course by id (?id=<uuid>).
// GET  /api/courses/compare   Target + reference course + athlete
//                             sample baseline -> comparison payload.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { courses } from "@/lib/db/schema";
import {
  buildCoursePoints,
  parseGPXTrkpoints,
  courseElevationSummary,
  gradeBands,
} from "@/lib/courses/gpx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METERS_PER_FOOT = 0.3048;
const MAX_UPLOAD_BYTES = 5_000_000;
const MAX_POINTS = 50_000;

function validateAndParse(
  gpxText: string,
): { points: Array<[number, number, number | null]>; distanceMeters: number; elevation: ReturnType<typeof courseElevationSummary>; bands: ReturnType<typeof gradeBands> } | { error: string } {
  if (typeof gpxText !== "string" || gpxText.length === 0) {
    return { error: "GPX content is required." };
  }
  if (gpxText.length > MAX_UPLOAD_BYTES) {
    return { error: "GPX file is too large (limit 5 MB)." };
  }
  let points;
  try {
    points = buildCoursePoints(parseGPXTrkpoints(gpxText));
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Failed to parse GPX file." };
  }
  if (points.length < 10) {
    return { error: "GPX file contains too few track points (minimum 10) to form a usable course." };
  }
  if (points.length > MAX_POINTS) {
    return { error: "GPX file has more than 50,000 points; decimate the track before uploading." };
  }
  const total = points[points.length - 1].cumulativeMeters - points[0].cumulativeMeters;
  if (total < 100) {
    return { error: "Course distance is too short (under ~100 m) to be a race route." };
  }
  const elevation = courseElevationSummary(points);
  return {
    points: points.map((p) => [p.latitude, p.longitude, p.elevationMeters] as [number, number, number | null]),
    distanceMeters: Math.round(total),
    elevation,
    bands: gradeBands(points),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const rows = await db
      .select()
      .from(courses)
      .where(eq(courses.userId, user.id))
      .orderBy(asc(courses.createdAt));
    return NextResponse.json({
      courses: rows.map((row) => ({
        id: row.id,
        name: row.name,
        distanceMeters: row.distanceMeters,
        distanceMiles: Math.round(row.distanceMeters / 1609.344 * 100) / 100,
        elevationGainFeet: Math.round((row.elevationGainMeters ?? 0) / METERS_PER_FOOT),
        elevationGainFeetPerMile: row.elevationGainFeetPerMile,
        created: row.createdAt.toISOString(),
        pointCount: Array.isArray(row.points) ? row.points.length : 0,
        gradeBands: row.gradeBands,
      })),
    });
  } catch (error) {
    console.error("Failed to list courses:", error);
    return NextResponse.json({ error: "Failed to list courses" }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const gpxText = typeof body.gpx === "string" ? body.gpx : "";
    const name = typeof body.name === "string" ? body.name.slice(0, 255) : null;
    const parsed = validateAndParse(gpxText);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 422 });

    const totalMeters = parsed.distanceMeters;
    const totalMiles = totalMeters / 1609.344;
    const gainFeet = parsed.elevation.gainMeters / METERS_PER_FOOT;
    const displayName = (name ?? "Course").trim().slice(0, 255) || "Course";
    const row = await db
      .insert(courses)
      .values({
        userId: user.id,
        name: displayName,
        points: parsed.points,
        distanceMeters: totalMeters,
        elevationGainMeters: Math.round(parsed.elevation.gainMeters),
        elevationLossMeters: Math.round(parsed.elevation.lossMeters),
        elevationNetMeters: Math.round(parsed.elevation.netMeters),
        elevationGainFeetPerMile: parsed.elevation.elevationCoverage >= 0.3
          ? Math.round((gainFeet / Math.max(totalMiles, 0.01)) * 10) / 10
          : null,
        gradeBands: parsed.bands,
        sourceFilename: typeof body.filename === "string" ? body.filename.slice(0, 255) : null,
      })
      .returning();
    return NextResponse.json({
      course: {
        id: row[0].id,
        name: row[0].name,
        distanceMeters: row[0].distanceMeters,
        distanceMiles: Math.round(row[0].distanceMeters / 1609.344 * 100) / 100,
        elevationGainMeters: row[0].elevationGainMeters,
        elevationGainFeetPerMile: row[0].elevationGainFeetPerMile,
        gradeBands: row[0].gradeBands,
        pointCount: Array.isArray(row[0].points) ? row[0].points.length : 0,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create course:", error);
    return NextResponse.json({ error: "Failed to create course" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const id = request.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const result = await db
      .delete(courses)
      .where(and(eq(courses.id, id), eq(courses.userId, user.id)))
      .returning({ id: courses.id });
    if (result.length === 0) return NextResponse.json({ error: "Course not found" }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (error) {
    console.error("Failed to delete course:", error);
    return NextResponse.json({ error: "Failed to delete course" }, { status: 500 });
  }
}


