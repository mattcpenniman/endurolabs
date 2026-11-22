/** Dated-schedule guard used by /api/stats before windowing activities by plan week. */
import { describe, expect, it } from "vitest";
import { hasDatedSchedule } from "@/lib/training/plan-schedule";

const datedWeek = {
  weekNumber: 1,
  startDate: "2026-11-02T00:00:00.000Z",
  endDate: "2026-11-08T00:00:00.000Z",
  days: [{ date: "2026-11-02T00:00:00.000Z" }, { date: "2026-11-08T00:00:00.000Z" }],
};

describe("hasDatedSchedule", () => {
  it("accepts a generated plan with dated weeks", () => {
    expect(hasDatedSchedule({ weeks: [datedWeek] })).toBe(true);
  });

  it("falls back to the week endDate when the days array is empty", () => {
    expect(hasDatedSchedule({ weeks: [{ ...datedWeek, days: [] }] })).toBe(true);
  });

  it("rejects the stored phase-level stub that broke the stats page", () => {
    const stub = {
      phases: [{ name: "base", weekRange: [0, 3] }],
      weeks: [
        { weekNumber: 0, phase: "base", weeklyMileageTarget: 11 },
        { weekNumber: 3, phase: "race_week", weeklyMileageTarget: 40 },
      ],
      paceZones: {},
    };
    expect(hasDatedSchedule(stub)).toBe(false);
  });

  it("rejects missing, empty, and non-object plans", () => {
    expect(hasDatedSchedule(null)).toBe(false);
    expect(hasDatedSchedule("{\"weeks\":[]}")).toBe(false);
    expect(hasDatedSchedule({ weeks: [] })).toBe(false);
    expect(hasDatedSchedule({ weeks: [{ ...datedWeek, days: [{ date: null }], endDate: undefined }] })).toBe(false);
  });
});
