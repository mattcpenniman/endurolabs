// ============================================================
// EnduroLab — Get Plan by ID API Route
// ============================================================
// GET /api/plan/[id] — fetch a saved plan from the database.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, id));

    if (!plan) {
      return NextResponse.json(
        { error: "Plan not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(plan);
  } catch (error) {
    console.error("Failed to fetch plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}
