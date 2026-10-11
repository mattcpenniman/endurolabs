/** Share a single owned run without requiring a plan or race tag. */
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  const [activity] = await db.select({ shareToken: runActivities.shareToken }).from(runActivities)
    .where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id))).limit(1);
  if (!activity) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const shareToken = activity.shareToken ?? randomBytes(24).toString("base64url");
  const sharedAt = new Date();
  await db.update(runActivities).set({ shareToken, sharedAt, updatedAt: sharedAt })
    .where(and(eq(runActivities.id, id), eq(runActivities.userId, user.id)));
  const configuredUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const origin = configuredUrl?.replace(/\/$/, "")
    ?? (forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : request.nextUrl.origin);
  return NextResponse.json({ shareUrl: `${origin}/run/${shareToken}` });
}
