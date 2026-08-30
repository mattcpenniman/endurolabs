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
import utc from "dayjs/plugin/utc";
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
dayjs.extend(utc);

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

const BASE_BUILD_BLOCK_LEVELS = [
  [0, 0, 0],
  [0.25, 0.25, 0.25],
  [0.5, 0.5, 0.25],
  [0.75, 0.75, 0.25],
];
const PEAK_BUILD_BLOCK_LEVELS = [
  [1, 0.75, 0.5],
  [1, 0.75, 0.25],
  [1, 0.5, 0.25],
];
const TAPER_LEVELS = [0.25, 0, 0];
const DEFAULT_INTENSITY_TARGET_PERCENTS = {
  marathon: 10,
  threshold: 6,
  vo2: 2,
};

// ─── Week Count Calculation ─────────────────────────────────

function calculateWeeks(raceDate: string, weeksOverride?: number | null): number {
  if (weeksOverride) {
    return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, weeksOverride));
  }
  const weeks = dayjs.utc(raceDate).diff(dayjs.utc(), "week", true);
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

// ─── Mileage Progression Curve (stepped: plateau → step → recovery → repeat) ──

function mileageProgression(
  week: number,
  totalWeeks: number,
  startMileage: number,
  peakMileage: number,
  _phase: TrainingPhase
): number {
  if (totalWeeks <= 1 || peakMileage <= startMileage) {
    return Math.round(startMileage);
  }

  const taperWeeks = Math.min(3, Math.max(0, totalWeeks - 1));
  const availableBuildWeeks = Math.max(0, totalWeeks - taperWeeks);
  const fullBuildBlocks = Math.floor(availableBuildWeeks / 3);
  const partialBuildWeeks = availableBuildWeeks % 3;
  const baseBlockCount = Math.min(BASE_BUILD_BLOCK_LEVELS.length, fullBuildBlocks);
  const peakBlockCount = Math.max(0, fullBuildBlocks - baseBlockCount);
  const selectedPeakBlocks = PEAK_BUILD_BLOCK_LEVELS.slice(0, peakBlockCount);
  const finalBuildLevel = selectedPeakBlocks.length > 0
    ? selectedPeakBlocks[selectedPeakBlocks.length - 1][0]
    : BASE_BUILD_BLOCK_LEVELS[Math.max(0, baseBlockCount - 1)]?.[0] ?? 0;
  const levels = [
    ...BASE_BUILD_BLOCK_LEVELS.slice(0, baseBlockCount).flat(),
    ...selectedPeakBlocks.flat(),
    ...Array.from({ length: partialBuildWeeks }, () => finalBuildLevel),
    ...TAPER_LEVELS.slice(-taperWeeks),
  ];
  const progressionLevel = levels[Math.min(week - 1, levels.length - 1)] ?? 0;

  return Math.round(startMileage + (peakMileage - startMileage) * progressionLevel);
}

// ─── Long Run Progression (stepped: plateau → step → recovery → repeat) ──

