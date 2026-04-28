// ============================================================
// EnduroLab — Goal Assessment Engine
// ============================================================
// Evaluates the feasibility of a runner's goal marathon time
// based on current fitness, mileage history, and time
// available to train.
// ============================================================

import { RunnerProfile, GoalAssessment } from "./models";
import dayjs from "dayjs";

// ─── Time-to-Race Calculation ───────────────────────────────

function weeksUntilRace(raceDate: string): number {
  return dayjs(raceDate).diff(dayjs(), "week", true);
}

// ─── Mileage Gap Analysis ───────────────────────────────────

function analyzeMileageGap(
  currentMileage: number,
  peakMileage: number,
  recommendedPeak: number
): { rating: string; factor: string } {
  const gap = recommendedPeak - peakMileage;

  if (gap <= 0) {
    return { rating: "positive", factor: "Peak mileage already exceeds recommended level" };
  } else if (gap <= 10) {
    return { rating: "manageable", factor: `Peak mileage is ${gap} mi/week below recommended — achievable with gradual build` };
  } else if (gap <= 20) {
    return { rating: "concerning", factor: `Peak mileage is ${gap} mi/week below recommended — requires significant build` };
  } else {
    return { rating: "risky", factor: `Peak mileage is ${gap} mi/week below recommended — high injury risk building to this level` };
  }
}

// ─── PR-to-Goal Gap ─────────────────────────────────────────

function analyzePRGap(
  currentPR: number | null,
  goalTime: number
): { percentage: number; factor: string; feasible: boolean } {
  if (!currentPR) {
    return {
      percentage: 0,
      factor: "No marathon PR on record — goal is untested",
      feasible: true,
    };
  }

  const improvement = ((currentPR - goalTime) / currentPR) * 100;

  if (improvement <= 0) {
    return {
      percentage: 0,
      factor: `Goal time (${goalTime} min) is faster than current PR (${currentPR} min) by ${Math.abs(improvement).toFixed(1)}%`,
      feasible: true,
    };
  } else if (improvement <= 3) {
    return {
      percentage: improvement,
      factor: `Goal is ${improvement.toFixed(1)}% improvement over PR — realistic with focused training`,
      feasible: true,
    };
  } else if (improvement <= 7) {
    return {
      percentage: improvement,
      factor: `Goal is ${improvement.toFixed(1)}% improvement over PR — ambitious but possible`,
      feasible: true,
    };
  } else {
    return {
      percentage: improvement,
      factor: `Goal is ${improvement.toFixed(1)}% improvement over PR — very ambitious`,
      feasible: false,
    };
  }
}

// ─── Recommended Peak Mileage ───────────────────────────────
// Faster goal times generally require higher peak mileage.
// Based on Daniels' guidelines and typical training plans.

function recommendedPeakMileage(goalMinutes: number): number {
  if (goalMinutes <= 180) return 90;    // Sub-3:00
  if (goalMinutes <= 210) return 75;    // Sub-3:30
  if (goalMinutes <= 240) return 60;    // Sub-4:00
  if (goalMinutes <= 270) return 50;    // Sub-4:30
  return 40;                            // 4:30+
}

// ─── Risk Factor Detection ──────────────────────────────────

function detectRiskFactors(profile: RunnerProfile, weeks: number, peakMileage: number): string[] {
  const warnings: string[] = [];

  // Insufficient time
  if (weeks < 16) {
    warnings.push("Less than 16 weeks until race — plan will be compressed, higher injury risk");
  }

  // Large mileage jump
  if (peakMileage > profile.currentWeeklyMileage * 1.5) {
    warnings.push(
      `Peak mileage (${peakMileage} mi) is significantly higher than current (${profile.currentWeeklyMileage} mi) — build gradually`
    );
  }

  // Injury history
  if (profile.recentInjuryHistory && profile.recentInjuryHistory.toLowerCase() !== "none") {
    warnings.push(
      `Recent injury history noted — consider consulting a physio and progressing more cautiously`
    );
  }

  // Low training frequency
  if (profile.trainingDaysPerWeek < 4) {
    warnings.push(
      "Training fewer than 4 days per week limits adaptation — consider adding a cross-training day"
    );
  }

  // Long run gap
  if (profile.longestRecentLongRun < 8) {
    warnings.push(
      "Longest recent run is under 8 miles — base building will take longer before marathon-specific work"
    );
  }

  return warnings;
}

// ─── Main Assessment ────────────────────────────────────────

export function assessGoal(profile: RunnerProfile): GoalAssessment {
  const weeks = weeksUntilRace(profile.raceDate);
  const peakMileage = recommendedPeakMileage(profile.goalMarathonTime);

  const mileageAnalysis = analyzeMileageGap(
    profile.currentWeeklyMileage,
    profile.peakHistoricalWeeklyMileage,
    peakMileage
  );
  const prAnalysis = analyzePRGap(profile.currentMarathonPR, profile.goalMarathonTime);

  // Determine overall feasibility
  let feasibility: GoalAssessment["feasibility"];
  const riskFactors = detectRiskFactors(profile, weeks, peakMileage);

  if (!prAnalysis.feasible || (mileageAnalysis.rating === "risky" && weeks < 20)) {
    feasibility = "unlikely";
  } else if (prAnalysis.percentage > 5 || mileageAnalysis.rating === "concerning") {
    feasibility = "very_ambitious";
  } else if (prAnalysis.percentage > 3 || mileageAnalysis.rating === "manageable") {
    feasibility = "ambitious";
  } else {
    feasibility = "realistic";
  }

  // Build reasoning
  const keyFactors = [mileageAnalysis.factor, prAnalysis.factor];
  if (profile.comfortLevelWithWorkouts === "beginner") {
    keyFactors.push("Beginner workout comfort — intensity sessions will need gradual introduction");
  } else if (profile.comfortLevelWithWorkouts === "advanced") {
    keyFactors.push("Advanced workout comfort — can handle higher-intensity sessions earlier");
  }

  const timeline = `${Math.round(weeks)} weeks until race — ${weeks >= 24 ? "ample" : weeks >= 16 ? "adequate" : "limited"} time for preparation`;

  return {
    feasibility,
    reasoning: riskFactors.length > 0
      ? `Assessment based on current fitness, mileage history, and ${Math.round(weeks)}-week timeline. ${riskFactors.length} risk factor(s) identified.`
      : `Assessment based on current fitness, mileage history, and ${Math.round(weeks)}-week timeline.`,
    recommendedPeakMileage: peakMileage,
    keyFactors,
    timeline,
  };
}
