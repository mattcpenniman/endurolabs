/** Garmin's daily endpoint totals retain local dates and distinguish missing from zero. */
import { describe, expect, it } from "vitest";
import { chunkStepsRange, normalizeDailySteps, summarizeWeeklySteps, validateStepsRange } from "@/lib/garmin/daily-steps";
const range = { startDate: "2026-03-01", endDate: "2026-03-07" };
describe("Garmin daily steps", () => {
  it("maps whole-day totals including zero, not activity steps or goals", () => {
    expect(normalizeDailySteps([
      { calendarDate: "2026-03-03", totalSteps: 12567, stepGoal: 10000 },
      { calendarDate: "2026-03-01", totalSteps: 0 },
      { calendarDate: "2026-03-02", totalSteps: null },
      { calendarDate: "2026-03-04", steps: 2000 },
      { calendarDate: "2026-04-01", totalSteps: 999 },
    ], range)).toEqual([{ localDate: "2026-03-01", totalSteps: 0 }, { localDate: "2026-03-03", totalSteps: 12567 }]);
  });
  it("rejects malformed payloads without fabricating empty history", () => {
    for (const payload of [{}, null, [null], [{ calendarDate: "2026-03-02", totalSteps: -1 }],
      [{ calendarDate: "2026-03-02", totalSteps: "12" }], [{ calendarDate: "2026-03-02", totalSteps: 1.5 }],
      [{ calendarDate: "2026-02-30", totalSteps: 2 }]]) {
      expect(() => normalizeDailySteps(payload, range)).toThrow();
    }
    expect(() => normalizeDailySteps(Array(2).fill({ calendarDate: "2026-03-02", totalSteps: 4 }), range)).toThrow(/Duplicate/);
  });
  it("validates true calendar dates, order and Garmin's inclusive 28-day maximum", () => {
    expect(validateStepsRange("2024-02-29", "2024-03-27")).toEqual({ startDate: "2024-02-29", endDate: "2024-03-27" });
    for (const [start, end] of [["2026-02-29", "2026-03-02"], ["2026-03-02", "2026-03-01"],
      ["2026-03-01", "2026-03-29"], ["2026-3-1", "2026-03-07"], ["2026-03-01T00:00:00Z", "2026-03-07"]]) {
      expect(() => validateStepsRange(start, end)).toThrow();
    }
  });
  it("chunks history without overlaps or missed month boundaries", () => {
    expect(chunkStepsRange({ startDate: "2024-02-01", endDate: "2024-03-01" })).toEqual([
      { startDate: "2024-02-01", endDate: "2024-02-28" }, { startDate: "2024-02-29", endDate: "2024-03-01" },
    ]);
  });
});

describe("weekly steps summary", () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-11-${23 + index}`);
  it("sums a completed week including zero/rest days and averages all seven totals", () => {
    const totals = Object.fromEntries(dates.map((date, index) => [date, index * 1000]));
    expect(summarizeWeeklySteps(dates, totals, "2026-11-30")).toEqual({
      totalSteps: 21000, averageSteps: 3000, daysWithData: 7, totalDays: 7, partial: false,
    });
  });
  it("excludes missing, future and outside-week dates from both total and denominator", () => {
    expect(summarizeWeeklySteps(dates, {
      "2026-11-22": 90000, "2026-11-23": 0, "2026-11-25": 10001, "2026-11-26": 50000,
    }, "2026-11-25")).toEqual({ totalSteps: 10001, averageSteps: 5000.5, daysWithData: 2, totalDays: 7, partial: true });
  });
  it("labels today as partial even with all dates present", () => {
    expect(summarizeWeeklySteps(dates, Object.fromEntries(dates.map(date => [date, 1000])), "2026-11-29")?.partial).toBe(true);
  });
  it("omits entirely missing/future weeks but preserves an all-zero week", () => {
    expect(summarizeWeeklySteps(dates, {}, "2026-11-30")).toBeNull();
    expect(summarizeWeeklySteps(dates, { "2026-11-23": 1000 }, "2026-11-22")).toBeNull();
    expect(summarizeWeeklySteps(dates, Object.fromEntries(dates.map(date => [date, 0])), "2026-11-30"))
      .toMatchObject({ totalSteps: 0, averageSteps: 0, daysWithData: 7, partial: false });
  });
  it("normalizes duplicate/ISO dates and rejects invalid totals without inflating coverage", () => {
    expect(summarizeWeeklySteps(["2026-11-23", "2026-11-23T00:00:00Z", "2026-11-24", "invalid"], {
      "2026-11-23": 1000, "2026-11-24": -1,
    }, "2026-11-30")).toMatchObject({ totalSteps: 1000, averageSteps: 1000, totalDays: 2, daysWithData: 1, partial: true });
  });
});
