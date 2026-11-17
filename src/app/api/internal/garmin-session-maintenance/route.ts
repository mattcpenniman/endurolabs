/** Protected worker-only endpoint for bounded background OAuth maintenance. */
import { NextRequest, NextResponse } from "next/server";
import { maintainGarminSession } from "@/lib/garmin/session-maintenance";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.GARMIN_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ processed: await maintainGarminSession() });
}
