// ============================================================
// EnduroLab — Plan Generator Engine
// ============================================================
// Assembles a complete marathon training plan from a runner
// profile, pace zones, workout library, and goal assessment.
// Produces week-by-week schedules with proper periodization,
// build/recovery cycles, and phase transitions.
// ============================================================

import dayjs from "dayjs";
import isoWeek from "dayjs/plugin/isoWeek";
import {
  RunnerProfile,
  MarathonPlan,
  WeeklyPlan,
  DailyPlan,
  Workout,
  TrainingPhase,
  PhaseInfo,
  PaceZones,
  PowerZones,
  AdjustmentRule,
  GoalAssessment,
} from "./models";
import { calculatePaceZones, calculatePowerZones } from "./zone-calculator";
import { WorkoutLibrary } from "./workout-library";
import { assessGoal } from "./goal-assessment";

dayjs.extend(isoWeek);

// ─── Constants ───────────────────────────────────────────────

const MIN_WEEKS = 14;
const MAX_WEEKS = 28;

// Day-of-week index mapping (0=Sunday)
const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

// ─── Week Count Calculation ─────────────────────────────────

function calculateWeeks(raceDate: string): number {
  const weeks = dayjs(raceDate).diff(dayjs(), "week", true);
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor(weeks)));
}

// ─── Phase Division ─────────────────────────────────────────

function dividePhases(totalWeeks: number): PhaseInfo[] {
  // Base: ~30%, Marathon build: ~50%, Peak/taper: ~20%
  const baseWeeks = Math.max(3, Math.round(totalWeeks * 0.3));
  const taperWeeks = Math.max(2, Math.round(totalWeeks * 0.2));
  const buildWeeks = totalWeeks - baseWeeks - taperWeeks;

  return [
    {
      name: "Base Building",
      description: "Establish aerobic foundation, build mileage gradually, introduce key workout types",
      weekRange: [1, baseWeeks],
      startDate: "",
      endDate: "",
    },
    {
      name: "Marathon Specific",
      description: "Increase long run distance, add marathon-pace work, peak volume",
      weekRange: [baseWeeks + 1, baseWeeks + buildWeeks],
      startDate: "",
      endDate: "",
    },
    {
      name: "Peak & Taper",
      description: "Final quality sessions, then reduce volume while maintaining intensity",
      weekRange: [baseWeeks + buildWeeks + 1, totalWeeks],
      startDate: "",
      endDate: "",
    },
  ];
}

// ─── Training Day Selection ─────────────────────────────────

function selectTrainingDays(
  daysPerWeek: number,
  preferredRestDay: string,
  longRunDays: string[]
): string[] {
  const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const restDayIndex = DAY_INDEX[preferredRestDay] ?? 0;

  // Start with all days, remove rest days
  const trainingDays = allDays.filter((_, i) => i !== restDayIndex);

  // If fewer days requested, remove days adjacent to rest day first
  while (trainingDays.length > daysPerWeek) {
    // Remove the day closest to the rest day
    const restIdx = DAY_INDEX[preferredRestDay] ?? 0;
    let closestIdx = -1;
    let closestDist = 999;

    trainingDays.forEach((day, idx) => {
      const dayIdx = DAY_INDEX[day];
      const dist = Math.abs(dayIdx - restIdx);
      if (dist < closestDist && dist > 0) {
        closestDist = dist;
        closestIdx = idx;
      }
    });

    if (closestIdx >= 0) {
      trainingDays.splice(closestIdx, 1);
    } else {
      trainingDays.pop();
    }
  }

  return trainingDays;
}

// ─── Mileage Progression Curve ──────────────────────────────

