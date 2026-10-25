import { describe, expect, it } from "vitest";
import { mapGarminActivityDetail } from "@/lib/garmin/activity-detail";
import { normalizeGarminActivity } from "@/lib/garmin/activities";
import { mapGarminSummaryDynamics, DYNAMICS_FIELDS } from "@/lib/garmin/running-dynamics.mjs";

// Whitelisted synthetic fixture matching the descriptors/aliases confirmed in DOC-368.
const dynamicsFixture = {
  metricDescriptors: [
    { key: "directElapsedTime", metricsIndex: 0 },
    { key: "directVerticalOscillation", metricsIndex: 1, unit: { key: "centimeter", factor: 1 } },
    { key: "directVerticalRatio", metricsIndex: 2, unit: { key: "dimensionless", factor: 1 } },
    { key: "directGroundContactTime", metricsIndex: 3, unit: { key: "ms", factor: 1 } },
    { key: "directGroundContactBalanceLeft", metricsIndex: 4, unit: { key: "dimensionless", factor: 1 } },
    { key: "directStrideLength", metricsIndex: 5, unit: { key: "centimeter", factor: 1 } },
    { key: "directVerticalSpeed", metricsIndex: 6 },
    { key: "directDistance", metricsIndex: 7 },
    { key: "directHeartRate", metricsIndex: 8 },
    { key: "directPower", metricsIndex: 9 },
    { key: "directSpeed", metricsIndex: 10 },
  ],
  activityDetailMetrics: [
    { metrics: [0, 6.44, 5.71, 272.3, 50.79, 109.14, 99, 0, 140, 300, 4] },
    { metrics: [10, 7.12, 6.23, 280.7, null, 112.78, 99, 40, 142, 310, 4] },
    { metrics: [30, 8.24, null, 290.9, 49.21, 115.62, 99, 120, 144, 320, 4] },
  ],
};

const start = new Date("2026-10-25T07:00:00Z");
const expected = { verticalOscillationCm: 6.44, verticalRatioPercent: 5.71, groundContactTimeMs: 272.3,
  groundContactBalanceLeftPercent: 50.79, strideLengthCm: 109.14 };

describe("Garmin measured dynamics contract", () => {
  it("preserves actual fractional samples, original timing and legacy metrics without scaling percentages", () => {
    const samples = mapGarminActivityDetail(dynamicsFixture, start);
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({ ...expected, elapsedSeconds: 0, distanceMeters: 0, heartRate: 140, power: 300 });
    expect(samples[1]).toMatchObject({ elapsedSeconds: 10, verticalOscillationCm: 7.12, groundContactBalanceLeftPercent: null });
    expect(samples[2].timestamp.toISOString()).toBe("2026-10-25T07:00:30.000Z");
  });

  it("maps both list aliases and summaryDTO without inventing absent LEFT balance", () => {
    const values = Object.values(expected);
    const list = Object.fromEntries(Object.values(DYNAMICS_FIELDS).map(([key], index) => [key, values[index]]));
    const dto = Object.fromEntries(Object.values(DYNAMICS_FIELDS).map(([, key], index) => [key, values[index]]));
    expect(mapGarminSummaryDynamics(list)).toEqual(expected);
    expect(mapGarminSummaryDynamics({ summaryDTO: dto })).toEqual(expected);
    expect(normalizeGarminActivity({ ...list, activityId: 123, startTimeLocal: "2026-10-25 07:00:00",
      startTimeGMT: "2026-10-25T07:00:00" })).toMatchObject(expected);
    expect(mapGarminSummaryDynamics({ summaryDTO: { groundContactBalance: 50 } }).groundContactBalanceLeftPercent).toBeNull();
    expect(mapGarminSummaryDynamics({ avgGroundContactBalance: null, summaryDTO: dto }).groundContactBalanceLeftPercent).toBeNull();
  });

  it.each([undefined, null, 0, -1, NaN, Infinity, -Infinity, "6.44", true, 1e10])(
    "keeps invalid/missing sensor value %s unavailable independently", (value) => {
      const list = Object.fromEntries(Object.values(DYNAMICS_FIELDS).map(([key]) => [key, value]));
      expect(Object.values(mapGarminSummaryDynamics(list))).toEqual([null, null, null, null, null]);
      const samples = mapGarminActivityDetail({ activityDetailMetrics: [{ directElapsedTime: 5,
        directVerticalOscillation: value, directVerticalRatio: value, directGroundContactTime: value,
        directGroundContactBalanceLeft: value, directStrideLength: value, directPower: 301 }] }, start);
      expect(samples[0]).toMatchObject({ verticalOscillationCm: null, verticalRatioPercent: null,
        groundContactTimeMs: null, groundContactBalanceLeftPercent: null, strideLengthCm: null, power: 301 });
    },
  );

  it("rejects conflicting units, ignores vertical speed and never fills gaps with summary averages", () => {
    const fixture = structuredClone(dynamicsFixture);
    fixture.metricDescriptors[1].unit = { key: "m", factor: 1 };
    expect(mapGarminActivityDetail(fixture, start)[0].verticalOscillationCm).toBeNull();
    fixture.metricDescriptors[1].unit = { key: "cm", factor: 100 };
    expect(mapGarminActivityDetail(fixture, start)[0].verticalOscillationCm).toBeNull();
    expect(mapGarminActivityDetail({ avgVerticalOscillation: 6.44, activityDetailMetrics: [
      { directElapsedTime: 1, directVerticalSpeed: 6.44 },
    ] }, start)[0].verticalOscillationCm).toBeNull();
    const noBalance = { ...dynamicsFixture, metricDescriptors: dynamicsFixture.metricDescriptors.filter(
      (descriptor) => descriptor.key !== "directGroundContactBalanceLeft") };
    expect(mapGarminActivityDetail(noBalance, start).every((sample) => sample.groundContactBalanceLeftPercent === null)).toBe(true);
  });

  it("enforces individual broad bounds while retaining valid fractions at the boundary", () => {
    for (const [field, [key, , descriptor, max]] of Object.entries(DYNAMICS_FIELDS)) {
      expect(mapGarminSummaryDynamics({ [key]: max })[field as keyof typeof expected]).toBe(max);
      expect(mapGarminSummaryDynamics({ [key]: max + 0.01 })[field as keyof typeof expected]).toBeNull();
      expect(mapGarminActivityDetail({ metrics: [{ directElapsedTime: 0, [descriptor]: max + 0.01 }] }, start)[0][field as keyof typeof expected]).toBeNull();
    }
  });
});
