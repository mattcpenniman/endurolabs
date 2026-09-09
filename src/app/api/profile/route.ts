// ============================================================
// EnduroLab - User Profile API
// ============================================================
// Reads account details and appends body-weight measurements.
// PUT accepts either a new weight, a new elevation/pace unit
// preference, or both.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { users, weightMeasurements } from "@/lib/db/schema";
import { kilogramsToPounds, poundsToKilograms } from "@/lib/profile/weight";
import { parseUnitSystem } from "@/lib/units/format";

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
      unitsSystem: user.unitsSystem,
    },
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    weightPounds?: unknown;
    unitsSystem?: unknown;
  };
  const hasWeight = body.weightPounds !== undefined && body.weightPounds !== null;
  const hasUnits = body.unitsSystem !== undefined;
  if (!hasWeight && !hasUnits) {
    return NextResponse.json({ error: "Provide weightPounds and/or unitsSystem" }, { status: 400 });
  }

  const weightPounds = hasWeight ? body.weightPounds : undefined;
  let measurementAt: Date | null = null;
  if (weightPounds !== undefined) {
    if (typeof weightPounds !== "number" || !Number.isFinite(weightPounds) || weightPounds < 50 || weightPounds > 700) {
      return NextResponse.json({ error: "Weight must be between 50 and 700 lb" }, { status: 400 });
    }
    measurementAt = new Date();
    await db.insert(weightMeasurements).values({
      userId: user.id,
      measuredAt: measurementAt,
      weightKg: poundsToKilograms(weightPounds),
      source: "profile",
    });
  }

  let unitsSystem = user.unitsSystem;
  if (hasUnits) {
    const parsed = parseUnitSystem(body.unitsSystem);
    if (!parsed) {
      return NextResponse.json({ error: "Units must be \"imperial\" or \"metric\"" }, { status: 400 });
    }
    if (parsed !== user.unitsSystem) {
      await db.update(users)
        .set({ unitsSystem: parsed, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    unitsSystem = parsed;
  }

  return NextResponse.json({
    success: true,
    weightPounds: weightPounds ?? null,
    weightMeasuredAt: measurementAt ? measurementAt.toISOString() : null,
    unitsSystem,
  });
}
