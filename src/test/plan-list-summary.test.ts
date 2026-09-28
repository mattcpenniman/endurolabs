import { describe, expect, it } from "vitest";
import { buildPlanListSummaries, sortPlansByEndDateDesc } from "@/lib/activities/plan-list-summary";
import type { MarathonPlan, RunnerProfile } from "@/lib/training/models";

function plan(id: string): { id: string; planData: MarathonPlan } {
  return {
    id,
    planData: {
      weeks: [{ totalMileage: 30 }, { totalMileage: 35 }],
    } as MarathonPlan,
  };
}

function datedPlan(id: string, raceDate: string, lastWeekEnd?: string) {
  const weeks = lastWeekEnd ? [{ endDate: lastWeekEnd }] : [];
  return {
    id,
    planData: { raceDay: raceDate, weeks } as unknown as MarathonPlan,
    runnerProfile: { raceDate } as RunnerProfile,
  };
}

describe("saved plan list summaries", () => {
  it("combines linked activities and unmerged manual logs", () => {
    const summaries = buildPlanListSummaries(
      [plan("plan-1")],
      [{
        id: "activity-1",
        planId: "plan-1",
        distanceMeters: 16093.44,
        durationSeconds: 4800,
        elevationGainMeters: 200,
      }],
      [{ planId: "plan-1", actualMileage: 500, mergedActivityId: null }],
    );

    expect(summaries.get("plan-1")).toEqual({
      plannedMileage: 65,
      actualMileage: 15,
      actualRunCount: 2,
      actualElevationGainMeters: 200,
      averagePaceMinutesPerMile: 8,
    });
  });

  it("uses a merged activity once and can associate it through its log", () => {
    const summaries = buildPlanListSummaries(
      [plan("plan-1")],
      [{
        id: "activity-1",
        planId: null,
        distanceMeters: 8046.72,
        durationSeconds: 2400,
        elevationGainMeters: null,
      }],
      [{ planId: "plan-1", actualMileage: 510, mergedActivityId: "activity-1" }],
    );

    expect(summaries.get("plan-1")).toMatchObject({
      actualMileage: 5,
      actualRunCount: 1,
      actualElevationGainMeters: null,
      averagePaceMinutesPerMile: 8,
    });
  });
});

describe("saved plan ordering", () => {
  it("orders plans by their final week end date, newest first", () => {
    const sorted = sortPlansByEndDateDesc([
      datedPlan("oldest", "2026-08-30", "2026-08-30T00:00:00.000Z"),
      datedPlan("newest", "2027-04-17", "2027-04-18T00:00:00.000Z"),
      datedPlan("middle", "2026-11-01", "2026-11-01T00:00:00.000Z"),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["newest", "middle", "oldest"]);
  });

  it("falls back to the race date when the plan has no weeks and sorts undated plans last", () => {
    const sorted = sortPlansByEndDateDesc([
      datedPlan("no-date", "", undefined),
      datedPlan("raced", "2026-11-01"),
      datedPlan("dated", "2026-01-01", "2026-06-01T00:00:00.000Z"),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["raced", "dated", "no-date"]);
  });
});
