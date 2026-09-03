// ============================================================
// EnduroLab - User Profile API
// ============================================================
// Reads account details and appends body-weight measurements.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { weightMeasurements } from "@/lib/db/schema";
import { kilogramsToPounds, poundsToKilograms } from "@/lib/profile/weight";

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const [measurement] = await db.select({
    measuredAt: weightMeasurements.measuredAt,
    weightKg: weightMeasurements.weightKg,
  }).from(weightMeasurements)
    .where(eq(weightMeasurements.userId, user.id))
    .orderBy(desc(weightMeasurements.measuredAt))
    .limit(1);

  return NextResponse.json({
    profile: {
      email: user.email,
      name: user.name,
      weightPounds: measurement ? kilogramsToPounds(measurement.weightKg) : null,
      weightMeasuredAt: measurement?.measuredAt.toISOString() ?? null,
    },
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { weightPounds?: unknown };
  const weightPounds = body.weightPounds;
  if (typeof weightPounds !== "number" || !Number.isFinite(weightPounds) || weightPounds < 50 || weightPounds > 700) {
    return NextResponse.json({ error: "Weight must be between 50 and 700 lb" }, { status: 400 });
  }

  const measuredAt = new Date();
  await db.insert(weightMeasurements).values({
    userId: user.id,
    measuredAt,
    weightKg: poundsToKilograms(weightPounds),
    source: "profile",
  });

  return NextResponse.json({
    success: true,
    weightPounds,
    weightMeasuredAt: measuredAt.toISOString(),
  });
}
