import { describe, expect, it } from "vitest";
import { buildRunScore, gradeAdjustedSpeed, summarizeRunScores, type RunScoreInput } from "@/lib/analytics/run-score";
import { generatePlan } from "@/lib/training/plan-generator";
import type { ActivityChartSample } from "@/lib/activities/models";
import type { Workout } from "@/lib/training/models";

const plan = generatePlan({ currentWeeklyMileage: 40, peakHistoricalWeeklyMileage: 50,
  currentMarathonPR: 210, currentHalfMarathonPR: 100, goalMarathonTime: 210,
  raceDate: "2027-04-18", trainingDaysPerWeek: 6, preferredRestDay: "Monday",
  recentInjuryHistory: "None", averageEasyPace: null, averageMarathonPace: null, averageThresholdPace: null,
  hasAppleWatchPower: false, longestRecentLongRun: 14, comfortLevelWithWorkouts: "advanced",
  availableLongRunDays: ["Sunday"], strengthTrainingAvailability: "light", weeksOverride: 18 });
const workout: Workout = { id: "easy", type: "easy", title: "Easy", description: "Easy",
  segments: [{ type: "easy", description: "Easy", duration: 20, pace: 10 }],
  totalDistance: 2, estimatedDuration: 20, weeklyMileageContribution: 2, intensityCategory: "easy" };
function trace(overrides: Partial<ActivityChartSample> = {}): ActivityChartSample[] {
  return Array.from({ length: 121 }, (_, i) => ({ elapsedSeconds: i * 10, cadence: 90,
    power: 250, heartRate: 140, speedMetersPerSecond: 1609.344 / 600, elevationMeters: 10, ...overrides }));
}
function score(overrides: Partial<RunScoreInput> = {}): ReturnType<typeof buildRunScore> {
  return buildRunScore({ plan, workout, distanceMeters: 3218.688, durationSeconds: 1200,
    movingDurationSeconds: null, averageCadence: null, powerSource: "garmin", samples: trace(), ...overrides });
}
const effort = (result: ReturnType<typeof score>): number | null => result.components.find((c) => c.key === "effort")!.score;

describe("run execution score", () => {
  it("normalizes single-leg cadence and gives full credit at prescribed effort/distance", () => {
    expect(score()).toMatchObject({ score: 10, partial: false, availableWeight: 100 });
    expect(score().components[0].detail).toContain("180");
  });
  it("penalizes running an easy run too fast and does not reward more watts", () => {
    expect(effort(score({ samples: trace({ speedMetersPerSecond: 5 }) }))).toBe(0);
    expect(score({ distanceMeters: 3218.688 * 1.5 }).components[2].score).toBe(0);
  });
  it("does not invent a target for unmatched runs; omits missing components", () => {
    const result = score({ workout: null, plan: null, samples: [], averageCadence: 170 });
    expect(result).toMatchObject({ score: 8.3, partial: true, availableWeight: 30 });
    expect(result.components.slice(1).every((c) => c.score === null)).toBe(true);
    expect(score({ workout: null, samples: [] }).score).toBeNull();
  });
  it("adjusts uphill speed to an equivalent flat effort without per-sample distance/grade", () => {
    expect(gradeAdjustedSpeed(3, 0)).toBe(3);
    expect(gradeAdjustedSpeed(3, 0.05)).toBeGreaterThan(3);
    expect(gradeAdjustedSpeed(3, -0.05)).toBeLessThan(3);
    expect(gradeAdjustedSpeed(3, 0.5)).toBeNull();
    const speed = (1609.344 / 600) / (gradeAdjustedSpeed(1, 0.05)!);
    const samples = trace({ speedMetersPerSecond: speed }).map((sample) => ({ ...sample, elevationMeters: sample.elapsedSeconds * speed * 0.05 }));
    expect(effort(score({ samples }))).toBe(10);
  });
  it("uses measured watts only with explicit anchors and ignores modeled sample watts", () => {
    const anchored = { ...plan, runnerProfile: { ...plan.runnerProfile, appleWatchPowerData: { marathonPower: 300, easyPower: null, thresholdPower: null } },
      powerZones: { easy: { min: 200, max: 260 }, marathon: 300, threshold: 330, vo2: 360 } };
    const powered = { ...workout, segments: [{ ...workout.segments[0], power: 250 }] };
    expect(effort(score({ plan: anchored, workout: powered, samples: trace({ elevationMeters: null }) }))).toBe(10);
    expect(effort(score({ plan: anchored, workout: powered, samples: trace({ power: 500 }) }))).toBe(0);
    expect(effort(score({ plan: anchored, workout: powered, powerSource: "estimated_speed_v1", samples: trace({ power: 500 }) }))).toBe(10);
    expect(effort(score({ plan: anchored, workout: powered, powerSource: "estimated_speed_v1", samples: trace({ elevationMeters: null }) }))).toBeNull();
  });
  it("requires substantial trace coverage and drops pauses and stationary intervals", () => {
    expect(effort(score({ samples: trace().slice(0, 10) }))).toBeNull();
    expect(effort(score({ samples: trace({ speedMetersPerSecond: 0 }) }))).toBeNull();
    expect(effort(score({ samples: trace().filter((_, i) => i % 6 === 0) }))).toBeNull();
  });
  it("time-weights cadence rather than counting irregular samples", () => {
    const samples = trace().map((sample) => ({ ...sample, cadence: sample.elapsedSeconds <= 600 ? 90 : 75 }));
    expect(score({ samples }).components[0].score).toBe(5.8);
  });
  it("follows work and recovery segment targets rather than averaging interval pace", () => {
    const intervals: Workout = { ...workout, segments: [{ type: "threshold", description: "Intervals", pace: 6, duration: 5, repetitions: 2, restBetween: 300 },
      { type: "easy", description: "Cool down", pace: 10, duration: 5 }] };
    const samples = trace().map((sample) => ({ ...sample, power: null,
      speedMetersPerSecond: 1609.344 / 60 / (sample.elapsedSeconds <= 300 || sample.elapsedSeconds > 600 && sample.elapsedSeconds <= 900 ? 6 : sample.elapsedSeconds <= 600 ? plan.paceZones.recovery : 10) }));
    expect(effort(score({ workout: intervals, samples }))).toBeGreaterThan(9);
  });
  it("aggregates equal-run means, includes partial counts, and omits excluded/missing scores", () => {
    const summary = summarizeRunScores([{ runScore: score() }, { runScore: score({ workout: null }) },
      { runScore: null }, { runScore: score({ distanceMeters: 100 }), excludedFromAnalytics: true }]);
    expect(summary).toMatchObject({ score: 10, scored: 2, total: 3, partial: 1 });
    expect(summary.components).toEqual([
      { key: "cadence", label: "Cadence", weight: 30, score: 10, scored: 2 },
      { key: "effort", label: "Target effort", weight: 50, score: 10, scored: 1 },
      { key: "distance", label: "Planned distance", weight: 20, score: 10, scored: 1 },
    ]);
    expect(summarizeRunScores([]).score).toBeNull();
  });
  it("averages runs equally rather than recombining component means with missing values", () => {
    const summary = summarizeRunScores([{ runScore: score() },
      { runScore: score({ workout: null, plan: null, samples: [], averageCadence: 145 }) }]);
    expect(summary.score).toBe(5);
    expect(summary.components.map((component) => component.score)).toEqual([5, 10, 10]);
    expect(summarizeRunScores([{ runScore: null }]).components.every((component) => component.score === null)).toBe(true);
  });
});
