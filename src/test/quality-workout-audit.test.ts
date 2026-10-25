/** Auditing must expose saved work, preserve recovery semantics, and cite deviations. */
import { describe, expect, it } from "vitest";
import { auditQualityWorkouts, formatQualityAudit } from "../../scripts/quality-workout-audit.mjs";

const easy = { type: "easy", distance: 2, pace: 8 };
const threshold = { type: "threshold", distance: 1, pace: 6.5, repetitions: 3, restBetween: 78 };
const run = (id: string, segments = [easy], type = "easy", totalDistance = 2) => ({ id, title: id, description: "", type, segments, totalDistance });
const day = (date: string, workout: ReturnType<typeof run>, secondaryWorkout?: ReturnType<typeof run>) => ({ date, workout, secondaryWorkout });

describe("quality workout audit", () => {
  it("filters by actual segments, includes secondary quality and prose strides, and omits races and ordinary long runs", () => {
    const plan = { weeks: [{ weekNumber: 1, totalMileage: 50, days: [
      day("2027-01-01", run("easy"), run("hidden quality", [easy, threshold, easy])),
      day("2027-01-02", run("easy long", [easy], "long")),
      day("2027-01-03", run("mixed long", [easy, { ...easy, type: "marathon_pace" }], "long", 12)),
      day("2027-01-04", run("race", [threshold], "race")),
      day("2027-01-05", { ...run("easy + strides"), description: "Finish with 6 × 20s strides" }),
    ] }] };
    const before = JSON.stringify(plan);
    const report = auditQualityWorkouts(plan);
    expect(report.sessions.map((row: { id: string }) => row.id)).toEqual(["hidden quality", "mixed long", "easy + strides"]);
    expect(report.sessions[0].slot).toBe("secondary");
    expect(report.sessions[2].qualityMinutes).toBe(0);
    expect(report.sessions[2].findings.map((finding: { code: string }) => finding.code)).not.toContain("quality-spacing");
    expect(report.sessions[1].findings.map((finding: { code: string }) => finding.code)).not.toContain("daily-load");
    expect(report.sessions[2].findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "prose-strides" })]));
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("multiplies repeated work, counts explicit recovery once, and preserves rest metadata", () => {
    const segments = [easy, threshold, { type: "recovery", distance: 0.25, pace: 9 }, easy];
    const report = auditQualityWorkouts({ weeks: [{ weekNumber: 7, totalMileage: 60, days: [day("2027-01-01", run("cruise", segments))] }] });
    expect(report.sessions[0].qualityMiles).toBe(3);
    expect(report.sessions[0].qualityMinutes).toBe(19.5);
    expect(report.sessions[0].segments).toEqual(segments);
    const text = formatQualityAudit({ raceName: "Test", planId: "test-id", details: report });
    expect(text).toContain("3 × 1 mi threshold @ 6:30/mi; 78s between reps");
    expect(text).toContain("0.25 mi recovery");
  });

  it("retains missing-quality taper weeks even with no selected sessions", () => {
    const weeks = Array.from({ length: 24 }, (_, index) => ({
      weekNumber: index + 1, totalMileage: 50, isRaceWeek: index === 23,
      days: [day(`2027-01-${String(index + 1).padStart(2, "0")}`, run("easy"))],
    }));
    const report = auditQualityWorkouts({ weeks }, { week: "23" });
    expect(report.sessionCount).toBe(0);
    expect(report.weeks).toHaveLength(1);
    expect(report.weeks[0].findings).toContainEqual(expect.objectContaining({ code: "taper-no-quality", source: expect.stringContaining("elite-training-plan.md") }));
    weeks[22].days[0].workout.description = "Finish with 4 strides";
    const stridesOnly = auditQualityWorkouts({ weeks }, { week: "23" });
    expect(stridesOnly.sessionCount).toBe(1);
    expect(stridesOnly.weeks[0].findings).toContainEqual(expect.objectContaining({ code: "taper-no-quality" }));
    expect(auditQualityWorkouts({ runnerProfile: { raceDistance: "5k" }, weeks }, { week: "23" }).weeks[0].findings).toEqual([]);
  });

  it("checks weekly budgets across both runs and applies the race-week T exception", () => {
    const makePlan = (isRaceWeek = false) => ({ weeks: [{ weekNumber: 24, totalMileage: 20, isRaceWeek,
      days: [day("2027-04-12", run("T", [easy, threshold, easy]), run("double", [easy], "easy", 8))] }] });
    const normal = auditQualityWorkouts(makePlan());
    expect(normal.weeks[0].findings.map((finding: { code: string }) => finding.code)).toContain("threshold-budget");
    expect(normal.sessions[0].findings.map((finding: { code: string }) => finding.code)).toContain("double-distance");
    expect(auditQualityWorkouts(makePlan(true)).weeks[0].findings.map((finding: { code: string }) => finding.code)).not.toContain("threshold-budget");
  });

  it("compares recovery Q1/Q2 and spacing with the whole plan before date filtering", () => {
    const plan = { weeks: [{ weekNumber: 9, totalMileage: 56, isDownWeek: true, days: [
      day("2027-01-02", run("M long", [easy, { ...easy, type: "marathon_pace" }], "long")),
      day("2027-01-03", run("T", [easy, threshold, easy])),
    ] }] };
    const report = auditQualityWorkouts(plan, { date: "2027-01-03" });
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0].daysSincePreviousQuality).toBe(1);
    expect(report.sessions[0].findings).toContainEqual(expect.objectContaining({ code: "quality-spacing" }));
    expect(report.weeks[0].findings).toContainEqual(expect.objectContaining({ code: "down-week-long-quality" }));
    expect(report.weeks[0].findings.map((finding: { code: string }) => finding.code)).not.toContain("down-week-no-threshold");
  });
});
