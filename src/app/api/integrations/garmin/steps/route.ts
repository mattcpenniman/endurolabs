/** Private daily steps history. Reads never contact Garmin; POST imports a bounded range. */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isValidRequestOrigin } from "@/lib/request-origin";
import { validateStepsRange } from "@/lib/garmin/daily-steps";
import { loadDailySteps, syncDailySteps, StepsSyncUnavailable } from "@/lib/garmin/daily-steps-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  let range;
  try { range = validateStepsRange(request.nextUrl.searchParams.get("startDate"), request.nextUrl.searchParams.get("endDate")); }
  catch { return NextResponse.json({ error: "Choose valid dates spanning at most 28 days" }, { status: 400, headers }); }
  try { return NextResponse.json({ days: await loadDailySteps(user.id, range) }, { headers }); }
  catch { return NextResponse.json({ error: "Daily steps unavailable. Check the daily steps database migration." }, { status: 503, headers }); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  if (!isValidRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers });
  let range;
  try {
    const body = await request.json() as Record<string, unknown>;
    range = validateStepsRange(body.startDate, body.endDate);
  } catch { return NextResponse.json({ error: "Choose valid dates spanning at most 28 days" }, { status: 400, headers }); }
  try { return NextResponse.json(await syncDailySteps(user.id, range), { headers }); }
  catch (error) {
    return NextResponse.json({ error: error instanceof StepsSyncUnavailable ? error.message : "Steps import failed. Retry or check your Garmin connection." },
      { status: error instanceof StepsSyncUnavailable ? error.status : 502, headers });
  }
}
