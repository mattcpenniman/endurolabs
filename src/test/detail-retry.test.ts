// ============================================================
// EnduroLab - Garmin Detail Retry Policy Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  emptyDetailRetryAt,
  MAX_EMPTY_DETAIL_ATTEMPTS,
  withinEmptyDetailRetryWindow,
} from "@/lib/garmin/detail-retry";

describe("Garmin detail retry policy", () => {
  const now = new Date("2026-09-27T12:00:00.000Z");

  it("backs retries off until the attempt cap", () => {
    expect(emptyDetailRetryAt(1, now)?.toISOString()).toBe("2026-09-27T14:00:00.000Z");
    expect(emptyDetailRetryAt(2, now)?.toISOString()).toBe("2026-09-27T18:00:00.000Z");
    expect(emptyDetailRetryAt(3, now)?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(emptyDetailRetryAt(MAX_EMPTY_DETAIL_ATTEMPTS, now)).toBeNull();
  });

  it("treats a missing attempt count as the first attempt", () => {
    expect(emptyDetailRetryAt(0, now)?.toISOString()).toBe("2026-09-27T14:00:00.000Z");
  });

  it("only retries activities inside the recency window", () => {
    expect(withinEmptyDetailRetryWindow(new Date("2026-09-20T12:00:00.000Z"), now)).toBe(true);
    expect(withinEmptyDetailRetryWindow(new Date("2026-09-01T12:00:00.000Z"), now)).toBe(false);
    expect(withinEmptyDetailRetryWindow(null, now)).toBe(false);
  });
});