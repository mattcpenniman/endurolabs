// ============================================================
// EnduroLab - Garmin Detail Retry Policy
// ============================================================

import { and, eq, gte, isNull, lt, lte, or, SQL } from "drizzle-orm";
import { runActivities } from "@/lib/db/schema";

/**
 * Empty detail responses are refetched until this attempt count is reached.
 * Garmin can answer with no time-series metrics while an activity is still
 * processing, so an empty response is not treated as terminal.
 */
export const MAX_EMPTY_DETAIL_ATTEMPTS = 4;

/** Only activities this recent receive empty-detail retries. */
export const EMPTY_DETAIL_RETRY_WINDOW_DAYS = 14;

/**
 * Backoff before each empty-detail retry. Garmin processing lag can run for
 * hours, so consecutive empty responses wait longer before the next attempt.
 */
const EMPTY_DETAIL_RETRY_DELAYS_MINUTES = [120, 360, 720];

/**
 * Next fetch time for an activity whose Garmin detail came back empty.
 * Returns null once the retry attempts are exhausted.
 */
export function emptyDetailRetryAt(attempts: number, now: Date = new Date()): Date | null {
  const delayMinutes = EMPTY_DETAIL_RETRY_DELAYS_MINUTES[Math.max(attempts, 1) - 1];
  return delayMinutes === undefined ? null : new Date(now.getTime() + delayMinutes * 60_000);
}

/** True when an activity starts inside the empty-detail retry window. */
export function withinEmptyDetailRetryWindow(startTimeGmt: Date | null, now: Date = new Date()): boolean {
  if (!startTimeGmt) return false;
  return startTimeGmt.getTime() >= now.getTime() - EMPTY_DETAIL_RETRY_WINDOW_DAYS * 86_400_000;
}

/**
 * Activities whose detail fetch is due: never fetched, failed with an elapsed
 * backoff, or an empty response inside the retry window that has attempts left.
 */
export function detailFetchDueCondition(now: Date): SQL | undefined {
  const retryCutoff = new Date(now.getTime() - EMPTY_DETAIL_RETRY_WINDOW_DAYS * 86_400_000);
  return or(
    isNull(runActivities.detailFetchStatus),
    and(
      eq(runActivities.detailFetchStatus, "failed"),
      or(isNull(runActivities.detailNextRetryAt), lte(runActivities.detailNextRetryAt, now)),
    ),
    and(
      eq(runActivities.detailFetchStatus, "empty"),
      lt(runActivities.detailAttemptCount, MAX_EMPTY_DETAIL_ATTEMPTS),
      or(isNull(runActivities.detailNextRetryAt), lte(runActivities.detailNextRetryAt, now)),
      gte(runActivities.startTimeGmt, retryCutoff),
    ),
  );
}