// ============================================================
// EnduroLab - Race Comparison Tests
// ============================================================

import { describe, expect, it } from "vitest";
import type { RunActivity } from "@/lib/activities/models";
import {
  areComparableRaces,
  classifyRaceDistance,
  compareRaces,
  findDefaultComparisonRace,
} from "@/lib/activities/race-comparison";

function race(overrides: Partial<RunActivity> = {}): RunActivity {
  return {
    id: "race-1",
    providerActivityId: "provider-1",
    source: "garmin",
    powerSource: "garmin",
    activityName: "Test Race",
    activityType: "running",
    eventType: "race",
    localDate: "2026-05-02",
    startTimeLocal: "2026-05-02 08:00:00",
    startTimeGmt: "2026-05-02T12:00:00.000Z",
    distanceMiles: 13.1,
    durationSeconds: 5400,
    movingDurationSeconds: 5390,
    averagePaceMinutesPerMile: 6.87,
    elevationGainMeters: 100,
    averageHeartRate: 175,
    maxHeartRate: 185,
    averageCadence: 180,
    garminPower: 330,
    calculatedPower: 325,
    averagePower: 330,
    averagePowerEstimated: false,
    calories: 1200,
    deviceName: "Garmin",
    planId: null,
    weekNumber: null,
    dayOfWeek: null,
    plannedWorkoutId: null,
    matchConfidence: null,
    qualityScore: 90,
    excludedFromAnalytics: false,
    sampleCount: 5000,
    samplesFetchedAt: "2026-05-02T14:00:00.000Z",
    detailFetchStatus: "success",
    detailLastError: null,
    syncedAt: "2026-05-02T14:00:00.000Z",
    ...overrides,
  };
}

describe("race comparison", () => {
  it("groups GPS drift around common race distances", () => {
    expect(classifyRaceDistance(3.22)).toEqual({ key: "5k", label: "5K" });
    expect(classifyRaceDistance(13.31)).toEqual({ key: "half-marathon", label: "Half marathon" });
    expect(classifyRaceDistance(26.56)).toEqual({ key: "marathon", label: "Marathon" });
    expect(classifyRaceDistance(20.2)).toEqual({ key: "20-mile", label: "20 mile" });
  });

  it("compares only races in the same distance group", () => {
    expect(areComparableRaces(race(), race({ distanceMiles: 13.3 }))).toBe(true);
    expect(areComparableRaces(race(), race({ distanceMiles: 6.22 }))).toBe(false);
  });

  it("reports positive improvements for a faster selected race", () => {
    const selected = race({ durationSeconds: 5100, averagePaceMinutesPerMile: 6.49, averageHeartRate: 178, averagePower: 345 });
    const baseline = race({ id: "prior", durationSeconds: 5400, averagePaceMinutesPerMile: 6.87, averageHeartRate: 175, averagePower: 330 });

    const result = compareRaces(selected, baseline);
    expect(result).toMatchObject({
      timeImprovementSeconds: 300,
      heartRateDelta: 3,
      powerDelta: 15,
    });
    expect(result.paceImprovementMinutesPerMile).toBeCloseTo(0.38, 2);
    expect(result.timeImprovementPercent).toBeCloseTo(5.56, 2);
  });

  it("keeps unavailable sensor comparisons null", () => {
    const result = compareRaces(
      race({ averageHeartRate: null, averagePower: null, elevationGainMeters: null }),
      race({ id: "prior" }),
    );
    expect(result.heartRateDelta).toBeNull();
    expect(result.powerDelta).toBeNull();
    expect(result.elevationDeltaMeters).toBeNull();
  });

  it("chooses the nearest earlier comparable race", () => {
    const selected = race({ id: "selected", startTimeGmt: "2026-05-02T12:00:00.000Z" });
    const older = race({ id: "older", startTimeGmt: "2024-05-02T12:00:00.000Z" });
    const previous = race({ id: "previous", startTimeGmt: "2025-05-02T12:00:00.000Z" });
    const wrongDistance = race({ id: "10k", distanceMiles: 6.2, startTimeGmt: "2026-04-01T12:00:00.000Z" });
    expect(findDefaultComparisonRace(selected, [older, wrongDistance, previous, selected])?.id).toBe("previous");
  });
});
