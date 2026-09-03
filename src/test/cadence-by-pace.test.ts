// ============================================================
// EnduroLab - Cadence By Pace Analytics Tests
// ============================================================

import { describe, expect, it } from "vitest";
import {
  analyzeCadenceByPace,
  CadenceSampleInput,
  CadenceWeekWindow,
} from "@/lib/analytics/cadence-by-pace";

const MILE_METERS = 1609.344;

function trace({
  activityId,
  date,
  paceSeconds,
  cadence,
  windows = 20,
  offsets = [0, 10, 20],
}: {
  activityId: string;
  date: string;
  paceSeconds: number;
  cadence: number;
  windows?: number;
  offsets?: number[];
}): CadenceSampleInput[] {
  return Array.from({ length: windows }, (_, windowIndex) => offsets.map((offset) => ({
    activityId,
    activityStartDate: date,
    elapsedSeconds: windowIndex * 30 + offset,
    cadence,
    speedMetersPerSecond: MILE_METERS / paceSeconds,
  }))).flat();
}

const weeks: CadenceWeekWindow[] = [
  { weekNumber: 1, startDate: "2026-08-03", endDate: "2026-08-09" },
  { weekNumber: 2, startDate: "2026-08-10", endDate: "2026-08-16" },
];

describe("analyzeCadenceByPace", () => {
  it("trends cadence by week within the same fixed pace band", () => {
    const result = analyzeCadenceByPace([
      ...trace({ activityId: "week-1", date: "2026-08-05", paceSeconds: 485, cadence: 170 }),
      ...trace({ activityId: "week-2", date: "2026-08-12", paceSeconds: 495, cadence: 174 }),
    ], weeks);

    expect(result.bands).toHaveLength(1);
    expect(result.bands[0].label).toBe("8:00-8:29 /mi");
    expect(result.bands[0].weeks).toEqual([
      { weekNumber: 1, cadenceSpm: 170, usableMinutes: 10, activityCount: 1 },
      { weekNumber: 2, cadenceSpm: 174, usableMinutes: 10, activityCount: 1 },
    ]);
  });

  it("keeps faster running in a separate comparable pace band", () => {
    const result = analyzeCadenceByPace([
      ...trace({ activityId: "easy", date: "2026-08-05", paceSeconds: 500, cadence: 168 }),
      ...trace({ activityId: "fast", date: "2026-08-05", paceSeconds: 430, cadence: 182 }),
    ], weeks);

    expect(result.bands.map((band) => band.label)).toEqual(["7:00-7:29 /mi", "8:00-8:29 /mi"]);
    expect(result.bands.map((band) => band.weeks[0].cadenceSpm)).toEqual([182, 168]);
  });

  it("uses medians so isolated valid sensor spikes do not move the weekly value", () => {
    const samples = trace({ activityId: "spike", date: "2026-08-05", paceSeconds: 485, cadence: 170 });
    for (const sample of samples.filter((entry) => entry.elapsedSeconds >= 300 && entry.elapsedSeconds < 330)) {
      sample.cadence = 230;
    }

    const result = analyzeCadenceByPace(samples, weeks);
    expect(result.bands[0].weeks[0].cadenceSpm).toBe(170);
  });

  it("normalizes Garmin half-cadence while preserving full steps per minute", () => {
    const halfCadence = analyzeCadenceByPace(
      trace({ activityId: "garmin", date: "2026-08-05", paceSeconds: 485, cadence: 85 }),
      weeks,
    );
    const fullCadence = analyzeCadenceByPace(
      trace({ activityId: "full", date: "2026-08-05", paceSeconds: 485, cadence: 170 }),
      weeks,
    );

    expect(halfCadence.bands[0].weeks[0].cadenceSpm).toBe(170);
    expect(fullCadence.bands[0].weeks[0].cadenceSpm).toBe(170);
  });

  it("rejects sparse windows, short support, and implausible paired samples", () => {
    const sparse = trace({ activityId: "sparse", date: "2026-08-05", paceSeconds: 485, cadence: 170, offsets: [0, 10] });
    const short = trace({ activityId: "short", date: "2026-08-05", paceSeconds: 485, cadence: 170, windows: 19 });
    const invalid = trace({ activityId: "invalid", date: "2026-08-05", paceSeconds: 485, cadence: 40 });

    expect(analyzeCadenceByPace(sparse, weeks).bands).toEqual([]);
    expect(analyzeCadenceByPace(short, weeks).bands).toEqual([]);
    expect(analyzeCadenceByPace(invalid, weeks).bands).toEqual([]);
  });

  it("uses identical pace boundaries for plans with different dates", () => {
    const priorWeeks = [{ weekNumber: 1, startDate: "2025-01-06", endDate: "2025-01-12" }];
    const current = analyzeCadenceByPace(
      trace({ activityId: "current", date: "2026-08-05", paceSeconds: 485, cadence: 172 }),
      weeks,
    );
    const prior = analyzeCadenceByPace(
      trace({ activityId: "prior", date: "2025-01-08", paceSeconds: 485, cadence: 169 }),
      priorWeeks,
    );

    expect(current.bands[0].key).toBe(prior.bands[0].key);
    expect(current.bands[0].label).toBe(prior.bands[0].label);
  });
});
