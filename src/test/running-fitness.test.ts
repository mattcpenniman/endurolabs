// ============================================================
// EnduroLab — Running Fitness Analytics Tests
// ============================================================
// Synthetic HR/power traces with known ground truth.

// Core: Power = 2.5 * HR  =>  Power @ 140 bpm ~= 350 W.
// Also covers noisy data, missing HR, missing power, and
// insufficient HR range (must return null, not false precision).
// ============================================================

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FITNESS_CONFIG,
  analyzePowerAtHeartRate,
  analyzeAerobicDecouplingByActivity,
  calculateAerobicDecoupling,
  fitPowerAtHeartRate,
  prepareFitnessSamples,
} from "@/lib/analytics/running-fitness";
import { ActivitySampleInput, PowerHeartRateModel, PreparedFitnessPoint } from "@/lib/analytics/models";
import { analyzePlanFitness } from "@/lib/analytics/plan-fitness";
import { comparePlans, formatPaceShort } from "@/lib/analytics/plan-comparison";
import { MarathonPlan } from "@/lib/training/models";
import { RunActivity } from "@/lib/activities/models";
import { fitSpeedPowerModel } from "@/lib/analytics/modeled-power";

/**
 * Build a clean steady-state trace where Power = 2.5 * (HR lagged by 30s).
 * After prepareFitnessSamples' 30s lag alignment and window averaging,
 * each (HR, Power) point lands exactly on Power = 2.5 * HR.
 */
function cleanSamples(): ActivitySampleInput[] {
  const activityId = "run-1";
  const durationSec = 900;
  const samples: ActivitySampleInput[] = [];
  for (let t = 0; t <= durationSec; t += 1) {
    const hr = 95 + 0.08 * t;
    const power = 2.5 * (95 + 0.08 * (t + 30));
    samples.push({
      activityId,
      elapsedSeconds: t,
      heartRate: Math.round(hr),
      power: Math.round(power),
      speedMetersPerSecond: 3.0,
    });
  }
  return samples;
}

describe("prepareFitnessSamples", () => {
  it("produces points near the expected HR/power relationship", () => {
    const points = prepareFitnessSamples(cleanSamples());
    expect(points.length).toBeGreaterThanOrEqual(20);
    for (const p of points.slice(0, 5)) {
      expect(p.power).toBeCloseTo(2.5 * p.heartRate, -1); // within 1 W
    }
  });

  it("drops windows with excessive power variability (accelerations)", () => {
    const samples: ActivitySampleInput[] = [];
    // A burst: power oscillates wildly within the first 30s window.
    for (let t = 0; t < 60; t += 1) {
      samples.push({
        activityId: "burst",
        elapsedSeconds: t,
        heartRate: 150,
        power: 200 + (t % 2 === 0 ? 350 : 0),
        speedMetersPerSecond: 4.5,
      });
    }
    const points = prepareFitnessSamples(samples);
    // No window should survive the CV filter for the burst.
    expect(points.length).toBe(0);
  });
});

