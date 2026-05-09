// ============================================================
// EnduroLab — Plan Share Link API Route
// ============================================================
// POST /api/plan/[id]/share — create or revoke a read-only
// public share link for an authenticated user's plan.
// ============================================================

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";

function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function getOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return request.nextUrl.origin;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as { enabled?: boolean };
    const enabled = body.enabled ?? true;

    const [existingPlan] = await db
      .select({ id: plans.id, shareToken: plans.shareToken })
      .from(plans)
      .where(and(eq(plans.id, id), eq(plans.userId, user.id)))
      .limit(1);

    if (!existingPlan) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    if (!enabled) {
      await db
        .update(plans)
        .set({ shareToken: null, sharedAt: null, updatedAt: new Date() })
        .where(and(eq(plans.id, id), eq(plans.userId, user.id)));

      return NextResponse.json({ success: true, shareToken: null, shareUrl: null, sharedAt: null });
    }

    const shareToken = existingPlan.shareToken ?? createShareToken();
    const sharedAt = new Date();

    await db
      .update(plans)
      .set({ shareToken, sharedAt, updatedAt: sharedAt })
      .where(and(eq(plans.id, id), eq(plans.userId, user.id)));

    return NextResponse.json({
      success: true,
      shareToken,
      shareUrl: `${getOrigin(request)}/share/${shareToken}`,
      sharedAt: sharedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to update share link:", error);
    return NextResponse.json({ error: "Failed to update share link" }, { status: 500 });
  }
}
