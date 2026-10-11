/** Owned current-plan fallback and override-aware score cache invalidation. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { runActivities } from "@/lib/db/schema";
const mocks = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select, insert: mocks.insert } }));
import { loadRunScores } from "@/lib/analytics/run-score-persistence";
const plan = { runnerProfile: {}, paceZones: { easy: { min: 10, max: 9 }, recovery: 11, marathon: 8, threshold: 7, vo2: 6 }, weeks: [] };
const activity = { id: "run", userId: "owner", planId: null, plannedWorkoutId: null, effortOverride: null,
  distanceMeters: 3218, durationSeconds: 1200, movingDurationSeconds: null, averageCadence: 180,
  powerSource: "garmin", sampleCount: 0, samplesFetchedAt: null, updatedAt: new Date("2026-10-01"),
} as typeof runActivities.$inferSelect;
function query(rows: unknown[]): void {
  const builder = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  builder.from.mockReturnValue(builder); builder.where.mockReturnValue(builder); builder.orderBy.mockReturnValue(builder);
  mocks.select.mockReturnValueOnce(builder);
}
function reads(userId = "owner", cache: unknown[] = []): void {
  query([{ id: "owner", currentPlanId: "current" }]);
  query([{ id: "current", userId, planData: plan }]);
  query(cache);
  query([]);
}
describe("Run score persistence", () => {
  beforeEach(() => vi.resetAllMocks());
  it("uses owned current-plan Easy zones for runs with a null plan", async () => {
    reads();
    const result = (await loadRunScores([activity], { dryRun: true })).get("run")!;
    expect(result).toMatchObject({ effort: "easy", targetSource: "current_plan" });
    expect(result.effortTargets[0].pace).toEqual([9, 10]);
    expect(result.components.find((component) => component.key === "distance")?.score).toBeNull();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("never uses another athlete's current plan zones", async () => {
    reads("someone-else");
    const result = (await loadRunScores([activity], { dryRun: true })).get("run")!;
    expect(result).toMatchObject({ effort: "easy", targetSource: "none", effortTargets: [] });
  });
  it("invalidates a cached score when the effort override changes", async () => {
    const insert = { values: vi.fn(), onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
    insert.values.mockReturnValue(insert); mocks.insert.mockReturnValue(insert);
    reads();
    const original = (await loadRunScores([activity])).get("run")!;
    const values = insert.values.mock.calls[0][0];
    reads("owner", [{ activityId: "run", metrics: values.metrics }]);
    const changed = (await loadRunScores([{ ...activity, effortOverride: "threshold" }], { dryRun: true })).get("run")!;
    expect(changed.effort).toBe("threshold");
    expect(changed.effortTargets[0].pace).not.toEqual(original.effortTargets[0].pace);
    expect(mocks.select).toHaveBeenCalledTimes(8); // Override invalidates the cache and reloads the trace.
  });
});