describe("analyzePowerAtHeartRate — core metric", () => {
  it("recovers Power @ 140 ~= 350 W from Power = 2.5*HR synthetic data", () => {
    const model = analyzePowerAtHeartRate(cleanSamples());
    expect(model).not.toBeNull();
    const p140 = model!.estimates.find((e) => e.heartRate === 140)!;
    expect(p140.watts).toBeGreaterThanOrEqual(345);
    expect(p140.watts).toBeLessThanOrEqual(355);
    expect(p140.extrapolated).toBe(false);
  });

  it("estimates 130 and 150 consistently (325 and 375 W)", () => {
    const model = analyzePowerAtHeartRate(cleanSamples())!;
    expect(model.estimates.find((e) => e.heartRate === 130)!.watts).toBeGreaterThanOrEqual(320);
    expect(model.estimates.find((e) => e.heartRate === 130)!.watts).toBeLessThanOrEqual(330);
    expect(model.estimates.find((e) => e.heartRate === 150)!.watts).toBeGreaterThanOrEqual(370);
    expect(model.estimates.find((e) => e.heartRate === 150)!.watts).toBeLessThanOrEqual(380);
  });

  it("computes W/kg using the supplied body weight", () => {
    const model = analyzePowerAtHeartRate(cleanSamples(), [140], 75)!;
    const p140 = model.estimates.find((e) => e.heartRate === 140)!;
    expect(p140.wattsPerKg).toBeCloseTo(p140.watts / 75, 1);
  });

  it("is robust to measurement noise", () => {
    const base = cleanSamples();
    const noisy = base.map((s) => ({
      ...s,
      power: s.power! + (Math.random() < 0.5 ? -12 : 12),
    }));
    const model = analyzePowerAtHeartRate(noisy)!;
    const p140 = model.estimates.find((e) => e.heartRate === 140)!;
    expect(p140.watts).toBeGreaterThanOrEqual(340);
    expect(p140.watts).toBeLessThanOrEqual(360);
  });

  it("tolerates gaps in HR without crashing", () => {
    const samples = cleanSamples().map((s, i) =>
      i % 5 === 0 ? { ...s, heartRate: null } : s
    );
    const model = analyzePowerAtHeartRate(samples);
    expect(model).not.toBeNull();
    expect(model!.estimates.find((e) => e.heartRate === 140)!.watts).toBeGreaterThan(300);
  });

  it("tolerates gaps in power without crashing", () => {
    const samples = cleanSamples().map((s, i) =>
      i % 5 === 0 ? { ...s, power: null } : s
    );
    const model = analyzePowerAtHeartRate(samples);
    expect(model).not.toBeNull();
  });

  it("returns null (not a guess) when HR range is too narrow", () => {
    // Nearly constant HR -> no usable slope information.
    const samples: ActivitySampleInput[] = [];
    for (let t = 0; t <= 300; t += 1) {
      samples.push({
        activityId: "flat-hr",
        elapsedSeconds: t,
        heartRate: 140,
        power: 350,
        speedMetersPerSecond: 3.0,
      });
    }
    const model = analyzePowerAtHeartRate(samples);
    expect(model).toBeNull();
  });

  it("returns null when there are not enough usable windows", () => {
    const samples = cleanSamples().slice(0, 60); // 20s only -> 1 window
    const model = analyzePowerAtHeartRate(samples);
    expect(model).toBeNull();
  });

  it("flags extrapolation when target HR is beyond the observed range", () => {
    // Trace stays low-HR (90-110), but target 150 is above observed range.
    const samples: ActivitySampleInput[] = [];
    for (let t = 0; t <= 900; t += 1) {
      samples.push({
        activityId: "low-hr",
        elapsedSeconds: t,
        heartRate: 95 + 0.07 * t, // max ~ 158
        power: 2.5 * (95 + 0.07 * (t + 30)),
        speedMetersPerSecond: 3.0,
      });
    }
    const model = analyzePowerAtHeartRate(samples, [130, 140, 150]);
    if (model) {
      const p150 = model.estimates.find((e) => e.heartRate === 150);
      if (p150 && p150.heartRate > model.observedHeartRateRange[1]) {
        expect(p150.extrapolated).toBe(true);
      }
    }
  });
});

describe("fitPowerAtHeartRate — prepared points directly", () => {
  it("reproduces a known linear relationship", () => {
    const points: PreparedFitnessPoint[] = [];
    for (let hr = 110; hr <= 160; hr += 2) {
      points.push({ activityId: "x", elapsedSeconds: 0, heartRate: hr, power: 2.5 * hr });
    }
    const model = fitPowerAtHeartRate(points, [140])!;
    expect(model.slope).toBeCloseTo(2.5, 1);
    expect(model.intercept).toBeCloseTo(0, 0);
    expect(model.estimates.find((e) => e.heartRate === 140)!.watts).toBeCloseTo(350, 0);
  });
});

describe("calculateAerobicDecoupling", () => {
  it("detects positive decoupling when HR rises with constant power", () => {
    const points: PreparedFitnessPoint[] = [];
    // 61 windows: first half HR 140, second half HR 147, power constant 350.
    for (let i = 0; i < 61; i += 1) {
      points.push({
        activityId: "drift",
        elapsedSeconds: i * 30,
        heartRate: i < 30 ? 140 : 147,
        power: 350,
      });
    }
    const result = calculateAerobicDecoupling(points);
    expect(result.suitable).toBe(true);
    expect(result.percentage).toBeGreaterThan(0);
    expect(result.percentage).toBeLessThan(15);
    expect(result.firstHalfEfficiency).toBeCloseTo(350 / 140, 1);
  });

  it("rejects runs that are too short", () => {
    const points: PreparedFitnessPoint[] = [];
    for (let i = 0; i < 10; i += 1) {
      points.push({ activityId: "short", elapsedSeconds: i * 30, heartRate: 150, power: 350 });
    }
    const result = calculateAerobicDecoupling(points);
    expect(result.suitable).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("rejects activities with materially different power between halves", () => {
    const points: PreparedFitnessPoint[] = [];
    for (let i = 0; i < 61; i += 1) {
      points.push({
        activityId: "progression",
        elapsedSeconds: i * 30,
        heartRate: i < 31 ? 140 : 150,
        power: i < 31 ? 300 : 350,
      });
    }
    const result = calculateAerobicDecoupling(points);
    expect(result.suitable).toBe(false);
    expect(result.reason).toContain("Power changed");
  });

  it("calculates each activity independently", () => {
    const samples = ["run-a", "run-b"].flatMap((activityId, activityIndex) => (
      Array.from({ length: 1861 }, (_, elapsedSeconds) => ({
        activityId,
        elapsedSeconds,
        heartRate: elapsedSeconds < 930 ? 140 : 145 + activityIndex,
        power: 300,
        speedMetersPerSecond: 3,
      }))
    ));
    const results = analyzeAerobicDecouplingByActivity(samples);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.suitable)).toBe(true);
    expect(results[1].percentage).toBeGreaterThan(results[0].percentage);
  });
});

