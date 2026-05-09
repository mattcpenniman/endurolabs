// ============================================================
// EnduroLab — Export Calendar API Route
// ============================================================
// POST /api/plan/export
// Accepts a MarathonPlan JSON body and returns an .ics calendar
// file for import into Google Calendar, Apple Calendar, etc.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { MarathonPlan } from "@/lib/training/models";
import { generateICS } from "@/lib/training/calendar-export";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body: MarathonPlan = await request.json();

    const icsContent = generateICS(body);

    return new NextResponse(icsContent, {
      headers: {
        "Content-Type": "text/calendar",
        "Content-Disposition": `attachment; filename="endurlab-plan-${body.id}.ics"`,
      },
      status: 200,
    });
  } catch (error) {
    console.error("Calendar export error:", error);
    return NextResponse.json(
      { error: "Failed to generate calendar file" },
      { status: 500 }
    );
  }
}
