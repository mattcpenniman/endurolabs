import { describe, expect, it } from "vitest";
import { summarizeTimeAtEffort } from "@/lib/analytics/time-at-effort";
import type { ActivityChartSample } from "@/lib/activities/models";
import type { HeartRateZone, PaceZones, PowerZones } from "@/lib/training/models";

function zone(min: number, max: number): HeartRateZone {
  return {
    hrrPercent: { min: 0, max: 1 },
    hrMaxPercent: { min: 0, max: 1 },
    targetBpm: { min, max },
  };
}

const heartRateZones: PaceZones["heartRateZones"] = {
  recovery: zone(120, 135),
  easy: zone(135, 153),
  marathon: zone(154, 165),
  threshold: zone(168, 176),
  vo2: zone(179, 185),
};

const powerZones: PowerZones = {
  easy: { min: 200, max: 240 },
  marathon: 280,
  threshold: 310,
  vo2: 340,
};

function sample(
  elapsedSeconds: number,
  overrides: Partial<ActivityChartSample> = {},
): ActivityChartSample {
  return {
    elapsedSeconds,
    heartRate: 160,
    power: 220,
    cadence: 85,
    speedMetersPerSecond: 3,
    ...overrides,
  };
}

function constantRun(
  seconds: number,
  overrides: Partial<ActivityChartSample> = {},
): ActivityChartSample[] {
  const samples: ActivityChartSample[] = [];
  for (let elapsed = 0; elapsed <= seconds; elapsed += 10) {
    samples.push(sample(elapsed, overrides));
  }
  return samples;
}

function heartRateSeconds(result: ReturnType<typeof summarizeTimeAtEffort>, zoneName: string): number {
  return result.heartRate?.buckets.find((bucket) => bucket.zone === zoneName)?.seconds ?? -1;
}

function powerSeconds(result: ReturnType<typeof summarizeTimeAtEffort>, zoneName: string): number {
  return result.power?.buckets.find((bucket) => bucket.zone === zoneName)?.seconds ?? -1;
}

describe("time at effort", () => {
  it("classifies a steady run into the zone whose ceiling covers its heart rate", () => {
    const cases: Array<[number, string]> = [
      [130, "recovery"],
      [148, "easy"],
      [160, "marathon"],
      [172, "threshold"],
      [182, "vo2"],
    ];

    for (const [heartRate, zoneName] of cases) {
      const result = summarizeTimeAtEffort({
        samples: constantRun(100, { heartRate }),
        heartRateZones,
      });
      expect(heartRateSeconds(result, zoneName)).toBe(100);
      expect(result.heartRate?.totalSeconds).toBe(100);
    }
  });

  it("splits changing heart rate into the correct cumulative buckets", () => {
    const samples = [
      sample(0, { heartRate: 130 }),
      sample(30, { heartRate: 130 }),
      sample(60, { heartRate: 148 }),
      sample(90, { heartRate: 172 }),
      sample(120, { heartRate: 172 }),
      sample(150, { heartRate: 182 }),
    ];
    const result = summarizeTimeAtEffort({ samples, heartRateZones });

    expect(result.heartRate?.totalSeconds).toBe(150);
    expect(result.heartRate?.unclassifiedSeconds).toBe(0);
  });

  it("counts intervals without a heart rate as unclassified", () => {
    const samples = [
      sample(0, { heartRate: null }),
      sample(30, { heartRate: null }),
      sample(60, { heartRate: 148 }),
      sample(90, { heartRate: 148 }),
    ];
    const result = summarizeTimeAtEffort({ samples, heartRateZones });

    expect(result.heartRate?.totalSeconds).toBe(60);
    expect(result.heartRate?.unclassifiedSeconds).toBe(30);
  });

  it("drops intervals longer than 30 seconds as pauses", () => {
    const result = summarizeTimeAtEffort({
      samples: [sample(0), sample(600)],
      heartRateZones,
    });

    expect(result.heartRate?.totalSeconds).toBe(0);
    expect(result.heartRate?.unclassifiedSeconds).toBe(0);
  });

  it("excludes stationary intervals between speed samples", () => {
    const samples = [
      sample(0, { speedMetersPerSecond: 0 }),
      sample(30, { speedMetersPerSecond: 0 }),
      sample(60, { speedMetersPerSecond: 3 }),
      sample(90, { speedMetersPerSecond: 3 }),
    ];
    const result = summarizeTimeAtEffort({ samples, heartRateZones });

    expect(result.heartRate?.totalSeconds).toBe(60);
  });

  it("handles unsorted and duplicate sample times", () => {
    const samples = [
      sample(30),
      sample(0),
      sample(30),
      sample(60),
    ];
    const result = summarizeTimeAtEffort({ samples, heartRateZones });

    expect(result.heartRate?.totalSeconds).toBe(60);
  });

  it("buckets measured power using midpoint ceilings between anchors", () => {
    const cases: Array<[number, string]> = [
      [150, "recovery"],
      [220, "easy"],
      [285, "marathon"],
      [320, "threshold"],
      [340, "vo2"],
    ];

    for (const [power, zoneName] of cases) {
      const result = summarizeTimeAtEffort({
        samples: constantRun(100, { power }),
        powerZones,
        hasMeasuredPower: true,
      });
      expect(powerSeconds(result, zoneName)).toBe(100);
    }
  });

  it("never buckets modeled power as measured effort", () => {
    const result = summarizeTimeAtEffort({
      samples: constantRun(100),
      powerZones,
      hasMeasuredPower: false,
    });

    expect(result.power).toBeNull();
  });

  it("returns null heart-rate time without zone targets", () => {
    const noTarget = { hrrPercent: { min: 0, max: 1 }, hrMaxPercent: { min: 0, max: 1 }, targetBpm: null };
    const result = summarizeTimeAtEffort({
      samples: constantRun(100),
      heartRateZones: {
        recovery: noTarget,
        easy: noTarget,
        marathon: noTarget,
        threshold: noTarget,
        vo2: noTarget,
      },
    });

    expect(result.heartRate).toBeNull();
  });

  it("reports the activity duration from the samples", () => {
    const result = summarizeTimeAtEffort({
      samples: constantRun(100),
      heartRateZones,
    });

    expect(result.durationSeconds).toBe(100);
  });
});