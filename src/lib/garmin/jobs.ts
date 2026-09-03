// ============================================================
// EnduroLab - Durable Garmin Sync Jobs
// ============================================================

import "server-only";

import { randomUUID } from "crypto";
import { and, asc, count, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { garminConnections, garminSyncJobs, runActivities } from "@/lib/db/schema";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";
import {
  fetchHistoryActivitiesPage,
  restoreGarminClient,
  StoredGarminAuth,
} from "@/lib/garmin/client";
import { GarminActivityPayload, isRunningActivity, normalizeGarminActivity } from "@/lib/garmin/activities";
import { ingestGarminActivityDetail, mapWithConcurrency } from "@/lib/garmin/sample-ingestion";
import { reconcileManualActivityMerges } from "@/lib/activities/manual-merge-persistence";

const DETAIL_BATCH_SIZE = 10;
const HISTORY_PAGE_SIZE = 200;
const LEASE_MS = 5 * 60_000;

export interface DetailJobParameters {
  scope: "recent" | "older" | "all";
  days: number;
  through: string;
}

export interface HistoryJobParameters {
  since: string;
  through: string;
}

interface JobCursor {
  startTime?: string;
  activityId?: string;
  offset?: number;
}

export async function enqueueGarminJob(
  userId: string,
  connectionId: string,
  kind: "detail" | "history",
  parameters: DetailJobParameters | HistoryJobParameters,
): Promise<typeof garminSyncJobs.$inferSelect> {
  const [job] = await db.insert(garminSyncJobs).values({
    userId,
    connectionId,
    kind,
    parameters,
  }).returning();
  return job;
}

function detailWindow(parameters: DetailJobParameters) {
  const through = new Date(parameters.through);
  const cutoff = new Date(through.getTime() - parameters.days * 86_400_000);
  return parameters.scope === "recent"
    ? gte(runActivities.startTimeGmt, cutoff)
    : parameters.scope === "older"
      ? lt(runActivities.startTimeGmt, cutoff)
      : undefined;
}

async function processDetailPass(job: typeof garminSyncJobs.$inferSelect, client: ReturnType<typeof restoreGarminClient>): Promise<boolean> {
  const parameters = job.parameters as DetailJobParameters;
  const cursor = (job.cursor ?? {}) as JobCursor;
  const through = new Date(parameters.through);
  const windowCondition = detailWindow(parameters);
  const cursorCondition = cursor.startTime && cursor.activityId
    ? or(
        gt(runActivities.startTimeGmt, new Date(cursor.startTime)),
        and(eq(runActivities.startTimeGmt, new Date(cursor.startTime)), gt(runActivities.id, cursor.activityId)),
      )
    : undefined;
  const conditions = and(
    eq(runActivities.userId, job.userId),
    eq(runActivities.source, "garmin"),
    lte(runActivities.startTimeGmt, through),
    or(
      isNull(runActivities.detailFetchStatus),
      and(
        eq(runActivities.detailFetchStatus, "failed"),
        or(isNull(runActivities.detailNextRetryAt), lte(runActivities.detailNextRetryAt, new Date())),
      ),
    ),
    ...(windowCondition ? [windowCondition] : []),
    ...(cursorCondition ? [cursorCondition] : []),
  );

  if (job.totalItems === null) {
    const [total] = await db.select({ value: count() }).from(runActivities).where(conditions);
    await db.update(garminSyncJobs).set({ totalItems: total?.value ?? 0 }).where(eq(garminSyncJobs.id, job.id));
  }
  const activities = await db.select({
    id: runActivities.id,
    providerActivityId: runActivities.providerActivityId,
    startTimeGmt: runActivities.startTimeGmt,
  }).from(runActivities)
    .where(conditions)
    .orderBy(asc(runActivities.startTimeGmt), asc(runActivities.id))
    .limit(DETAIL_BATCH_SIZE);

  if (activities.length === 0) return true;
  const results = await mapWithConcurrency(activities, 2, (activity) => ingestGarminActivityDetail(client, activity));
  const last = activities[activities.length - 1];
  const succeeded = results.filter((result) => result.status === "success").length;
  const empty = results.filter((result) => result.status === "empty").length;
  const failed = results.length - succeeded - empty;
  const samples = results.reduce((sum, result) => sum + (result.sampleCount ?? 0), 0);
  await db.update(garminSyncJobs).set({
    cursor: { startTime: last.startTimeGmt.toISOString(), activityId: last.id },
    processedItems: sql`${garminSyncJobs.processedItems} + ${results.length}`,
    succeededItems: sql`${garminSyncJobs.succeededItems} + ${succeeded}`,
    emptyItems: sql`${garminSyncJobs.emptyItems} + ${empty}`,
    failedItems: sql`${garminSyncJobs.failedItems} + ${failed}`,
    sampleCount: sql`${garminSyncJobs.sampleCount} + ${samples}`,
    updatedAt: new Date(),
  }).where(eq(garminSyncJobs.id, job.id));
  return activities.length < DETAIL_BATCH_SIZE;
}

async function processHistoryPass(job: typeof garminSyncJobs.$inferSelect, client: ReturnType<typeof restoreGarminClient>): Promise<boolean> {
  const parameters = job.parameters as HistoryJobParameters;
  const cursor = (job.cursor ?? {}) as JobCursor;
  const offset = cursor.offset ?? 0;
  const page = await fetchHistoryActivitiesPage(client, offset, HISTORY_PAGE_SIZE);
  const payloads = page as GarminActivityPayload[];
  const eligible = payloads.filter((activity) => {
    const date = activity.startTimeLocal?.slice(0, 10);
    return date >= parameters.since && date <= parameters.through.slice(0, 10) && isRunningActivity(activity);
  });
  let imported = 0;
  for (const payload of eligible) {
    const activity = normalizeGarminActivity(payload);
    const now = new Date();
    await db.insert(runActivities).values({ userId: job.userId, ...activity, syncedAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [runActivities.userId, runActivities.source, runActivities.providerActivityId],
        set: { ...activity, syncedAt: now, updatedAt: now },
      });
    imported += 1;
  }
  if (imported > 0) await reconcileManualActivityMerges(job.userId);
  const oldest = payloads.at(-1)?.startTimeLocal?.slice(0, 10);
  const complete = page.length < HISTORY_PAGE_SIZE || Boolean(oldest && oldest < parameters.since);
  await db.update(garminSyncJobs).set({
    cursor: { offset: offset + page.length },
    processedItems: sql`${garminSyncJobs.processedItems} + ${page.length}`,
    succeededItems: sql`${garminSyncJobs.succeededItems} + ${imported}`,
    updatedAt: new Date(),
  }).where(eq(garminSyncJobs.id, job.id));
  return complete;
}

/** Process bounded job passes. Persisted cursors make interruption and retry safe. */
export async function processGarminJob(jobId: string, maxPasses = 4): Promise<void> {
  const [job] = await db.select().from(garminSyncJobs).where(eq(garminSyncJobs.id, jobId)).limit(1);
  if (!job || ["succeeded", "partial", "failed"].includes(job.status)) return;
  const now = new Date();
  if (job.status === "running" && job.leaseExpiresAt && job.leaseExpiresAt > now) return;
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const [claimed] = await db.update(garminSyncJobs).set({
    status: "running",
    leaseExpiresAt,
    startedAt: job.startedAt ?? now,
    attemptCount: sql`${garminSyncJobs.attemptCount} + 1`,
    lastError: null,
    updatedAt: now,
  }).where(and(
    eq(garminSyncJobs.id, job.id),
    or(
      and(
        eq(garminSyncJobs.status, "queued"),
        or(isNull(garminSyncJobs.leaseExpiresAt), lte(garminSyncJobs.leaseExpiresAt, now)),
      ),
      and(eq(garminSyncJobs.status, "running"), lte(garminSyncJobs.leaseExpiresAt, now)),
    ),
  )).returning();
  if (!claimed) return;

  const workerToken = randomUUID();
  const [connection] = await db.update(garminConnections).set({
    activeJobId: job.id,
    activeWorkerToken: workerToken,
    activeJobLeaseExpiresAt: leaseExpiresAt,
    updatedAt: now,
  }).where(and(
    eq(garminConnections.id, job.connectionId),
    eq(garminConnections.userId, job.userId),
    eq(garminConnections.status, "connected"),
    or(
      isNull(garminConnections.activeWorkerToken),
      lte(garminConnections.activeJobLeaseExpiresAt, now),
    ),
  )).returning();
  if (!connection) {
    const [existingConnection] = await db.select({ status: garminConnections.status })
      .from(garminConnections)
      .where(and(eq(garminConnections.id, job.connectionId), eq(garminConnections.userId, job.userId)))
      .limit(1);
    if (existingConnection?.status === "connected") {
      await db.update(garminSyncJobs).set({
        status: "queued",
        leaseExpiresAt: new Date(Date.now() + 5000),
        attemptCount: sql`greatest(${garminSyncJobs.attemptCount} - 1, 0)`,
        updatedAt: new Date(),
      }).where(eq(garminSyncJobs.id, job.id));
      return;
    }
    await db.update(garminSyncJobs).set({
      status: "failed",
      lastError: "Garmin connection is unavailable",
      leaseExpiresAt: null,
      finishedAt: new Date(),
    })
      .where(eq(garminSyncJobs.id, job.id));
    return;
  }

  let client: ReturnType<typeof restoreGarminClient> | null = null;
  try {
    client = restoreGarminClient(decryptGarminTokens<StoredGarminAuth>(connection.encryptedTokens));
    let complete = false;
    for (let pass = 0; pass < maxPasses && !complete; pass += 1) {
      const renewedLease = new Date(Date.now() + LEASE_MS);
      await Promise.all([
        db.update(garminSyncJobs).set({ leaseExpiresAt: renewedLease, updatedAt: new Date() })
          .where(and(eq(garminSyncJobs.id, job.id), eq(garminSyncJobs.status, "running"))),
        db.update(garminConnections).set({ activeJobLeaseExpiresAt: renewedLease, updatedAt: new Date() })
          .where(and(eq(garminConnections.id, connection.id), eq(garminConnections.activeWorkerToken, workerToken))),
      ]);
      const [freshJob] = await db.select().from(garminSyncJobs).where(eq(garminSyncJobs.id, job.id)).limit(1);
      complete = freshJob.kind === "detail"
        ? await processDetailPass(freshJob, client)
        : await processHistoryPass(freshJob, client);
    }
    const [progress] = await db.select().from(garminSyncJobs).where(eq(garminSyncJobs.id, job.id)).limit(1);
    if (complete && progress.kind === "detail") {
      const parameters = progress.parameters as DetailJobParameters;
      const windowCondition = detailWindow(parameters);
      const [retry] = await db.select({ nextRetryAt: runActivities.detailNextRetryAt })
        .from(runActivities)
        .where(and(
          eq(runActivities.userId, progress.userId),
          eq(runActivities.source, "garmin"),
          eq(runActivities.detailFetchStatus, "failed"),
          lt(runActivities.detailAttemptCount, 3),
          lte(runActivities.startTimeGmt, new Date(parameters.through)),
          ...(windowCondition ? [windowCondition] : []),
        ))
        .orderBy(asc(runActivities.detailNextRetryAt))
        .limit(1);
      if (retry) {
        await db.insert(garminSyncJobs).values({
          userId: progress.userId,
          connectionId: progress.connectionId,
          kind: "detail",
          parameters,
          leaseExpiresAt: retry.nextRetryAt ?? new Date(Date.now() + 5 * 60_000),
        });
      }
    }
    await db.update(garminSyncJobs).set({
      status: complete ? (progress.failedItems > 0 ? "partial" : "succeeded") : "queued",
      leaseExpiresAt: null,
      finishedAt: complete ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(garminSyncJobs.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Garmin job failed";
    const terminal = claimed.attemptCount >= 5;
    const retryDelayMinutes = Math.min(2 ** Math.max(0, claimed.attemptCount - 1), 60);
    await db.update(garminSyncJobs).set({
      status: terminal ? "failed" : "queued",
      lastError: message,
      leaseExpiresAt: terminal ? null : new Date(Date.now() + retryDelayMinutes * 60_000),
      finishedAt: terminal ? new Date() : null,
      updatedAt: new Date(),
    })
      .where(eq(garminSyncJobs.id, job.id));
  } finally {
    await db.update(garminConnections).set({
      ...(client ? { encryptedTokens: encryptGarminTokens({ kind: "session", session: client.getSession() }) } : {}),
      activeJobId: null,
      activeWorkerToken: null,
      activeJobLeaseExpiresAt: null,
      updatedAt: new Date(),
    }).where(and(
      eq(garminConnections.id, connection.id),
      eq(garminConnections.activeWorkerToken, workerToken),
    ));
  }
}
