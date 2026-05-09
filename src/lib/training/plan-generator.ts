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

// Day-of-week index mapping (0=Sunday for JS date math)
const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const DISPLAY_DAY_ORDER: Record<string, number> = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
};

// ─── Week Count Calculation ─────────────────────────────────

function calculateWeeks(raceDate: string, weeksOverride?: number | null): number {
  if (weeksOverride) {
    return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, weeksOverride));
  }
  const weeks = dayjs(raceDate).diff(dayjs(), "week", true);
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.floor(weeks)));
}

// ─── Phase Division ─────────────────────────────────────────

function dividePhases(totalWeeks: number): PhaseInfo[] {
  // Daniels-style marathon block: 6-8 weeks of aerobic/LT base,
  // marathon-specific build, then a 3-4 week peak/taper.
  const taperWeeks = Math.max(3, Math.min(4, Math.round(totalWeeks * 0.2)));
  const baseWeeks = Math.max(5, Math.min(8, Math.round((totalWeeks - taperWeeks) * 0.45)));
  const buildWeeks = totalWeeks - baseWeeks - taperWeeks;

  return [
    {
      phaseNumber: 1,
      name: "Phase 1: Aerobic + Threshold Base",
      description: "Build from roughly 50 to 65 miles per week while raising lactate threshold, the main bottleneck for marathon durability.",
      focus: "Raise LT and reinforce aerobic durability",
      targetMileage: "~50 -> 65 mpw",
      longRunRange: "14-18 miles, mostly easy",
      weekRange: [1, baseWeeks],
      startDate: "",
      endDate: "",
    },
    {
      phaseNumber: 2,
      name: "Phase 2: Marathon-Specific Build",
      description: "Move from 65 miles per week toward peak volume, introduce marathon-pace long runs, and extend fatigue resistance.",
      focus: "Marathon pace and fatigue resistance",
      targetMileage: "65 -> 80-90 mpw peak",
      longRunRange: "Long runs with marathon-pace work",
      weekRange: [baseWeeks + 1, baseWeeks + buildWeeks],
      startDate: "",
      endDate: "",
    },
    {
      phaseNumber: 3,
      name: "Phase 3: Peak + Taper",
      description: "Reach the most specific long runs, then reduce volume while keeping enough intensity to stay sharp.",
      focus: "Highest specificity, then freshen up",
      targetMileage: "Peak, then reduce volume",
      longRunRange: "20-22 mile peak long runs",
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

  // Start with all days, remove rest days
  const trainingDays = allDays.filter((day) => day !== preferredRestDay);

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
    if (buildWeek % 3 === 0 && buildWeek > 0 && buildWeek < buildWeeks) {
      return Math.round(target * 0.8);
    }
    return Math.round(target);
  } else {
    // Peak, then final three weeks before race at roughly 70%, 60%, 60%.
    const weeksBeforeRace = totalWeeks - week;
    if (weeksBeforeRace === 2) return Math.round(peakMileage * 0.7);
    if (weeksBeforeRace === 1 || weeksBeforeRace === 0) return Math.round(peakMileage * 0.6);
    return peakMileage;
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

function nearestVO2RepDistance(vo2Pace: number, targetRepMinutes: number): number {
  const options = [0.25, 0.33, 0.5, 0.75, 1];
  return options.reduce((best, option) => {
    const bestDiff = Math.abs(best * vo2Pace - targetRepMinutes);
    const optionDiff = Math.abs(option * vo2Pace - targetRepMinutes);
    return optionDiff < bestDiff ? option : best;
  }, options[0]);
}

function roundMiles(distance: number): number {
  return Math.round(distance * 4) / 4;
}

function distributeVariedMileage(totalMileage: number, dayCount: number, week: number): number[] {
  if (dayCount <= 0) return [];
  if (dayCount === 1) return [roundMiles(totalMileage)];

  const minimum = totalMileage >= dayCount ? 1 : 0;
  const baseMileage = minimum * dayCount;
  const variableMileage = Math.max(0, totalMileage - baseMileage);
  const pattern = [1.25, 0.8, 1.1, 0.9, 1.35, 0.75, 1.05];
  const weights = Array.from({ length: dayCount }, (_, index) => pattern[(week + index) % pattern.length]);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const distances: number[] = [];
  let assigned = 0;

  for (let i = 0; i < dayCount; i++) {
    if (i === dayCount - 1) {
      distances.push(roundMiles(Math.max(0, totalMileage - assigned)));
      break;
    }

    const distance = roundMiles(minimum + (variableMileage * weights[i]) / weightTotal);
    distances.push(distance);
    assigned += distance;
  }

  return distances;
}

// ─── Workout Assignment ────────────────────────────────────

function assignWorkoutsForWeek(
  week: number,
  totalWeeks: number,
  phase: TrainingPhase,
  weeklyMileage: number,
  _longRunMiles: number,
  trainingDays: string[],
  longRunDay: string,
  paceZones: PaceZones,
  powerZones: PowerZones | undefined,
  comfortLevel: "beginner" | "intermediate" | "advanced",
  _strengthAvailability: "none" | "light" | "regular",
  isDownWeek: boolean,
  runsPerWeek: number,
  preferredDoubleUpDays: string[]
): DailyPlan[] {
  const days: DailyPlan[] = [];
  const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const targetRunCount = Math.max(1, Math.min(10, runsPerWeek));
  const primaryRunCount = Math.min(trainingDays.length, targetRunCount);
  const runDays = [
    longRunDay,
    ...trainingDays.filter((day) => day !== longRunDay),
  ].slice(0, primaryRunCount);

  // Determine workout complexity based on comfort level
  const canDoIntervals = comfortLevel !== "beginner" || week > 4;
  const canDoThreshold = comfortLevel !== "beginner" || week > 2;

  // How many double-days? (runs exceeding training days)
  const doubleDayCount = Math.max(0, targetRunCount - primaryRunCount);

  // Distribute workouts across training days
  let workoutIndex = 0;
  let assignedMileage = 0;

  // 1. Assign the long run
  const adjustedLongRunMiles = roundMiles(weeklyMileage * 0.25);
  const longRun = WorkoutLibrary.createLongRun(week, workoutIndex++, adjustedLongRunMiles, paceZones, powerZones);
  days.push({
    date: "", // Will be filled in later
    dayOfWeek: longRunDay,
    workout: longRun,
    isRestDay: false,
    plannedMileage: adjustedLongRunMiles,
  });
  assignedMileage += adjustedLongRunMiles;

  // 2. Assign key workout (threshold or intervals)
  let keyWorkout: Workout | null = null;
  let keyWorkoutDay: string | null = null;
  let remainingMileage = Math.max(0, weeklyMileage - assignedMileage);
  const weeksBeforeRace = totalWeeks - week;
  const allowsPaceSpecificWorkout = week > 3 && weeksBeforeRace > 2;

  if (!isDownWeek && allowsPaceSpecificWorkout && runDays.length > 1) {
    if (phase === "base" && canDoThreshold) {
      const thresholdMiles = Math.min(4, Math.max(1, remainingMileage * 0.2));
      const totalDist = Math.min(remainingMileage, thresholdMiles + 3); // warmup/cooldown
      if (week % 4 === 0 && totalDist >= 5) {
        keyWorkout = WorkoutLibrary.createProgressionRun(week, workoutIndex++, totalDist, paceZones, powerZones);
      } else if (week % 2 === 0) {
        const reps = comfortLevel === "advanced" ? 4 : 3;
        keyWorkout = WorkoutLibrary.createThresholdIntervals(
          week,
          workoutIndex++,
          totalDist,
          reps,
          1,
          60,
          paceZones,
          powerZones
        );
      } else {
        keyWorkout = WorkoutLibrary.createThresholdRun(week, workoutIndex++, totalDist, thresholdMiles, paceZones, powerZones);
      }
    } else if (phase !== "base" && canDoIntervals && !isDownWeek) {
      const shouldRunVO2 =
        phase === "peak_taper" ? week % 2 === 0 : week % 3 === 2;

      if (shouldRunVO2) {
        const targetRepMinutes = phase === "peak_taper" ? 3 : comfortLevel === "advanced" ? 4.5 : 4;
        const reps = phase === "peak_taper" ? 3 : comfortLevel === "advanced" ? 5 : 4;
        const repDist = nearestVO2RepDistance(paceZones.vo2, targetRepMinutes);
        const restSeconds = Math.round(targetRepMinutes * 60);
        keyWorkout = WorkoutLibrary.createVO2Intervals(week, workoutIndex++, reps, repDist, restSeconds, paceZones, powerZones);
      } else if (phase === "marathon_build" && week % 3 === 1) {
        const mpMiles = Math.min(8, Math.max(3, remainingMileage * 0.18));
        const totalDist = Math.min(remainingMileage, mpMiles + 3);
        keyWorkout = WorkoutLibrary.createMarathonPaceRun(week, workoutIndex++, mpMiles, totalDist, paceZones, powerZones);
      } else {
        const reps = comfortLevel === "advanced" ? 4 : 3;
        const totalDist = Math.min(remainingMileage, reps + 3);
        keyWorkout = WorkoutLibrary.createThresholdIntervals(
          week,
          workoutIndex++,
          totalDist,
          reps,
          1,
          75,
          paceZones,
          powerZones
        );
      }
    } else if (phase !== "base") {
      // Marathon pace work
      const mpMiles = Math.min(5, Math.max(2, remainingMileage * 0.15));
      const totalDist = Math.min(remainingMileage, mpMiles + 3);
      keyWorkout = WorkoutLibrary.createMarathonPaceRun(week, workoutIndex++, mpMiles, totalDist, paceZones, powerZones);
    }
  }

  // Assign key workout to a mid-week day (not the long run day)
  if (keyWorkout) {
    for (const day of runDays) {
      if (day !== longRunDay) {
        keyWorkoutDay = day;
        days.push({
          date: "",
          dayOfWeek: day,
          workout: keyWorkout,
          isRestDay: false,
          plannedMileage: keyWorkout.totalDistance,
        });
        assignedMileage += keyWorkout.totalDistance;
        break;
      }
    }
  }

  // 3. Fill remaining training days with easy runs and recovery
  const easyRunDays = runDays.filter((day) => day !== longRunDay && day !== keyWorkoutDay);
  remainingMileage = Math.max(0, weeklyMileage - assignedMileage);
  const doubleDayReserve = doubleDayCount > 0 ? Math.min(4 * doubleDayCount, Math.max(0, remainingMileage - easyRunDays.length * 3)) : 0;
  const primaryEasyMileage = Math.max(0, remainingMileage - doubleDayReserve);
  const easyMileageTargets = distributeVariedMileage(primaryEasyMileage, easyRunDays.length, week);
  let easyDaysUsed = 0;

  for (const day of easyRunDays) {
    // Recovery day after hard workout
    const dayIdx = DAY_INDEX[day];
    const isAfterKeyWorkout = keyWorkoutDay && dayIdx === DAY_INDEX[keyWorkoutDay] + 1;
    const targetMileage = easyMileageTargets[easyDaysUsed] ?? 0;
    const runMileage = Math.max(targetMileage > 0 ? 1 : 0, targetMileage);

    if (isAfterKeyWorkout) {
      const recovery = WorkoutLibrary.createRecoveryRun(week, workoutIndex++, runMileage, paceZones, powerZones);
      days.push({
        date: "",
        dayOfWeek: day,
        workout: recovery,
        isRestDay: false,
        plannedMileage: runMileage,
      });
    } else {
      const easy = WorkoutLibrary.createEasyRun(week, workoutIndex++, runMileage, paceZones, powerZones);
      days.push({
        date: "",
        dayOfWeek: day,
        workout: easy,
        isRestDay: false,
        plannedMileage: runMileage,
      });
    }
    assignedMileage += runMileage;
    easyDaysUsed++;
  }

  // 4. Add double-day secondary runs (shorter easy runs on existing training days)
  if (doubleDayCount > 0) {
    let secondaryMileageRemaining = Math.max(0, weeklyMileage - assignedMileage);
    const candidateDays = days.filter((d) => !d.isRestDay && d.workout);
    const preferredOrder = new Map(preferredDoubleUpDays.map((day, index) => [day, index]));
    const orderedCandidateDays = [
      ...candidateDays
        .filter((day) => preferredOrder.has(day.dayOfWeek))
        .sort((a, b) => (preferredOrder.get(a.dayOfWeek) ?? 0) - (preferredOrder.get(b.dayOfWeek) ?? 0)),
      ...candidateDays.filter((day) => !preferredOrder.has(day.dayOfWeek)),
    ];
    const doubleDayTargets = distributeVariedMileage(
      secondaryMileageRemaining,
      Math.min(doubleDayCount, orderedCandidateDays.length),
      week + 2
    );

    for (let i = 0; i < Math.min(doubleDayCount, orderedCandidateDays.length); i++) {
      const doubleDayMiles = Math.max(
        1,
        doubleDayTargets[i] ?? roundMiles(secondaryMileageRemaining)
      );
      const secondary = WorkoutLibrary.createEasyRun(
        week,
        workoutIndex++,
        doubleDayMiles,
        paceZones,
        powerZones
      );
      orderedCandidateDays[i].secondaryWorkout = secondary;
      orderedCandidateDays[i].plannedMileage += doubleDayMiles;
      secondaryMileageRemaining -= doubleDayMiles;
      assignedMileage += doubleDayMiles;
    }
  }

  const mileageDelta = roundMiles(weeklyMileage - assignedMileage);
  if (Math.abs(mileageDelta) >= 0.1) {
    const adjustableDay =
      days.find((d) => d.dayOfWeek !== longRunDay && d.workout?.type === "easy") ??
      days.find((d) => d.workout?.type === "easy") ??
      days.find((d) => d.workout);

    if (adjustableDay?.workout) {
      const adjustedDistance = Math.max(
        1,
        roundMiles(adjustableDay.workout.totalDistance + mileageDelta)
      );
      const contributionDelta = adjustedDistance - adjustableDay.workout.totalDistance;
      adjustableDay.workout.totalDistance = adjustedDistance;
      adjustableDay.workout.weeklyMileageContribution = adjustedDistance;
      adjustableDay.plannedMileage = roundMiles(adjustableDay.plannedMileage + contributionDelta);
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

  return days.sort((a, b) => DISPLAY_DAY_ORDER[a.dayOfWeek] - DISPLAY_DAY_ORDER[b.dayOfWeek]);
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

function addWorkoutIntensity(
  intensityDist: WeeklyPlan["intensityDistribution"],
  workout: Workout | null | undefined
): void {
  if (!workout) return;

  workout.segments.forEach((segment) => {
    const distance = (segment.distance ?? 0) * (segment.repetitions ?? 1);
    switch (segment.type) {
      case "easy":
      case "long":
      case "recovery":
        intensityDist.easy += distance;
        break;
      case "threshold":
        intensityDist.threshold += distance;
        break;
      case "marathon_pace":
        intensityDist.marathon += distance;
        break;
      case "vo2":
        intensityDist.vo2 += distance;
        break;
    }
  });
}

// ─── Main Plan Generation ──────────────────────────────────

export function generatePlan(profile: RunnerProfile): MarathonPlan {
  const totalWeeks = calculateWeeks(profile.raceDate, profile.weeksOverride);
  const phases = dividePhases(totalWeeks);
  const assessment = assessGoal(profile);
  const paceZones = calculatePaceZones(profile);
  const powerZones = calculatePowerZones(profile, paceZones);

  // Use user override if set, otherwise fall back to assessment recommendation
  const peakMileage = profile.peakMileageOverride
    ? Math.max(10, Math.min(120, profile.peakMileageOverride))
    : assessment.recommendedPeakMileage;
  const trainingDays = selectTrainingDays(
    profile.trainingDaysPerWeek,
    profile.preferredRestDay,
    profile.availableLongRunDays
  );
  const longRunDay = profile.availableLongRunDays[0] ?? "Sunday";

  // Runs per week: user override clamped 3–10, defaults to training days count
  const runsPerWeek = profile.runsPerWeekOverride
    ? Math.max(3, Math.min(10, profile.runsPerWeekOverride))
    : profile.trainingDaysPerWeek;
  const planStart = dayjs(profile.raceDate).subtract(totalWeeks, "week").startOf("isoWeek");

  // Generate weeks
  const weeks: WeeklyPlan[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const phase = getPhaseForWeek(week, phases);
    const weeklyMileage = mileageProgression(week, totalWeeks, profile.currentWeeklyMileage, peakMileage, phase);
    const longRunMiles = roundMiles(weeklyMileage * 0.25);
    const isDownWeek = phase === "marathon_build" && (week - phases[0].weekRange[1]) % 3 === 0;

    const days = assignWorkoutsForWeek(
      week,
      totalWeeks,
      phase,
      weeklyMileage,
      longRunMiles,
      trainingDays,
      longRunDay,
      paceZones,
      powerZones,
      profile.comfortLevelWithWorkouts,
      profile.strengthTrainingAvailability,
      isDownWeek,
      runsPerWeek,
      profile.preferredDoubleUpDays ?? []
    );

    // Calculate dates
    const startDate = planStart.add(week - 1, "week").toISOString();
    const endDate = planStart.add(week, "week").subtract(1, "day").toISOString();

    // Fill in dates for each day
    const weekStart = planStart.add(week - 1, "week");

    days.forEach((day) => {
      const offset = DISPLAY_DAY_ORDER[day.dayOfWeek];
      day.date = weekStart.add(offset, "day").toISOString();
    });

    // Calculate intensity distribution
    const intensityDist = { easy: 0, threshold: 0, marathon: 0, vo2: 0 };
    days.forEach((d) => {
      addWorkoutIntensity(intensityDist, d.workout);
      addWorkoutIntensity(intensityDist, d.secondaryWorkout);
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
