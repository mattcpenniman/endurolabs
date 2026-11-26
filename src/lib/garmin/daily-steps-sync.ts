/** Owner-scoped, leased daily wellness ingestion shared by HTTP and historical CLI. */
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { garminConnections, garminDailySteps } from "@/lib/db/schema";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import { fetchDailySteps, openGarminSession, type StoredGarminAuth } from "@/lib/garmin/client";
import { normalizeDailySteps, pendingStepsRanges, validateStepsRange, type DailySteps, type StepsRange } from "./daily-steps";

export class StepsSyncUnavailable extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function loadDailySteps(userId: string, range: StepsRange): Promise<DailySteps[]> {
  const rows = await db.select().from(garminDailySteps).where(and(
    eq(garminDailySteps.userId, userId), gte(garminDailySteps.localDate, range.startDate), lte(garminDailySteps.localDate, range.endDate),
  )).orderBy(asc(garminDailySteps.localDate));
  return rows.flatMap((row) => row.totalSteps === null ? [] : [{ localDate: row.localDate, totalSteps: row.totalSteps }]);
}

export async function syncDailySteps(userId: string, range: StepsRange): Promise<{ days: DailySteps[]; skippedByTtl: boolean }> {
  validateStepsRange(range.startDate, range.endDate);
  // Allow the most advanced local calendar day, but never fetch future history.
  const lastPossibleToday = new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10);
  if (range.endDate > lastPossibleToday) throw new StepsSyncUnavailable("Future step history is unavailable", 400);
  const now = new Date();
  const workerToken = randomUUID();
  const [connection] = await db.update(garminConnections).set({
    activeWorkerToken: workerToken, activeJobLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000), updatedAt: now,
  }).where(and(eq(garminConnections.userId, userId), eq(garminConnections.status, "connected"), or(
    isNull(garminConnections.activeWorkerToken), lte(garminConnections.activeJobLeaseExpiresAt, now),
  ))).returning();
  if (!connection) {
    const [existing] = await db.select({ status: garminConnections.status }).from(garminConnections)
      .where(eq(garminConnections.userId, userId)).limit(1);
    throw new StepsSyncUnavailable(existing?.status === "connected" ? "Garmin is syncing. Retry steps shortly." : "Connect Garmin to import daily steps.", 409);
  }
  const fence = and(eq(garminConnections.id, connection.id), eq(garminConnections.activeWorkerToken, workerToken));
  try {
    const cached = await db.select().from(garminDailySteps).where(and(
      eq(garminDailySteps.userId, userId), gte(garminDailySteps.localDate, range.startDate), lte(garminDailySteps.localDate, range.endDate),
    ));
    const pending = pendingStepsRanges(range, cached, now);
    if (!pending.length) {
      return { days: await loadDailySteps(userId, range), skippedByTtl: true };
    }
    const auth = decryptGarminTokens(connection.encryptedTokens) as StoredGarminAuth | null;
    if (!auth || auth.kind !== "session") throw new StepsSyncUnavailable("Reconnect Garmin to import steps.", 409);
    // Restore/refresh only: this feature never attempts password login or MFA.
    const opened = await openGarminSession(auth);
    const saved = await db.update(garminConnections).set({ encryptedTokens: encryptGarminTokens(opened.auth), updatedAt: new Date() })
      .where(fence).returning({ id: garminConnections.id });
    if (!saved.length) throw new StepsSyncUnavailable("Garmin sync lease changed. Retry steps shortly.", 409);
    const days: DailySteps[] = [];
    for (const requested of pending) {
      days.push(...normalizeDailySteps(await fetchDailySteps(opened.client, requested.startDate, requested.endDate), requested));
    }
    const totals = new Map(days.map((day) => [day.localDate, day.totalSteps]));
    // Atomic pending-range checkpoint. Missing data never erases a previously known total.
    await db.transaction(async (tx) => {
      const [owned] = await tx.select({ id: garminConnections.id }).from(garminConnections).where(fence).for("update");
      if (!owned) throw new StepsSyncUnavailable("Garmin sync lease changed. Retry steps shortly.", 409);
      const fetchedAt = new Date();
      for (const requested of pending) {
        for (let timestamp = Date.parse(requested.startDate); timestamp <= Date.parse(requested.endDate); timestamp += 86_400_000) {
          const localDate = new Date(timestamp).toISOString().slice(0, 10);
          const totalSteps = totals.get(localDate) ?? null;
          await tx.insert(garminDailySteps).values({ userId, localDate, totalSteps, fetchedAt }).onConflictDoUpdate({
            target: [garminDailySteps.userId, garminDailySteps.localDate],
            // An empty response must not finalize an earlier same-day partial total.
            set: totalSteps === null ? {
              fetchedAt: sql`case when ${garminDailySteps.totalSteps} is null then ${fetchedAt.toISOString()}::timestamptz else ${garminDailySteps.fetchedAt} end`,
            } : { totalSteps, fetchedAt },
          });
        }
      }
    });
    return { days: await loadDailySteps(userId, range), skippedByTtl: false };
  } finally {
    await db.update(garminConnections).set({ activeWorkerToken: null, activeJobLeaseExpiresAt: null, updatedAt: new Date() }).where(fence);
  }
}