function longRunDistance(
  week: number,
  totalWeeks: number,
  phase: TrainingPhase,
  currentLongRun: number
): number {
  const baseWeeks = Math.round(totalWeeks * 0.3);
  const taperWeeks = Math.max(3, Math.min(4, Math.round(totalWeeks * 0.2)));
  const buildPhaseWeeks = totalWeeks - baseWeeks - taperWeeks;

  if (phase === "base") {
    // Step from current long run to 14 miles, plateau every 2 weeks
    const steps = [0.6, 0.6, 0.75, 0.75, 0.85, 0.85, 1.0, 1.0];
    const idx = Math.min(week - 1, steps.length - 1);
    const target = Math.min(14, currentLongRun + (14 - currentLongRun) * steps[idx]);
    return Math.round(target * 2) / 2;
  } else if (phase === "marathon_build") {
    // Stepped peaks: 16 → 17 → 18 → 19 → 20 miles, each held 2-3 weeks, with recovery between
    const fullSequence = [
      { miles: 16, hold: 2 },
      { miles: 14, hold: 1 },
      { miles: 17, hold: 2 },
      { miles: 14, hold: 1 },
      { miles: 18, hold: 2 },
      { miles: 14, hold: 1 },
      { miles: 19, hold: 2 },
      { miles: 14, hold: 1 },
      { miles: 20, hold: 3 },
    ];

    // Flatten to weeks
    let weeksList: number[] = [];
    for (const { miles, hold } of fullSequence) {
      for (let i = 0; i < hold; i++) weeksList.push(miles);
    }

    // Trim or pad to fit buildPhaseWeeks
    if (weeksList.length > buildPhaseWeeks) {
      weeksList = weeksList.slice(0, buildPhaseWeeks);
      // Ensure last week hits 20
      if (weeksList[weeksList.length - 1] < 20) {
        weeksList[weeksList.length - 1] = 20;
      }
    } else {
      while (weeksList.length < buildPhaseWeeks) {
        weeksList.push(weeksList[weeksList.length - 1]);
      }
    }

    const buildWeek = week - baseWeeks;
    return weeksList[Math.min(buildWeek - 1, weeksList.length - 1)];
  } else {
    // Taper: 16 → 10 → 5 → race
    const taperStart = totalWeeks - taperWeeks;
    const taperWeek = week - taperStart;
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

function workoutDistanceByType(workout: Workout | null | undefined, type: Workout["type"]): number {
  if (!workout) return 0;
  return workout.segments.reduce((sum, segment) => {
    if (segment.type !== type) return sum;
    return sum + (segment.distance ?? 0) * (segment.repetitions ?? 1);
  }, 0);
}

function getIntensityTargetPercents(profile: RunnerProfile): NonNullable<RunnerProfile["intensityTargetPercents"]> {
  return {
    marathon: Math.max(0, Math.min(30, profile.intensityTargetPercents?.marathon ?? DEFAULT_INTENSITY_TARGET_PERCENTS.marathon)),
    threshold: Math.max(0, Math.min(20, profile.intensityTargetPercents?.threshold ?? DEFAULT_INTENSITY_TARGET_PERCENTS.threshold)),
    vo2: Math.max(0, Math.min(10, profile.intensityTargetPercents?.vo2 ?? DEFAULT_INTENSITY_TARGET_PERCENTS.vo2)),
  };
}

function calculateIntensityTargets(
  weeklyMileage: number,
  phase: TrainingPhase,
  week: number,
  totalWeeks: number,
  targetPercents: NonNullable<RunnerProfile["intensityTargetPercents"]>,
  overrides?: RunnerProfile["weeklyIntensityOverrides"]
): NonNullable<WeeklyPlan["intensityTargetDistribution"]> {
  const weekOverrides = overrides?.[week];
  const weeksBeforeRace = totalWeeks - week;
  const allowsPaceSpecificWorkout = week > 3 && weeksBeforeRace > 2;
  
  const marathonPercent = weekOverrides?.marathon ?? targetPercents.marathon;
  const thresholdPercent = weekOverrides?.threshold ?? targetPercents.threshold;
  const vo2Percent = weekOverrides?.vo2 ?? targetPercents.vo2;

  // Allow overrides even in base phase or early weeks if explicitly provided
  const marathon = (weekOverrides?.marathon !== undefined || (allowsPaceSpecificWorkout && phase !== "base"))
    ? roundMiles((weeklyMileage * marathonPercent) / 100)
    : 0;
  const threshold = (weekOverrides?.threshold !== undefined || allowsPaceSpecificWorkout)
    ? roundMiles((weeklyMileage * thresholdPercent) / 100)
    : 0;
  const vo2 = (weekOverrides?.vo2 !== undefined || (allowsPaceSpecificWorkout && phase !== "base"))
    ? roundMiles((weeklyMileage * vo2Percent) / 100)
    : 0;

  return {
    marathon,
    threshold,
    vo2,
    easy: Math.max(0, roundMiles(weeklyMileage - marathon - threshold - vo2)),
  };
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

function shortestDistanceToLongRun(day: string, longRunDay: string): number {
  const dayIndex = DISPLAY_DAY_ORDER[day];
  const longRunIndex = DISPLAY_DAY_ORDER[longRunDay];
  if (dayIndex === undefined || longRunIndex === undefined) return 7;
  const before = (longRunIndex - dayIndex + 7) % 7;
  const after = (dayIndex - longRunIndex + 7) % 7;
  return Math.min(before, after);
}

function daysBeforeLongRun(day: string, longRunDay: string): number {
  const dayIndex = DISPLAY_DAY_ORDER[day];
  const longRunIndex = DISPLAY_DAY_ORDER[longRunDay];
  if (dayIndex === undefined || longRunIndex === undefined) return 7;
  return (longRunIndex - dayIndex + 7) % 7;
}

function daysAfterLongRun(day: string, longRunDay: string): number {
  const dayIndex = DISPLAY_DAY_ORDER[day];
  const longRunIndex = DISPLAY_DAY_ORDER[longRunDay];
  if (dayIndex === undefined || longRunIndex === undefined) return 7;
  return (dayIndex - longRunIndex + 7) % 7;
}

function pairEasyDaysWithMileage(
  easyRunDays: string[],
  mileageTargets: number[],
  longRunDay: string
): Array<{ day: string; mileage: number }> {
  const nearestBeforeLongRun = [...easyRunDays]
    .filter((day) => daysBeforeLongRun(day, longRunDay) > 0)
    .sort((a, b) => daysBeforeLongRun(a, longRunDay) - daysBeforeLongRun(b, longRunDay))[0];
  const nearestAfterLongRun = [...easyRunDays]
    .filter((day) => daysAfterLongRun(day, longRunDay) > 0)
    .sort((a, b) => daysAfterLongRun(a, longRunDay) - daysAfterLongRun(b, longRunDay))[0];
  const priorityDays = [nearestBeforeLongRun, nearestAfterLongRun].filter(
    (day, index, days): day is string => !!day && days.indexOf(day) === index
  );
  const remainingDays = easyRunDays
    .filter((day) => !priorityDays.includes(day))
    .sort((a, b) => {
      const proximity = shortestDistanceToLongRun(a, longRunDay) - shortestDistanceToLongRun(b, longRunDay);
      if (proximity !== 0) return proximity;
      return DISPLAY_DAY_ORDER[a] - DISPLAY_DAY_ORDER[b];
    });
  const daysOrderedForShorterAroundLongRun = [...priorityDays, ...remainingDays];
  const targetsAscending = [...mileageTargets].sort((a, b) => a - b);
  const mileageByDay = new Map<string, number>();

  daysOrderedForShorterAroundLongRun.forEach((day, index) => {
    mileageByDay.set(day, targetsAscending[index] ?? 0);
  });

  return easyRunDays.map((day) => ({ day, mileage: mileageByDay.get(day) ?? 0 }));
}

function selectKeyWorkoutDay(runDays: string[], longRunDay: string): string | undefined {
  return runDays
    .filter((day) => day !== longRunDay)
    .sort((a, b) => {
      const distanceFromLongRun = shortestDistanceToLongRun(b, longRunDay) - shortestDistanceToLongRun(a, longRunDay);
      if (distanceFromLongRun !== 0) return distanceFromLongRun;
      return DISPLAY_DAY_ORDER[b] - DISPLAY_DAY_ORDER[a];
    })[0];
}

function resizeSimpleRun(workout: Workout, distance: number, paceZones: PaceZones): void {
  const nextDistance = roundMiles(Math.max(1, distance));
  const pace = workout.type === "recovery"
    ? paceZones.recovery
    : (paceZones.easy.min + paceZones.easy.max) / 2;

  workout.totalDistance = nextDistance;
  workout.weeklyMileageContribution = nextDistance;
  workout.estimatedDuration = Math.round(nextDistance * pace);
  workout.title = workout.type === "recovery"
    ? `${nextDistance} mi Recovery Run`
    : `${nextDistance} mi Easy Run`;

  if (workout.segments.length === 1) {
    workout.segments[0].distance = nextDistance;
    workout.segments[0].description = workout.type === "recovery"
      ? `Recovery jog — ${nextDistance} miles, very relaxed effort`
      : `Easy run — ${nextDistance} miles at conversational pace`;
  }
}

function rebalanceDailyMileage(
  days: DailyPlan[],
  weeklyMileage: number,
  longRunDay: string,
  paceZones: PaceZones
): void {
  const ordinaryDayCap = roundMiles(Math.max(8, weeklyMileage * 0.18));
  const adjacentLongRunCap = roundMiles(Math.max(6, weeklyMileage * 0.12));
  const dayMileage = (day: DailyPlan): number => roundMiles(
    (day.workout?.weeklyMileageContribution ?? 0) +
    (day.secondaryWorkout?.weeklyMileageContribution ?? 0)
  );
  const capForDay = (day: DailyPlan): number => {
    const isAdjacentToLongRun = shortestDistanceToLongRun(day.dayOfWeek, longRunDay) === 1;
    return isAdjacentToLongRun ? adjacentLongRunCap : ordinaryDayCap;
  };
  const movableRuns = (day: DailyPlan): Workout[] =>
    [day.secondaryWorkout, day.workout].filter(
      (workout): workout is Workout => workout?.type === "easy" || workout?.type === "recovery"
    );

  const overloadedDays = days
    .filter((day) => day.dayOfWeek !== longRunDay && dayMileage(day) > capForDay(day))
    .sort((a, b) => dayMileage(b) - capForDay(b) - (dayMileage(a) - capForDay(a)));

  for (const sourceDay of overloadedDays) {
    let excess = roundMiles(dayMileage(sourceDay) - capForDay(sourceDay));
    if (excess <= 0) continue;

    const recipientDays = days
      .filter((day) => day !== sourceDay && day.dayOfWeek !== longRunDay && movableRuns(day).length > 0)
      .sort((a, b) => {
        const headroomDifference = (capForDay(b) - dayMileage(b)) - (capForDay(a) - dayMileage(a));
        if (headroomDifference !== 0) return headroomDifference;
        return shortestDistanceToLongRun(b.dayOfWeek, longRunDay) - shortestDistanceToLongRun(a.dayOfWeek, longRunDay);
      });

    for (const recipientDay of recipientDays) {
      if (excess <= 0) break;
      const headroom = roundMiles(capForDay(recipientDay) - dayMileage(recipientDay));
      if (headroom <= 0) continue;

      const sourceWorkout = movableRuns(sourceDay).find((workout) => workout.totalDistance > 1);
      const recipientWorkout = movableRuns(recipientDay)[0];
      if (!sourceWorkout || !recipientWorkout) break;

      const transferable = roundMiles(Math.min(excess, headroom, sourceWorkout.totalDistance - 1));
      if (transferable <= 0) continue;

      resizeSimpleRun(sourceWorkout, sourceWorkout.totalDistance - transferable, paceZones);
      resizeSimpleRun(recipientWorkout, recipientWorkout.totalDistance + transferable, paceZones);
      sourceDay.plannedMileage = dayMileage(sourceDay);
      recipientDay.plannedMileage = dayMileage(recipientDay);
      excess = roundMiles(excess - transferable);
    }
  }
}

// ─── Workout Assignment ────────────────────────────────────

function assignWorkoutsForWeek(
  week: number,
  totalWeeks: number,
  phase: TrainingPhase,
  weeklyMileage: number,
  longRunMiles: number,
  trainingDays: string[],
  longRunDay: string,
  paceZones: PaceZones,
  powerZones: PowerZones | undefined,
  comfortLevel: "beginner" | "intermediate" | "advanced",
  _strengthAvailability: "none" | "light" | "regular",
  isDownWeek: boolean,
  runsPerWeek: number,
  preferredDoubleUpDays: string[],
  intensityTargets: NonNullable<WeeklyPlan["intensityTargetDistribution"]>,
  overrides?: RunnerProfile["weeklyIntensityOverrides"]
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

  const adjustedLongRunMiles = longRunMiles;
  assignedMileage += adjustedLongRunMiles;

  // 2. Assign key workout (threshold or intervals)
  let keyWorkout: Workout | null = null;
  let keyWorkoutDay: string | null = null;
  let remainingMileage = Math.max(0, weeklyMileage - assignedMileage);
  const weeksBeforeRace = totalWeeks - week;
  const allowsPaceSpecificWorkout = week > 3 && weeksBeforeRace > 2;

  if (!isDownWeek && (allowsPaceSpecificWorkout || intensityTargets.marathon > 0 || intensityTargets.threshold > 0 || intensityTargets.vo2 > 0) && runDays.length > 1) {
    if (phase === "base" && (canDoThreshold || intensityTargets.threshold > 0)) {
      const thresholdMiles = intensityTargets.threshold > 0 
        ? intensityTargets.threshold 
        : Math.min(4, Math.max(1, remainingMileage * 0.2));
      const totalDist = Math.min(remainingMileage, thresholdMiles + 3); // warmup/cooldown
      
      const hasThresholdOverride = overrides?.[week]?.threshold !== undefined;
      
      if (week % 4 === 0 && totalDist >= 5 && !hasThresholdOverride) {
        keyWorkout = WorkoutLibrary.createProgressionRun(week, workoutIndex++, totalDist, paceZones, powerZones);
      } else if (week % 2 === 0 || hasThresholdOverride) {
        const reps = comfortLevel === "advanced" ? 4 : 3;
        keyWorkout = WorkoutLibrary.createThresholdIntervals(
          week,
          workoutIndex++,
          totalDist,
          hasThresholdOverride ? Math.max(1, Math.round(thresholdMiles)) : reps,
          1,
          60,
          paceZones,
          powerZones
        );
      } else {
        keyWorkout = WorkoutLibrary.createThresholdRun(week, workoutIndex++, totalDist, thresholdMiles, paceZones, powerZones);
      }
    } else if (phase !== "base" && (canDoIntervals || intensityTargets.vo2 > 0 || intensityTargets.threshold > 0 || intensityTargets.marathon > 0) && !isDownWeek) {
      const hasVO2Override = overrides?.[week]?.vo2 !== undefined;
      const hasMarathonOverride = overrides?.[week]?.marathon !== undefined;
      const hasThresholdOverride = overrides?.[week]?.threshold !== undefined;

      const shouldRunVO2 = hasVO2Override || (phase === "peak_taper" ? week % 2 === 0 : week % 3 === 2);
      const shouldRunMarathon = !shouldRunVO2 && (hasMarathonOverride || (phase === "marathon_build" && week % 3 === 1));

      if (shouldRunVO2) {
        const targetRepMinutes = phase === "peak_taper" ? 3 : comfortLevel === "advanced" ? 4.5 : 4;
        const repDist = nearestVO2RepDistance(paceZones.vo2, targetRepMinutes);
        const reps = Math.max(1, Math.round((intensityTargets.vo2 || (comfortLevel === "advanced" ? 5 : 4)) / repDist));
        const restSeconds = Math.round(targetRepMinutes * 60);
        keyWorkout = hasVO2Override || (intensityTargets.vo2 >= 2)
          ? WorkoutLibrary.createMixedVO2SpeedWorkout(week, workoutIndex++, intensityTargets.vo2 || reps * repDist, paceZones, powerZones)
          : WorkoutLibrary.createVO2Intervals(week, workoutIndex++, reps, repDist, restSeconds, paceZones, powerZones);
      } else if (shouldRunMarathon) {
        const mpMiles = Math.max(1, intensityTargets.marathon || remainingMileage * 0.18);
        const thresholdInsertMiles = Math.max(0.5, Math.min(2, intensityTargets.threshold || mpMiles * 0.15));
        keyWorkout = WorkoutLibrary.createMarathonThresholdAlternation(
          week,
          workoutIndex++,
          mpMiles,
          thresholdInsertMiles,
          paceZones,
          powerZones
        );
      } else {
        const reps = comfortLevel === "advanced" ? 4 : 3;
        const thresholdMiles = Math.max(1, intensityTargets.threshold || reps);
        const totalDist = Math.min(remainingMileage, thresholdMiles + 3);
        keyWorkout = thresholdMiles >= 4 || hasThresholdOverride
          ? WorkoutLibrary.createThresholdLadder(week, workoutIndex++, totalDist, thresholdMiles, paceZones, powerZones)
          : WorkoutLibrary.createThresholdIntervals(
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
    } else if (phase !== "base" && intensityTargets.marathon > 0) {
      // Marathon pace work fallback
      const mpMiles = Math.max(1, intensityTargets.marathon || remainingMileage * 0.15);
      const totalDist = Math.min(remainingMileage, mpMiles + 3);
      keyWorkout = WorkoutLibrary.createMarathonPaceRun(week, workoutIndex++, mpMiles, totalDist, paceZones, powerZones);
    }
  }

  const keyMarathonMiles = workoutDistanceByType(keyWorkout, "marathon_pace");
  const marathonFinishMiles = phase !== "base"
    ? roundMiles(Math.max(0, Math.min(adjustedLongRunMiles * 0.4, intensityTargets.marathon - keyMarathonMiles)))
    : 0;
  const longRun = WorkoutLibrary.createLongRun(
    week,
    workoutIndex++,
    adjustedLongRunMiles,
    paceZones,
    powerZones,
    marathonFinishMiles
  );
  days.push({
    date: "",
    dayOfWeek: longRunDay,
    workout: longRun,
    isRestDay: false,
    plannedMileage: adjustedLongRunMiles,
  });

  // Assign key workout to a mid-week day (not the long run day)
  if (keyWorkout) {
    const keyWorkoutTargetDay = selectKeyWorkoutDay(runDays, longRunDay);

    if (keyWorkoutTargetDay) {
      keyWorkoutDay = keyWorkoutTargetDay;
      days.push({
        date: "",
        dayOfWeek: keyWorkoutTargetDay,
        workout: keyWorkout,
        isRestDay: false,
        plannedMileage: keyWorkout.totalDistance,
      });
      assignedMileage += keyWorkout.totalDistance;
    }
  }

  // 3. Fill remaining training days with easy runs and recovery
  const easyRunDays = runDays.filter((day) => day !== longRunDay && day !== keyWorkoutDay);
  remainingMileage = Math.max(0, weeklyMileage - assignedMileage);
  const doubleDayReserve = doubleDayCount > 0 ? Math.min(4 * doubleDayCount, Math.max(0, remainingMileage - easyRunDays.length * 3)) : 0;
  const primaryEasyMileage = Math.max(0, remainingMileage - doubleDayReserve);
  const easyMileageTargets = distributeVariedMileage(primaryEasyMileage, easyRunDays.length, week);
  const easyDayMileagePairs = pairEasyDaysWithMileage(easyRunDays, easyMileageTargets, longRunDay);

  for (const { day, mileage } of easyDayMileagePairs) {
    // Recovery day after hard workout
    const dayIdx = DAY_INDEX[day];
    const isAfterKeyWorkout = keyWorkoutDay && dayIdx === DAY_INDEX[keyWorkoutDay] + 1;
    const isAfterLongRun = daysAfterLongRun(day, longRunDay) === 1;
    const runMileage = Math.max(mileage > 0 ? 1 : 0, mileage);

    if (isAfterKeyWorkout || isAfterLongRun) {
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

  // Avoid concentrating too much mileage on an ordinary day, especially
  // immediately before or after the long run.
  rebalanceDailyMileage(days, weeklyMileage, longRunDay, paceZones);

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
  const maxLongRunOverride = profile.maxLongRunOverride
    ? Math.max(4, Math.min(30, profile.maxLongRunOverride))
    : null;
  const trainingDays = selectTrainingDays(
    profile.trainingDaysPerWeek,
    profile.preferredRestDay,
    profile.availableLongRunDays
  );
  const longRunDay = profile.availableLongRunDays[0] ?? "Sunday";
  const intensityTargetPercents = getIntensityTargetPercents(profile);

  // Runs per week: user override clamped 3–10, defaults to training days count
  const runsPerWeek = profile.runsPerWeekOverride
    ? Math.max(3, Math.min(10, profile.runsPerWeekOverride))
    : profile.trainingDaysPerWeek;
  const planStart = dayjs.utc(profile.raceDate).subtract(totalWeeks, "week").startOf("isoWeek");

  // Generate weeks
  const weeks: WeeklyPlan[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const phase = getPhaseForWeek(week, phases);
    const progressionMileage = mileageProgression(week, totalWeeks, profile.currentWeeklyMileage, peakMileage, phase);
    const mileageOverride = profile.weeklyMileageOverrides?.[week];
    const weeklyMileage = mileageOverride === undefined
      ? progressionMileage
      : roundMiles(Math.max(5, Math.min(120, mileageOverride)));
    const calculatedLongRunMiles = roundMiles(weeklyMileage * 0.25);
    const longRunMiles = maxLongRunOverride
      ? Math.min(calculatedLongRunMiles, maxLongRunOverride)
      : calculatedLongRunMiles;
    const isDownWeek = phase === "marathon_build" && (week - phases[0].weekRange[1]) % 3 === 0;
    const intensityTargetDistribution = calculateIntensityTargets(
      weeklyMileage,
      phase,
      week,
      totalWeeks,
      intensityTargetPercents,
      profile.weeklyIntensityOverrides
    );

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
      profile.preferredDoubleUpDays ?? [],
      intensityTargetDistribution,
      profile.weeklyIntensityOverrides
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
      calculatedMileage: progressionMileage,
      isDownWeek,
      longRunDistance: longRunMiles,
      intensityDistribution: intensityDist,
      intensityTargetDistribution,
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

  const actualPeakMileage = Math.max(...weeks.map((week) => week.totalMileage));

  return {
    id: `plan-${Date.now()}`,
    runnerProfile: profile,
    paceZones,
    powerZones,
    phases,
    weeks,
    totalWeeks,
    peakWeeklyMileage: actualPeakMileage,
    raceDay: raceDate,
    generatedAt: new Date().toISOString(),
    goalAssessment: assessment,
    riskWarnings,
    adjustmentRules,
  };
}