function mileageProgression(
  week: number,
  totalWeeks: number,
  startMileage: number,
  peakMileage: number,
  phase: TrainingPhase
): number {
  const baseWeeks = Math.round(totalWeeks * 0.3);
  const buildWeeks = Math.round(totalWeeks * 0.5);

  if (phase === "base") {
    // Gradual build from current to ~70% of peak
    const target = startMileage + (peakMileage * 0.7 - startMileage) * (week / baseWeeks);
    return Math.round(target);
  } else if (phase === "marathon_build") {
    // Build to peak, with recovery weeks
    const buildWeek = week - baseWeeks;
    const target = peakMileage * 0.7 + (peakMileage * 0.3) * (buildWeek / buildWeeks);

    // Every 3rd week is a recovery week (20% reduction)
    if (buildWeek % 3 === 0 && buildWeek > 0) {
      return Math.round(target * 0.8);
    }
    return Math.round(target);
  } else {
    // Peak then taper
    const taperWeeks = Math.round(totalWeeks * 0.2);
    const taperWeek = week - baseWeeks - buildWeeks;

    if (taperWeek === 0) {
      return peakMileage; // Peak week
    }

    // Taper: reduce by ~30%, ~50%, ~70%
    const reduction = taperWeek / (taperWeeks + 1);
    return Math.round(peakMileage * (1 - reduction * 0.7));
  }
}

// ─── Long Run Progression ───────────────────────────────────

function longRunDistance(
  week: number,
  totalWeeks: number,
  phase: TrainingPhase,
  currentLongRun: number
): number {
  const baseWeeks = Math.round(totalWeeks * 0.3);
  const buildWeeks = Math.round(totalWeeks * 0.5);
  const taperWeeks = Math.round(totalWeeks * 0.2);

  if (phase === "base") {
    // Build from current long run to 12-14 miles
    const target = Math.min(14, currentLongRun + (14 - currentLongRun) * (week / baseWeeks));
    return Math.round(target * 2) / 2;
  } else if (phase === "marathon_build") {
    // Build to 18-20 miles peak
    const buildWeek = week - baseWeeks;
    const target = 14 + 6 * (buildWeek / buildWeeks);

    // Recovery weeks: cut back
    if (buildWeek % 3 === 0 && buildWeek > 0) {
      return Math.round((target - 4) * 2) / 2;
    }
    return Math.min(20, Math.round(target * 2) / 2);
  } else {
    // Taper: 16 → 10 → 5 → race
    const taperWeek = week - baseWeeks - buildWeeks;
    if (taperWeeks >= 3 && taperWeek === taperWeeks - 1) {
      return 5; // 2 weeks out
    }
    if (taperWeek === taperWeeks - 2) {
      return 10; // 1 week out
    }
    return 16; // Peak long before taper
  }
}

// ─── Workout Assignment ────────────────────────────────────

