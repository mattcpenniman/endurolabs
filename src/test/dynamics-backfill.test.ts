import { describe, expect, it } from "vitest";
import { backfillErrorCode, parseBackfillOptions, retryDelay, sampleCoverage, validateDynamicsDetail } from "../lib/garmin/dynamics-backfill";

const start = new Date("2026-01-01T00:00:00Z");
const detail = {
  totalMetricsCount: 2,
  metricDescriptors: [
    { key: "directElapsedTime", metricsIndex: 0 },
    { key: "directVerticalOscillation", metricsIndex: 1, unit: { key: "centimeter", factor: 1 } },
  ],
  activityDetailMetrics: [{ metrics: [0, 6.44] }, { metrics: [1, 6.45] }],
};
describe("dynamics backfill contract", () => {
  it("requires explicit scope, bounded limits and valid inclusive dates", () => {
    expect(parseBackfillOptions(["--email", "a@example.test"])).toMatchObject({ apply: false, limit: 100 });
    for (const args of [[], ["--email", "x", "--user-id", "x"], ["--email", "x", "--limit", "0"],
      ["--email", "x", "--limit", "1001"], ["--email", "x", "--since", "2026-02-30"],
      ["--email", "x", "--since", "2026-02-01", "--through", "2026-01-01"], ["--all"]]) {
      expect(() => parseBackfillOptions(args)).toThrow();
    }
  });
  it("counts each metric independently and treats absent balance as unavailable", () => {
    expect(sampleCoverage(validateDynamicsDetail(detail, start))).toEqual({ vertical_oscillation_cm: 2,
      vertical_ratio_percent: 0, ground_contact_time_ms: 0, ground_contact_balance_left_percent: 0, stride_length_cm: 0 });
    expect(validateDynamicsDetail({ totalMetricsCount: 0, metricDescriptors: [], activityDetailMetrics: [] }, start)).toEqual([]);
  });
  it("rejects summary-only, truncated, duplicate and timestamp-inconsistent payloads", () => {
    for (const value of [{ summaryDTO: {} }, { ...detail, totalMetricsCount: 3 },
      { ...detail, activityDetailMetrics: [{ metrics: [0, 6] }, { metrics: [0, 7] }] },
      { ...detail, metricDescriptors: [{ key: "directElapsedTime", metricsIndex: 0 }, { key: "directTimestamp", metricsIndex: 1 }],
        activityDetailMetrics: [{ metrics: [0, start.getTime() + 5000] }, { metrics: [1, start.getTime() + 6000] }] }]) {
      expect(() => validateDynamicsDetail(value, start)).toThrow();
    }
  });
  it("accepts repeated provider timestamps only when every dynamics value agrees", () => {
    const timestamp = start.getTime();
    const repeated = {
      totalMetricsCount: 3,
      metricDescriptors: [
        { key: "directTimestamp", metricsIndex: 0 },
        { key: "directVerticalOscillation", metricsIndex: 1, unit: { key: "centimeter", factor: 1 } },
        { key: "directHeartRate", metricsIndex: 2 },
      ],
      activityDetailMetrics: [
        { metrics: [timestamp, 6.44, 130] },
        { metrics: [timestamp, 6.44, 131] },
        { metrics: [timestamp + 1000, 6.45, 132] },
      ],
    };
    const samples = validateDynamicsDetail(repeated, start);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({ elapsedSeconds: 0, verticalOscillationCm: 6.44, heartRate: 131 });
    expect(sampleCoverage(samples).vertical_oscillation_cm).toBe(2);
    // Conflicting or missing dynamics must not be silently filled or discarded.
    for (const conflicting of [6.5, null]) {
      expect(() => validateDynamicsDetail({ ...repeated, activityDetailMetrics: [
        repeated.activityDetailMetrics[0], { metrics: [timestamp, conflicting, 131] },
        repeated.activityDetailMetrics[2],
      ] }, start)).toThrow("invalid_alignment");
    }
    expect(() => validateDynamicsDetail({ ...repeated, activityDetailMetrics: [
      repeated.activityDetailMetrics[0], { metrics: [timestamp + 100, 6.44, 131] },
      repeated.activityDetailMetrics[2],
    ] }, start)).toThrow("invalid_alignment");
  });
  it("does not certify dropped invalid rows even when the remaining timestamps align", () => {
    expect(() => validateDynamicsDetail({ ...detail, activityDetailMetrics: [
      { metrics: [-1, 6.44] }, { metrics: [1, 6.45] },
    ] }, start)).toThrow("invalid_alignment");
  });
  it("bounds retries, honors rate limits and does not replay auth/MFA failures", () => {
    expect(retryDelay({ response: { status: 429, headers: { "retry-after": "30" } } }, 1)).toBe(30000);
    expect(retryDelay({ response: { status: 429, headers: { "retry-after": "600" } } }, 1)).toBeNull();
    expect(retryDelay(new Error("network"), 2)).toBe(4000);
    expect(retryDelay(new Error("network"), 3)).toBeNull();
    expect(retryDelay({ response: { status: 401 } }, 1)).toBeNull();
    expect(retryDelay({ name: "GarminMfaRequiredError" }, 1)).toBeNull();
    expect(backfillErrorCode(new Error("private token in transport"))).toBe("request_failed");
    for (const code of ["invalid_alignment", "stored_alignment_changed", "incomplete_detail", "coverage_mismatch"]) {
      expect(retryDelay(new Error(code), 1)).toBeNull();
    }
  });
});
