// ============================================================
// EnduroLab - Race Execution Analysis Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { analyzeRaceExecution, type RaceExecutionSample } from "@/lib/analytics/race-execution";

function makeSamples(options: {
  seconds: number;
  speed: (second: number) => number;
  heartRate?: (second: number) => number | null;
  power?: (second: number) => number | null;
  cadence?: (second: number) => number | null;
}): RaceExecutionSample[] {
  return Array.from({ length: options.seconds }, (_, second) => ({
    elapsedSeconds: second,
    distanceMeters: null,
    speedMetersPerSecond: options.speed(second),
    heartRate: options.heartRate ? options.heartRate(second) : null,
    power: options.power ? options.power(second) : null,
    cadence: options.cadence ? options.cadence(second) : null,
  }));
}

describe("analyzeRaceExecution", () => {
  it("classifies a steady effort as well executed", () => {
    const analysis = analyzeRaceExecution(makeSamples({
      seconds: 3600,
      speed: () => 3.3,
      heartRate: () => 165,
      power: () => 300,
    }));

    expect(analysis.quality).toBe("well_executed");
    expect(analysis.sampleCount).toBe(3600);
    expect(analysis.integratedDistanceMeters).toBeGreaterThan(11_000);
    expect(analysis.positiveSplitSeconds).toBeCloseTo(0, 0);
    expect(analysis.powerFadePercent).toBeCloseTo(0, 5);
  });

  it("classifies a negative split as well executed", () => {
    const analysis = analyzeRaceExecution(makeSamples({
      seconds: 3600,
      speed: (second) => (second < 1800 ? 3.2 : 3.5),
      heartRate: () => 165,
    }));

    expect(analysis.quality).toBe("well_executed");
    expect(analysis.positiveSplitSeconds).toBeLessThan(0);
  });

  it("flags a positive split without a fade as positive_split, not a blow-up", () => {
    const analysis = analyzeRaceExecution(makeSamples({
      seconds: 3600,
      speed: (second) => (second < 1800 ? 3.5 : 3.0),
      heartRate: (second) => 160 + (second / 3600) * 15,
      power: (second) => 300 + (second / 3600) * 20,
    }));

    expect(analysis.quality).toBe("positive_split");
    expect(analysis.positiveSplitPercent).toBeGreaterThan(10);
    expect(analysis.heartRateFadeBpm).toBeGreaterThan(0);
  });

  it("classifies the Berlin 2026 blow-up signature (falling power, flat heart rate)", () => {
    const analysis = analyzeRaceExecution(makeSamples({
      seconds: 3600,
      speed: (second) => (second < 1800 ? 3.6 : second < 3000 ? 2.9 : 2.3),
      heartRate: () => 174,
      power: (second) => (second < 1800 ? 395 : 350),
      cadence: (second) => (second < 1800 ? 172 : 160),
    }));

    expect(analysis.quality).toBe("blow_up");
    expect(analysis.positiveSplitPercent).toBeGreaterThan(20);
    expect(analysis.powerFadePercent).toBeLessThan(-10);
    expect(analysis.cadenceFade).toBeLessThan(0);
  });

  it("uses the closing 10K degradation when heart rate and power are missing", () => {
    const analysis = analyzeRaceExecution(makeSamples({
      seconds: 6000,
      speed: (second) => (second < 3000 ? 3.7 : 3.0),
    }));

    expect(analysis.integratedDistanceMeters).toBeGreaterThan(20_000);
    expect(analysis.closing10kDeltaPercent).toBeGreaterThan(15);
    expect(analysis.quality).toBe("blow_up");
  });

  it("returns insufficient_data without enough samples or distance", () => {
    const tooShort = analyzeRaceExecution(makeSamples({ seconds: 30, speed: () => 3.3, heartRate: () => 160 }));
    expect(tooShort.quality).toBe("insufficient_data");
    expect(tooShort.positiveSplitPercent).toBeNull();

    const enoughSamplesShortDistance = analyzeRaceExecution(makeSamples({ seconds: 600, speed: () => 3.0 }));
    expect(enoughSamplesShortDistance.quality).toBe("insufficient_data");
    expect(enoughSamplesShortDistance.integratedDistanceMeters).toBeLessThan(2000);
  });

  it("prefers provider distance over integrated speed when present", () => {
    const samples = makeSamples({ seconds: 3600, speed: () => 3.3, heartRate: () => 160 });
    const analysis = analyzeRaceExecution(samples.map((sample, index) => ({
      ...sample,
      distanceMeters: index * 3.4,
    })));
    expect(analysis.integratedDistanceMeters).toBeCloseTo(3599 * 3.4, 0);
  });
});