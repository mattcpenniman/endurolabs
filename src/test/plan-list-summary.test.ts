import { describe, expect, it } from "vitest";
import { buildPlanListSummaries } from "@/lib/activities/plan-list-summary";
import type { MarathonPlan } from "@/lib/training/models";

function plan(id: string): { id: string; planData: MarathonPlan } {
  return {
    id,
    planData: {
      weeks: [{ totalMileage: 30 }, { totalMileage: 35 }],
    } as MarathonPlan,
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
