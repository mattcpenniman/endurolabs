// ============================================================
// EnduroLab — List Plans API Route
// ============================================================
// GET /api/plan/list — fetch all saved plans from the database.
// ============================================================

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const allPlans = await db
      .select()
      .from(plans)
      .where(eq(plans.userId, user.id))
      .orderBy(desc(plans.createdAt));

    return NextResponse.json(allPlans);
  } catch (error) {
    console.error("Failed to list plans:", error);
    return NextResponse.json(
      { error: "Failed to list plans" },
      { status: 500 }
    );
  }
}
