// ============================================================
// EnduroLab — Logout API Route
// ============================================================
// POST /api/auth/logout — revoke the current session and clear
// the session cookie.
// ============================================================

import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(): Promise<NextResponse> {
  await clearSessionCookie();
  return NextResponse.json({ success: true });
}
