// ============================================================
// EnduroLab — Goal Scorecard Tests
// ============================================================

import { describe, expect, it } from "vitest";
import { generatePlan } from "@/lib/training/plan-generator";
import { RunnerProfile, formatPace } from "@/lib/training/models";
import {
  buildGoalScorecard,
  deriveScorecardStandards,
  scorecardStandardsForPlan,
  SUB3_SCORECARD_STANDARDS,
} from "@/lib/training/goal-scorecard";

function makeProfile(overrides: Partial<RunnerProfile> = {}): RunnerProfile {
  return {
    currentWeeklyMileage: 55,
    peakHistoricalWeeklyMileage: 70,
    currentMarathonPR: 180,
    currentHalfMarathonPR: 84,
    goalMarathonTime: 180,
    raceDate: "2026-12-01",
    trainingDaysPerWeek: 6,
    preferredRestDay: "Monday",
    recentInjuryHistory: "None",
    averageEasyPace: null,
    averageMarathonPace: null,
    averageThresholdPace: null,
    hasAppleWatchPower: false,
    longestRecentLongRun: 16,
    comfortLevelWithWorkouts: "advanced",
    availableLongRunDays: ["Sunday"],
    strengthTrainingAvailability: "light",
    weeksOverride: 18,
    peakMileageOverride: 70,
    ...overrides,
  };
}

describe("buildGoalScorecard", () => {
  it("returns 15 scored rows with plan and actual summaries", () => {
    const plan = generatePlan(makeProfile());
    const scorecard = buildGoalScorecard(plan, []);

    expect(scorecard.rows).toHaveLength(15);
    expect(scorecard.plan.maxScore).toBe(15);
    expect(scorecard.actual.maxScore).toBe(15);
    expect(scorecard.rows.some((row) => row.category === "Weekly mileage")).toBe(true);
  });

  it("keeps the curated sub-3 preset for a sub-3 goal", () => {
    const plan = generatePlan(makeProfile({ goalMarathonTime: 180 }));
    const standards = scorecardStandardsForPlan(plan);

    expect(standards).toBe(SUB3_SCORECARD_STANDARDS);
    expect(standards.label).toBe("Sub-3");
    expect(standards.peakWeekMileage).toBe(65);
    expect(standards.tempoPaceMin).toBeCloseTo(6 + 20 / 60, 6);
  });

  it("counts an entered sub-85 half marathon as actual fitness evidence", () => {
    const plan = generatePlan(makeProfile({ currentHalfMarathonPR: 84 }));
    const scorecard = buildGoalScorecard(plan, []);
    const halfRow = scorecard.rows.find((row) => row.category === "Half marathon fitness");

    expect(halfRow?.actual.status).toBe("earned");
  });

  it("derives sub-3:30 standards from the plan's goal and pace zones", () => {
    const plan = generatePlan(makeProfile({ goalMarathonTime: 210 }));
    const standards = scorecardStandardsForPlan(plan);

    expect(standards.label).toBe("Sub-3:30");
    expect(standards.marathonPace).toBe(plan.paceZones.marathon);
    expect(standards.tempoPaceMin).toBeCloseTo(plan.paceZones.threshold - 5 / 60, 6);
    expect(standards.tempoPaceMax).toBeCloseTo(plan.paceZones.threshold + 5 / 60, 6);
    expect(standards.peakWeekMileage).toBe(54);
    expect(standards.averageWeekMileage).toBe(42);
    expect(standards.halfMarathonMinutes).toBeCloseTo(210 * 0.5 ** 1.06, 6);
    expect(standards.tenKMinutes).toBeCloseTo(210 * (6.21371 / 26.2) ** 1.06, 6);
  });

  it("scores a slower goal against its own paces instead of the sub-3 ones", () => {
    const plan = generatePlan(makeProfile({ goalMarathonTime: 240 }));
    const scorecard = buildGoalScorecard(plan, []);
    const mpRow = scorecard.rows.find((row) => row.objective === "Goal pace ability");
    const tempoRow = scorecard.rows.find((row) => row.objective === "Tempo pace");

    expect(mpRow?.standard).toContain(`${formatPace(plan.paceZones.marathon)}/mile`);
    expect(mpRow?.standard).not.toContain("6:52");
    expect(mpRow?.plan.status).toBe("earned");
    expect(tempoRow?.standard).toContain(`${formatPace(plan.paceZones.threshold - 5 / 60)}`);
    expect(tempoRow?.standard).toContain(`${formatPace(plan.paceZones.threshold + 5 / 60)}`);
    expect(tempoRow?.standard).not.toContain("6:20");
  });

  it("accepts an explicit preset override for any plan", () => {
    const plan = generatePlan(makeProfile({ goalMarathonTime: 210 }));
    const scorecard = buildGoalScorecard(plan, [], SUB3_SCORECARD_STANDARDS);

    expect(scorecard.standards).toBe(SUB3_SCORECARD_STANDARDS);
    expect(
      scorecard.rows.find((row) => row.objective === "Goal pace ability")?.standard
    ).toContain("6:52");
  });

  it("scales race-result equivalents with the goal time", () => {
    const plan = generatePlan(makeProfile({ goalMarathonTime: 240 }));
    const derived = deriveScorecardStandards(240, plan.paceZones);
    const slower = deriveScorecardStandards(300, plan.paceZones);

    expect(derived.halfMarathonMinutes).toBeLessThan(slower.halfMarathonMinutes);
    expect(derived.peakWeekMileage).toBeGreaterThan(slower.peakWeekMileage);
  });
});