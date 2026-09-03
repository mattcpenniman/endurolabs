import { describe, expect, it } from "vitest";
import { getGarminLogValidation, matchManualLogsToActivities } from "@/lib/activities/manual-merge";

describe("matchManualLogsToActivities", () => {
  it("matches exact dates within the distance tolerance", () => {
    expect(matchManualLogsToActivities(
      [{ id: "log", date: "2026-08-03T00:00:00Z", actualMileageHundredths: 500 }],
      [{ id: "activity", localDate: "2026-08-03", distanceMeters: 8100 }],
    )).toEqual([{ logId: "log", activityId: "activity" }]);
  });

  it("does not merge a different date or materially different distance", () => {
    const log = [{ id: "log", date: "2026-08-03", actualMileageHundredths: 500 }];
    expect(matchManualLogsToActivities(log, [
      { id: "wrong-date", localDate: "2026-08-04", distanceMeters: 8047 },
      { id: "wrong-distance", localDate: "2026-08-03", distanceMeters: 9000 },
    ])).toEqual([]);
  });

  it("makes nearest-distance one-to-one matches on double-run days", () => {
    const matches = matchManualLogsToActivities([
      { id: "short-log", date: "2026-08-03", actualMileageHundredths: 300 },
      { id: "long-log", date: "2026-08-03", actualMileageHundredths: 800 },
    ], [
      { id: "long-activity", localDate: "2026-08-03", distanceMeters: 12_875 },
      { id: "short-activity", localDate: "2026-08-03", distanceMeters: 4_828 },
    ]);
    expect(matches).toContainEqual({ logId: "short-log", activityId: "short-activity" });
    expect(matches).toContainEqual({ logId: "long-log", activityId: "long-activity" });
    expect(new Set(matches.map((match) => match.activityId)).size).toBe(2);
  });

  it("keeps an assigned workout linked when the logged mileage varies", () => {
    expect(matchManualLogsToActivities([{
      id: "log",
      date: "2026-08-03",
      actualMileageHundredths: 600,
      planId: "plan",
      weekNumber: 3,
      plannedWorkoutId: "workout",
    }], [{
      id: "activity",
      localDate: "2026-08-03",
      distanceMeters: 8047,
      planId: "plan",
      weekNumber: 3,
      plannedWorkoutId: "workout",
    }])).toEqual([{ logId: "log", activityId: "activity" }]);
  });
});

describe("getGarminLogValidation", () => {
  it("validates mileage matching the Garmin value at persisted precision", () => {
    expect(getGarminLogValidation(500, 8046.72)).toEqual({
      garminDistanceHundredths: 500,
      garminVarianceHundredths: 0,
      status: "validated",
    });
  });

  it("stores a signed variance when the user adjusts Garmin mileage", () => {
    expect(getGarminLogValidation(475, 8046.72)).toEqual({
      garminDistanceHundredths: 500,
      garminVarianceHundredths: -25,
      status: "variance",
    });
  });
});
