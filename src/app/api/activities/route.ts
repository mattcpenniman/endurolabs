/** Authenticated, paginated run history across every plan and activity source. */
import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";
import { serializeRunActivity } from "@/lib/activities/serialize";
import { loadRunScores } from "@/lib/analytics/run-score-persistence";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const params = request.nextUrl.searchParams;
    const requestedPage = Number(params.get("page") ?? 1);
    const pageSize = 50;
    const query = params.get("q")?.trim().slice(0, 200);
    const planFilter = params.get("plan");
    const where = and(
      eq(runActivities.userId, user.id),
      query ? ilike(runActivities.activityName, `%${query.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
      planFilter === "unassigned" ? isNull(runActivities.planId) : undefined,
      planFilter === "linked" ? isNotNull(runActivities.planId) : undefined,
    );
    const [totalRow] = await db.select({ total: count() }).from(runActivities).where(where);
    const total = totalRow.total;
    const page = Math.min(
      Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      Math.max(1, Math.ceil(total / pageSize)),
    );
    const rows = await db.select().from(runActivities).where(where)
      .orderBy(desc(runActivities.startTimeGmt), desc(runActivities.id))
      .limit(pageSize).offset((page - 1) * pageSize);
    const requestedId = params.get("run");
    const [selectedRow] = requestedId && !rows.some((row) => row.id === requestedId)
      ? await db.select().from(runActivities)
        .where(and(eq(runActivities.userId, user.id), eq(runActivities.id, requestedId))).limit(1)
      : [];
    const scores = await loadRunScores(selectedRow ? [...rows, selectedRow] : rows);
    const serialize = (row: typeof runActivities.$inferSelect) => ({
      ...serializeRunActivity(row), runScore: scores.get(row.id) ?? null,
    });
    return NextResponse.json({
      activities: rows.map(serialize), selectedActivity: selectedRow ? serialize(selectedRow) : null,
      total, page, pageSize,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load runs:", error);
    return NextResponse.json({ error: "Failed to load runs" }, { status: 500 });
  }
}
