// ============================================================
// EnduroLab — Current User API Route
// ============================================================
// GET /api/auth/me — return the authenticated session user.
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  return NextResponse.json({ user });
}
