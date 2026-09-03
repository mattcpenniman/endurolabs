// ============================================================
// EnduroLab - Garmin Activity Detail Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { mapGarminActivityDetail } from "@/lib/garmin/activity-detail";

describe("Garmin activity detail", () => {
  it("maps descriptor-indexed metrics into chronological samples", () => {
    const start = new Date("2026-08-04T10:30:00.000Z");
    const payload = {
      metricDescriptors: [
        { metricsIndex: 0, key: "directTimestamp" },
        { metricsIndex: 1, key: "directElapsedTime" },
        { metricsIndex: 2, key: "directDistance" },
        { metricsIndex: 3, key: "directHeartRate" },
        { metricsIndex: 4, key: "directPower" },
        { metricsIndex: 5, key: "directSpeed" },
        { metricsIndex: 6, key: "directElevation" },
        { metricsIndex: 7, key: "directGrade" },
        { metricsIndex: 8, key: "directRunCadence" },
        { metricsIndex: 9, key: "directLatitude" },
        { metricsIndex: 10, key: "directLongitude" },
        { metricsIndex: 11, key: "directTemperature" },
      ],
      activityDetailMetrics: [
        { metrics: [start.getTime() + 2000, 2, 6.2, 142, 277, 3.1, 81.4, 1.2, 170, 40.1, -74.2, 13] },
        { metrics: [start.getTime(), 0, 0, 138, 264, 3, 80.8, 0, 168, 40, -74, 12] },
      ],
    };

    expect(mapGarminActivityDetail(payload, start)).toEqual([
      expect.objectContaining({
        timestamp: start,
        elapsedSeconds: 0,
        distanceMeters: 0,
        heartRate: 138,
        power: 264,
        cadence: 168,
        latitude: 40,
      }),
      expect.objectContaining({
        timestamp: new Date(start.getTime() + 2000),
        elapsedSeconds: 2,
        distanceMeters: 6.2,
        heartRate: 142,
        power: 277,
        speedMetersPerSecond: 3.1,
      }),
    ]);
  });

  it("derives timestamps, converts semicircle coordinates, and deduplicates elapsed seconds", () => {
    const start = new Date("2026-08-04T10:30:00.000Z");
    const samples = mapGarminActivityDetail({
      activityDetailMetrics: [
        { elapsedTime: 1.1, heartRate: 140 },
        { elapsedTime: 1.4, heartRate: 141, positionLat: 2 ** 30, positionLong: -(2 ** 30) },
        { elapsedTime: 3, heartRate: 143 },
      ],
    }, start);

    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ elapsedSeconds: 1, heartRate: 141, latitude: 90, longitude: -90 });
    expect(samples[0].timestamp).toEqual(new Date(start.getTime() + 1400));
    expect(samples[1].elapsedSeconds).toBe(3);
  });
});