describe("fitSpeedPowerModel", () => {
  it("fits measured summaries and excludes previously estimated power", () => {
    const measured = [2, 2.5, 3, 3.5, 4].map((speed) => ({
      distanceMeters: speed * 1000,
      durationSeconds: 1000,
      movingDurationSeconds: 1000,
      averagePower: 50 + 100 * speed,
      powerSource: "garmin",
    }));
    const model = fitSpeedPowerModel([
      ...measured,
      { ...measured[0], averagePower: 600, powerSource: "estimated_speed_v1" },
    ]);
    expect(model?.intercept).toBeCloseTo(50, 6);
    expect(model?.slope).toBeCloseTo(100, 6);
    expect(model?.activityCount).toBe(5);
  });
});

describe("analyzePlanFitness — weekly bucketing", () => {
  it("assigns samples to the correct week window and reports best-140", () => {
    const samples = cleanSamples().map((s) => ({ ...s, activityStartDate: "2026-08-05" }));
    const result = analyzePlanFitness({
      weekWindows: [
        { start: "2026-08-03", end: "2026-08-09" },
        { start: "2026-08-10", end: "2026-08-16" },
      ],
      samples,
    });
    expect(result.weeks.size).toBe(1);
    expect(result.best140).toBeGreaterThan(300);
    expect(result.headline).not.toBeNull();
  });

  it("uses the selected power source and a cached headline model", () => {
    const samples = cleanSamples().map((sample) => ({ ...sample, activityStartDate: "2026-08-05" }));
    const cachedHeadline = analyzePowerAtHeartRate(samples, undefined, null, "apple_watch")!;
    const result = analyzePlanFitness({
      weekWindows: [{ start: "2026-08-03", end: "2026-08-09" }],
      samples,
      source: "apple_watch",
      headlineModel: cachedHeadline,
    });

    expect(result.headline).toBe(cachedHeadline);
    expect(result.weeks.get("2026-08-03")?.source).toBe("apple_watch");
  });
});

// ─── comparePlans — week alignment & deltas ──────────────

function minimalPlan(id: string, weeks: Array<{ weekNumber: number; start: string; end: string; miles: number }>): MarathonPlan {
  const planWeeks = weeks.map((w) => ({
    weekNumber: w.weekNumber,
    startDate: w.start,
    endDate: w.end,
    phase: "base",
    days: [
      { date: w.start, dayOfWeek: "Monday", workout: null, isRestDay: true, plannedMileage: 0 },
      { date: w.end, dayOfWeek: "Sunday", workout: null, isRestDay: false, plannedMileage: w.miles },
    ],
    totalMileage: w.miles,
    longRunDistance: w.miles,
    isDownWeek: false,
    intensityDistribution: { easy: w.miles, threshold: 0, marathon: 0, vo2: 0 },
  }));
  return {
    id,
    weeks: planWeeks,
    totalWeeks: weeks.length,
    peakWeeklyMileage: Math.max(...weeks.map((w) => w.miles)),
    phases: [{ name: "Base", description: "", startDate: "", endDate: "", weekRange: [1, weeks.length] }],
    runnerProfile: {} as MarathonPlan["runnerProfile"],
    paceZones: {} as MarathonPlan["paceZones"],
    raceDay: "2026-09-01",
    generatedAt: new Date().toISOString(),
    goalAssessment: { feasibility: "realistic", reasoning: "", recommendedPeakMileage: 50, keyFactors: [], timeline: "" },
    adjustmentRules: [],
    riskWarnings: [],
  } as MarathonPlan;
}

