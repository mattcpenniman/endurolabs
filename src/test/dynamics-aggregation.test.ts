/** Running dynamics full-trace integration, coverage, split boundaries and display units. */
import { describe, expect, it } from "vitest";
import { buildDynamicsReport, buildDynamicsWindow, DYNAMICS_KEYS } from "@/lib/activities/running-dynamics";
import { buildActivitySplitOptions } from "@/lib/activities/activity-splits";
import { formatDynamics } from "@/lib/activities/dynamics-format";
import { downsampleActivitySamples } from "@/lib/activities/activity-chart";
import type { ActivityChartSample } from "@/lib/activities/models";

function sample(elapsedSeconds: number, fields: Partial<ActivityChartSample> = {}): ActivityChartSample {
  return { elapsedSeconds, speedMetersPerSecond: 3, heartRate: 140, power: 300, cadence: 90,
    strideLengthCm: 109.14, verticalOscillationCm: 6.44, verticalRatioPercent: 5.71,
    groundContactTimeMs: 272.3, groundContactBalanceLeftPercent: 50.79, ...fields };
}

describe("running dynamics aggregation", () => {
  it("matches constant provider values without fabricating missing balance or duration", () => {
    const samples = [0, 10, 20].map((time) => sample(time, { groundContactBalanceLeftPercent: null }));
    const report = buildDynamicsReport(samples, 30);
    expect(report.eligibleSeconds).toBe(20);
    expect(report.durationSeconds).toBe(30);
    expect(report.metrics.strideLengthCm.average).toBeCloseTo(109.14);
    expect(report.metrics.strideLengthCm).toMatchObject({ validSeconds: 20, coverage: 1 });
    expect(report.metrics.groundContactBalanceLeftPercent).toEqual({ average: null, validSeconds: 0, coverage: 0 });
    expect(report.bins.at(-1)?.metrics.strideLengthCm.average).toBeNull();
  });

  it("weights irregular intervals independently and clips linear values at split boundaries", () => {
    const samples = [sample(0, { strideLengthCm: 100, verticalOscillationCm: 6 }),
      sample(10, { strideLengthCm: 120, verticalOscillationCm: 8 }),
      sample(30, { strideLengthCm: 180, verticalOscillationCm: null })];
    const report = buildDynamicsReport(samples, 30);
    expect(report.metrics.strideLengthCm.average).toBeCloseTo(4100 / 30);
    expect(report.metrics.verticalOscillationCm).toEqual({ average: 7, validSeconds: 10, coverage: 1 / 3 });
    const options = buildActivitySplitOptions({ samples, durationSeconds: 30, summaryDistanceMeters: 2000, hasMeasuredPower: true });
    const [first, second] = options.kilometer;
    expect(first.elapsedSeconds).toBe(15);
    expect(first.dynamics?.metrics.strideLengthCm.average).toBeCloseTo(1737.5 / 15);
    expect(second.dynamics?.metrics.strideLengthCm.average).toBeCloseTo(157.5);
    expect(first.dynamics?.metrics.verticalOscillationCm.validSeconds).toBe(10);
    expect(second.dynamics?.metrics.verticalOscillationCm.average).toBeNull();
    for (const splits of Object.values(options)) {
      const seconds = splits.reduce((sum, split) => sum + split.dynamics!.metrics.strideLengthCm.validSeconds, 0);
      const weighted = splits.reduce((sum, split) => sum + (split.dynamics!.metrics.strideLengthCm.average ?? 0) * split.dynamics!.metrics.strideLengthCm.validSeconds, 0);
      expect(seconds).toBeCloseTo(30);
      expect(weighted / seconds).toBeCloseTo(report.metrics.strideLengthCm.average!);
    }
  });

  it("excludes gaps, stops and invalid speeds rather than treating them as zero", () => {
    const samples = [sample(0), sample(10), sample(50), sample(60, { speedMetersPerSecond: 0 }),
      sample(70), sample(80, { speedMetersPerSecond: 13 }), sample(90), sample(100)];
    const report = buildDynamicsReport(samples, 100);
    expect(report.eligibleSeconds).toBe(20);
    expect(report.metrics.strideLengthCm.validSeconds).toBe(20);
    expect(report.bins.find((bin) => bin.startSeconds === 30)?.eligibleSeconds).toBe(0);
  });

  it("handles no traces and zero eligible time explicitly", () => {
    for (const samples of [[], [sample(0)], [sample(0), sample(40)], [sample(0, { speedMetersPerSecond: null }), sample(10)]]) {
      const report = buildDynamicsReport(samples, 50);
      expect(report.eligibleSeconds).toBe(0);
      for (const key of DYNAMICS_KEYS) expect(report.metrics[key]).toEqual({ average: null, validSeconds: 0, coverage: null });
    }
  });

  it("rejects invalid metrics individually and never uses a single endpoint to bridge nulls", () => {
    const report = buildDynamicsReport([sample(0), sample(10, { verticalOscillationCm: 0,
      verticalRatioPercent: NaN, groundContactTimeMs: 2001, groundContactBalanceLeftPercent: null })], 10);
    expect(report.metrics.strideLengthCm.validSeconds).toBe(10);
    for (const key of DYNAMICS_KEYS.filter((key) => key !== "strideLengthCm")) {
      expect(report.metrics[key]).toEqual({ average: null, validSeconds: 0, coverage: 0 });
    }
  });

  it("aggregates every stored sample before bounded chart reduction, preserving null bins", () => {
    const samples = Array.from({ length: 7201 }, (_, index) => sample(index, {
      strideLengthCm: index % 2 ? 200 : 100,
      groundContactBalanceLeftPercent: index >= 3000 && index <= 4000 ? null : 50.79,
    }));
    const report = buildDynamicsReport(samples, 7200);
    expect(report.metrics.strideLengthCm.average).toBeCloseTo(150);
    expect(report.bins).toHaveLength(360);
    expect(report.bins.every((bin) => bin.metrics.strideLengthCm.average === 150)).toBe(true);
    expect(report.bins[160].metrics.groundContactBalanceLeftPercent.average).toBeNull();
    expect(report.bins[160].paceMinutesPerMile).toBeCloseTo(1609.344 / 3 / 60);
    // Uniform display decimation can alias this alternating signal; it is never the aggregation input.
    expect(downsampleActivitySamples(samples, 10).length).toBeLessThan(samples.length);
  });

  it("sorts and deduplicates trace times and bounds contributing duration to the requested window", () => {
    const report = buildDynamicsReport([sample(20), sample(0), sample(10), sample(10)], 20);
    expect(report.metrics.strideLengthCm.validSeconds).toBe(20);
    expect(buildDynamicsWindow([sample(0), sample(10)], 2.5, 7.5).metrics.strideLengthCm.validSeconds).toBe(5);
  });

  it("formats explicit metric/imperial units and derives RIGHT only from valid LEFT", () => {
    expect(formatDynamics("strideLengthCm", 109.14, "metric")).toBe("1.09 m");
    expect(formatDynamics("strideLengthCm", 109.14, "imperial")).toBe("3.58 ft");
    expect(formatDynamics("verticalOscillationCm", 6.44, "imperial")).toBe("6.44 cm");
    expect(formatDynamics("groundContactTimeMs", 272.3, "metric")).toBe("272.3 ms");
    expect(formatDynamics("verticalRatioPercent", 5.71, "metric")).toBe("5.71%");
    expect(formatDynamics("groundContactBalanceLeftPercent", 50.79, "metric")).toBe("50.79% left / 49.21% right");
    for (const value of [null, undefined, 0, -1, 101, Infinity, NaN]) {
      expect(formatDynamics("groundContactBalanceLeftPercent", value, "imperial")).toBe("Unavailable");
    }
  });
});