function assignWorkoutsForWeek(
  week: number,
  phase: TrainingPhase,
  weeklyMileage: number,
  longRunMiles: number,
  trainingDays: string[],
  longRunDay: string,
  paceZones: PaceZones,
  powerZones: PowerZones | undefined,
  comfortLevel: "beginner" | "intermediate" | "advanced",
  _strengthAvailability: "none" | "light" | "regular",
  isDownWeek: boolean
): DailyPlan[] {
  const days: DailyPlan[] = [];
  const allDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Remaining mileage to distribute after long run
  let remainingMileage = weeklyMileage - longRunMiles;

  // Determine workout complexity based on comfort level
  const canDoIntervals = comfortLevel !== "beginner" || week > 4;
  const canDoThreshold = comfortLevel !== "beginner" || week > 2;

  // Distribute workouts across training days
  let workoutIndex = 0;

  // 1. Assign the long run
  const longRun = WorkoutLibrary.createLongRun(week, workoutIndex++, longRunMiles, paceZones, powerZones);
  days.push({
    date: "", // Will be filled in later
    dayOfWeek: longRunDay,
    workout: longRun,
    isRestDay: false,
    plannedMileage: longRunMiles,
  });

  // 2. Assign key workout (threshold or intervals)
  let keyWorkout: Workout | null = null;
  let keyWorkoutDay: string | null = null;

  if (!isDownWeek && week > 1) {
    // Threshold runs in base, intervals in build/peak
    if (phase === "base" && canDoThreshold) {
      const thresholdMiles = Math.min(4, remainingMileage * 0.2);
      const totalDist = thresholdMiles + 3; // warmup/coolown
      keyWorkout = WorkoutLibrary.createThresholdRun(week, workoutIndex++, totalDist, thresholdMiles, paceZones, powerZones);
      remainingMileage -= totalDist;
    } else if (phase !== "base" && canDoIntervals && !isDownWeek) {
      const reps = phase === "peak_taper" ? 3 : comfortLevel === "advanced" ? 6 : 4;
      const repDist = phase === "peak_taper" ? 0.5 : 0.75;
      keyWorkout = WorkoutLibrary.createVO2Intervals(week, workoutIndex++, reps, repDist, 90, paceZones, powerZones);
      remainingMileage -= keyWorkout.totalDistance;
    } else if (phase !== "base") {
      // Marathon pace work
      const mpMiles = Math.min(5, remainingMileage * 0.15);
      const totalDist = mpMiles + 3;
      keyWorkout = WorkoutLibrary.createMarathonPaceRun(week, workoutIndex++, mpMiles, totalDist, paceZones, powerZones);
      remainingMileage -= totalDist;
    }
  }

  // Assign key workout to a mid-week day (not the long run day)
  if (keyWorkout) {
    for (const day of trainingDays) {
      if (day !== longRunDay) {
        keyWorkoutDay = day;
        days.push({
          date: "",
          dayOfWeek: day,
          workout: keyWorkout,
          isRestDay: false,
          plannedMileage: keyWorkout.totalDistance,
        });
        break;
      }
    }
  }

  // 3. Fill remaining training days with easy runs and recovery
  const easyDayCount = Math.max(1, trainingDays.length - 1 - (keyWorkoutDay ? 1 : 0));
  const easyMilePerDay = Math.max(3, Math.round(remainingMileage / easyDayCount));
  let easyDaysUsed = 0;

  for (const day of trainingDays) {
    if (day === longRunDay || day === keyWorkoutDay) continue;
    if (easyDaysUsed >= easyDayCount) break;

    // Recovery day after hard workout
    const dayIdx = DAY_INDEX[day];
    const isAfterKeyWorkout = keyWorkoutDay && dayIdx === DAY_INDEX[keyWorkoutDay] + 1;

    if (isAfterKeyWorkout) {
      const recovery = WorkoutLibrary.createRecoveryRun(week, workoutIndex++, 3, paceZones, powerZones);
      days.push({
        date: "",
        dayOfWeek: day,
        workout: recovery,
        isRestDay: false,
        plannedMileage: 3,
      });
    } else {
      const easy = WorkoutLibrary.createEasyRun(week, workoutIndex++, easyMilePerDay, paceZones, powerZones);
      days.push({
        date: "",
        dayOfWeek: day,
        workout: easy,
        isRestDay: false,
        plannedMileage: easyMilePerDay,
      });
      easyDaysUsed++;
    }
  }

  // 5. Fill in rest days
  for (const day of allDays) {
    if (!days.find((d) => d.dayOfWeek === day)) {
      days.push({
        date: "",
        dayOfWeek: day,
        workout: null,
        isRestDay: true,
        plannedMileage: 0,
      });
    }
  }

  return days;
}

// ─── Adjustment Rules ────────────────────────────────────

function generateAdjustmentRules(profile: RunnerProfile): AdjustmentRule[] {
  const rules: AdjustmentRule[] = [
    {
      condition: "Feeling fatigued or sore for more than 2 days",
      action: "Convert next hard day to easy run or rest",
      severity: "medium",
    },
    {
      condition: "Illness or fever",
      action: "Take full rest week, then resume at 80% volume",
      severity: "high",
    },
    {
      condition: "Easy runs feeling harder than usual",
      action: "Reduce pace by 30s/mi or convert to cross-training",
      severity: "low",
    },
    {
      condition: "Sleeping less than 7 hours consistently",
      action: "Skip next intensity session, prioritize recovery",
      severity: "medium",
    },
  ];

  if (profile.recentInjuryHistory && profile.recentInjuryHistory.toLowerCase() !== "none") {
    rules.push({
      condition: "Any pain (not just soreness) during runs",
      action: "Stop running, assess with physio, do not push through pain",
      severity: "high",
    });
  }

  return rules;
}

// ─── Risk Warnings ─────────────────────────────────────────

function generateRiskWarnings(
  profile: RunnerProfile,
  assessment: GoalAssessment,
  peakMileage: number
): string[] {
  const warnings = assessment.keyFactors.filter((f) =>
    f.toLowerCase().includes("risk") ||
    f.toLowerCase().includes("concern") ||
    f.toLowerCase().includes("ambitious") ||
    f.toLowerCase().includes("limited")
  );

  if (peakMileage > profile.peakHistoricalWeeklyMileage * 1.3) {
    warnings.push(
      `Peak mileage (${peakMileage} mi) exceeds historical peak (${profile.peakHistoricalWeeklyMileage} mi) by >30% — progress cautiously`
    );
  }

  return warnings;
}

