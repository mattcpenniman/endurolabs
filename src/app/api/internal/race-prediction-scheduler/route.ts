// ============================================================
// EnduroLab - Race Prediction Scheduler Endpoint
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { issueDueRacePredictionSnapshots } from "@/lib/analytics/race-prediction-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.GARMIN_WORKER_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await issueDueRacePredictionSnapshots());
}
