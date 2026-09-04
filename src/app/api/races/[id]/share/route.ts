// ============================================================
// EnduroLab - Race Share Link API
// ============================================================

import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";

function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}

function getOrigin(request: NextRequest): string {
  const configuredUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return request.nextUrl.origin;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const [race] = await db.select({
      id: runActivities.id,
      shareToken: runActivities.shareToken,
    }).from(runActivities).where(and(
      eq(runActivities.id, id),
      eq(runActivities.userId, user.id),
      eq(runActivities.eventType, "race"),
    )).limit(1);
    if (!race) return NextResponse.json({ error: "Race not found" }, { status: 404 });

    const shareToken = race.shareToken ?? createShareToken();
    const sharedAt = new Date();
    await db.update(runActivities).set({ shareToken, sharedAt, updatedAt: sharedAt })
      .where(and(eq(runActivities.id, race.id), eq(runActivities.userId, user.id)));

    return NextResponse.json({
      shareToken,
      shareUrl: `${getOrigin(request)}/race/${shareToken}`,
      sharedAt: sharedAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to create race share link:", error);
    return NextResponse.json({ error: "Failed to create race share link" }, { status: 500 });
  }
}
