/** Background Garmin session maintenance, independent of activity imports. */
import "server-only";

import { randomUUID } from "crypto";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { garminConnections } from "@/lib/db/schema";
import { openGarminSession, type StoredGarminAuth } from "@/lib/garmin/client";
import { decryptGarminTokens, encryptGarminTokens } from "@/lib/garmin/crypto";

const CHECK_INTERVAL_MS = 30 * 60_000;

/**
 * Claim one due connection using the same fenced lease as foreground sync/jobs.
 * Never logs in with a password in the background or consumes pending MFA.
 * Failed checks back off; reconnect/revocation remains under the runner's control.
 */
export async function maintainGarminSession(): Promise<boolean> {
  const now = new Date();
  const available = and(
    eq(garminConnections.status, "connected"),
    or(isNull(garminConnections.nextTokenCheckAt), lte(garminConnections.nextTokenCheckAt, now)),
    or(isNull(garminConnections.activeWorkerToken), lte(garminConnections.activeJobLeaseExpiresAt, now)),
  );
  const [candidate] = await db.select({ id: garminConnections.id }).from(garminConnections)
    .where(available).orderBy(asc(garminConnections.nextTokenCheckAt), asc(garminConnections.id)).limit(1);
  if (!candidate) return false;

  const workerToken = randomUUID();
  const [connection] = await db.update(garminConnections).set({
    activeWorkerToken: workerToken,
    activeJobLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
    nextTokenCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
  }).where(and(eq(garminConnections.id, candidate.id), available)).returning();
  if (!connection) return false;

  const owned = and(eq(garminConnections.id, connection.id), eq(garminConnections.activeWorkerToken, workerToken));
  try {
    const auth = decryptGarminTokens<StoredGarminAuth>(connection.encryptedTokens);
    if (auth.kind !== "session") return true;
    // OAuth refresh only. Existing interactive sync retains opt-in password recovery.
    const opened = await openGarminSession(auth);
    await db.update(garminConnections).set({
      encryptedTokens: encryptGarminTokens(opened.auth),
    }).where(owned);
  } catch {
    // No upstream text, secrets, or credentials in logs/status. A transient
    // network error must not disconnect the runner or trigger repeated logins.
    await db.update(garminConnections).set({
      lastError: "Background token check failed; will retry. Reconnect Garmin if syncing also fails.",
    }).where(owned);
  } finally {
    await db.update(garminConnections).set({
      activeWorkerToken: null,
      activeJobLeaseExpiresAt: null,
    }).where(owned);
  }
  return true;
}