// ─── Phase Determination ───────────────────────────────────

function getPhaseForWeek(week: number, phases: PhaseInfo[]): TrainingPhase {
  if (week <= phases[0].weekRange[1]) return "base";
  if (week <= phases[1].weekRange[1]) return "marathon_build";
  return "peak_taper";
}

// ─── Main Plan Generation ──────────────────────────────────

export function generatePlan(profile: RunnerProfile): MarathonPlan {
  const totalWeeks = calculateWeeks(profile.raceDate);
  const phases = dividePhases(totalWeeks);
  const assessment = assessGoal(profile);
  const paceZones = calculatePaceZones(profile);
  const powerZones = calculatePowerZones(profile, paceZones);

  const peakMileage = assessment.recommendedPeakMileage;
  const trainingDays = selectTrainingDays(
    profile.trainingDaysPerWeek,
    profile.preferredRestDay,
    profile.availableLongRunDays
  );
  const longRunDay = profile.availableLongRunDays[0] ?? "Sunday";

  // Generate weeks
  const weeks: WeeklyPlan[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const phase = getPhaseForWeek(week, phases);
    const weeklyMileage = mileageProgression(week, totalWeeks, profile.currentWeeklyMileage, peakMileage, phase);
    const longRunMiles = longRunDistance(week, totalWeeks, phase, profile.longestRecentLongRun);
    const isDownWeek = phase === "marathon_build" && (week - phases[0].weekRange[1]) % 3 === 0;

    const days = assignWorkoutsForWeek(
      week,
      phase,
      weeklyMileage,
      longRunMiles,
      trainingDays,
      longRunDay,
      paceZones,
      powerZones,
      profile.comfortLevelWithWorkouts,
      profile.strengthTrainingAvailability,
      isDownWeek
    );

    // Calculate dates
    const startDate = dayjs().add(week - 1, "week").toISOString();
    const endDate = dayjs().add(week, "week").subtract(1, "day").toISOString();

    // Fill in dates for each day
    const weekStart = dayjs().add(week - 1, "week");
    const startDayOfWeek = weekStart.isoWeekday();

    days.forEach((day) => {
      const dayIdx = DAY_INDEX[day.dayOfWeek];
      const offset = ((dayIdx - startDayOfWeek + 7) % 7);
      day.date = weekStart.add(offset, "day").toISOString();
    });

    // Calculate intensity distribution
    const intensityDist = { easy: 0, threshold: 0, marathon: 0, vo2: 0 };
    days.forEach((d) => {
      if (d.workout) {
        switch (d.workout.type) {
          case "easy":
          case "long":
          case "recovery":
            intensityDist.easy += d.workout.totalDistance;
            break;
          case "threshold":
            intensityDist.threshold += d.workout.totalDistance;
            break;
          case "marathon_pace":
            intensityDist.marathon += d.workout.totalDistance;
            break;
          case "vo2":
            intensityDist.vo2 += d.workout.totalDistance;
            break;
        }
      }
    });

    weeks.push({
      weekNumber: week,
      startDate,
      endDate,
      phase,
      days,
      totalMileage: weeklyMileage,
      isDownWeek,
      longRunDistance: longRunMiles,
      intensityDistribution: intensityDist,
    });
  }

  // Set phase dates
  const planStart = dayjs();
  phases.forEach((phase) => {
    phase.startDate = planStart.add(phase.weekRange[0] - 1, "week").toISOString();
    phase.endDate = planStart.add(phase.weekRange[1], "week").subtract(1, "day").toISOString();
  });

  const raceDate = profile.raceDate;
  const riskWarnings = generateRiskWarnings(profile, assessment, peakMileage);
  const adjustmentRules = generateAdjustmentRules(profile);

  return {
    id: `plan-${Date.now()}`,
    runnerProfile: profile,
    paceZones,
    powerZones,
    phases,
    weeks,
    totalWeeks,
    peakWeeklyMileage: peakMileage,
    raceDay: raceDate,
    generatedAt: new Date().toISOString(),
    goalAssessment: assessment,
    riskWarnings,
    adjustmentRules,
  };
}
