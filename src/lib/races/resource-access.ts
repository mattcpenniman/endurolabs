/** Shared ownership guard for race resources (never exposed by public race shares). */
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { runActivities } from "@/lib/db/schema";

export async function raceResourceAccess(id: string): Promise<number | null> {
  const user = await getCurrentUser();
  if (!user) return 401;
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return 404;
  const [race] = await db.select({ id: runActivities.id }).from(runActivities).where(and(
    eq(runActivities.id, id), eq(runActivities.userId, user.id), eq(runActivities.eventType, "race"),
  )).limit(1);
  return race ? null : 404;
}