function run(date: string, distanceMiles: number, pace: number, hr: number | null = null, power: number | null = null): RunActivity {
  const dur = Math.round(pace * distanceMiles * 60);
  return {
    id: `run-${date}-${distanceMiles}`,
    providerActivityId: date,
    source: "garmin",
    activityName: "Test run",
    activityType: "street_running",
    localDate: date,
    startTimeLocal: `${date} 07:00:00`,
    startTimeGmt: new Date(`${date}T07:00:00Z`).toISOString(),
    distanceMiles,
    durationSeconds: dur,
    movingDurationSeconds: dur,
    averagePaceMinutesPerMile: pace,
    elevationGainMeters: 50,
    averageHeartRate: hr,
    maxHeartRate: hr ? hr + 15 : null,
    averageCadence: 180,
    averagePower: power,
    calories: 300,
    deviceName: "Forerunner 965",
    planId: null,
    weekNumber: null,
    dayOfWeek: "Tuesday",
    plannedWorkoutId: null,
    matchConfidence: null,
    sampleCount: 0,
    samplesFetchedAt: null,
    syncedAt: new Date().toISOString(),
  };
}

function fitnessAt140(watts: number): PowerHeartRateModel {
  return {
    source: "garmin",
    intercept: 0,
    slope: 2,
    rSquared: 0.9,
    residualStandardError: 5,
    sampleCount: 100,
    activityCount: 2,
    usableMinutes: 30,
    observedHeartRateRange: [120, 160],
    confidence: "medium",
    estimates: [{
      heartRate: 140,
      watts,
      lower95: watts - 10,
      upper95: watts + 10,
      wattsPerKg: null,
      extrapolated: false,
    }],
  };
}

describe("comparePlans", () => {
  const current = minimalPlan("current-plan", [
    { weekNumber: 1, start: "2026-08-03", end: "2026-08-09", miles: 40 },
    { weekNumber: 2, start: "2026-08-10", end: "2026-08-16", miles: 45 },
  ]);
  const prior = minimalPlan("prior-plan", [
    { weekNumber: 1, start: "2025-08-04", end: "2025-08-10", miles: 36 },
    { weekNumber: 2, start: "2025-08-11", end: "2025-08-17", miles: 40 },
  ]);

  const currentActivities = [
    run("2026-08-05", 20, 9, 150, 300),
    run("2026-08-08", 22, 8.5, 148, 310),
    run("2026-08-12", 25, 8.5, 147, 315),
  ];
  const priorActivities = [
    run("2025-08-06", 18, 9.5, 155, 285),
    run("2025-08-09", 19, 9.2, 153, 290),
    run("2025-08-13", 20, 9.3, 152, 292),
  ];

  it("aligns weeks by number and computes deltas", () => {
    const result = comparePlans({
      currentPlan: current,
      priorPlan: prior,
      currentActivities,
      priorActivities,
    });
    expect(result.totalWeeks).toBe(2);
    const w1 = result.weeks.find((w) => w.weekNumber === 1)!;
    // Current: 42 mi in window (Aug 5+8). Prior: 37 mi (Aug 6+9, 2025).
    expect(w1.current?.actualMileage).toBe(42);
    expect(w1.prior?.actualMileage).toBe(37);
    expect(w1.deltaMileage).toBeCloseTo(5, 0);
    // Current pace is faster (lower).
    expect(w1.deltaPace).not.toBeNull();
    expect(w1.deltaPace!).toBeLessThan(0);
  });

  it("produces an overall comparison summary", () => {
    const result = comparePlans({
      currentPlan: current,
      priorPlan: prior,
      currentActivities,
      priorActivities,
    });
    expect(result.summaries.current?.actualMileage).toBe(67);
    expect(result.summaries.prior?.actualMileage).toBe(57);
    expect(result.summaries.current?.averagePower).toBeCloseTo(308.88, 2);
    expect(result.summaries.prior?.averagePower).toBeCloseTo(289.12, 2);
  });

  it("uses modeled Power @ 140 when measured weekly power is unavailable", () => {
    const result = comparePlans({
      currentPlan: current,
      priorPlan: prior,
      currentActivities,
      priorActivities,
      currentModeledFitnessByWeek: new Map([["2026-08-03", fitnessAt140(340)]]),
      priorFitnessByWeek: new Map([["2025-08-04", fitnessAt140(320)]]),
      priorModeledFitnessByWeek: new Map([["2025-08-04", fitnessAt140(300)]]),
    });

    expect(result.weeks[0].current?.fitness).toBeNull();
    expect(result.weeks[0].current?.modeledFitness?.estimates[0].watts).toBe(340);
    expect(result.weeks[0].deltaPower140).toBe(20);
    expect(result.weeks[0].deltaPower140Estimated).toBe(true);
  });

  it("handles a missing prior plan gracefully", () => {
    const result = comparePlans({
      currentPlan: current,
      priorPlan: null,
      currentActivities,
      priorActivities: [],
    });
    expect(result.priorPlanId).toBeNull();
    expect(result.weeks[0].prior).toBeNull();
    expect(result.weeks[0].deltaMileage).toBeNull();
  });
});

describe("formatPaceShort", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatPaceShort(8.999)).toBe("9:00");
  });
});
