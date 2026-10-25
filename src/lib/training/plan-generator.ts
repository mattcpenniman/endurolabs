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
import { buildMarathonSessions } from "./marathon-sessions";

dayjs.extend(isoWeek);
dayjs.extend(utc);

// ─── Constants ───────────────────────────────────────────────

const MIN_WEEKS = 14;
const MAX_WEEKS = 28;
const MIN_SECONDARY_RUN_MILES = 3;
const MAX_SECONDARY_RUN_MILES = 6;
const MARATHON_RACE_MILES = 26.2;

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
// Taper volume as a fraction of peak, keyed by weeks before the race. The
// documented plan holds roughly 70% of peak through the last three pre-race
// weeks and 60% one week out (docs/elite-training-plan.md). The race week is
// built separately around the race itself.
const TAPER_FRACTIONS_BY_WEEKS_BEFORE_RACE: Record<number, number> = {
  1: 0.6,
  2: 0.7,
  3: 0.7,
};
const TAPER_RECOVERY_FACTOR = 0.9;
const DEFAULT_INTENSITY_TARGET_PERCENTS = {
  marathon: 10,
  threshold: 6,
  vo2: 5,
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

function dividePhases(totalWeeks: number, curve: MileageWeek[], peakMileage: number): PhaseInfo[] {
  // The reference has six aerobic weeks followed by eighteen specific weeks.
  // Longer plans extend the base; short plans retain at least three base weeks.
  const taperWeeks = taperWeekCount(totalWeeks);
  const baseWeeks = Math.max(3, totalWeeks - 18);
  const buildWeeks = totalWeeks - baseWeeks - taperWeeks;
  const buildStart = baseWeeks + 1;
  const buildEnd = baseWeeks + buildWeeks;
  const taperStart = buildEnd + 1;
  const milesAt = (week: number): number => curve[Math.min(Math.max(week, 1), curve.length) - 1]?.mileage ?? 0;
  const longRunAt = (week: number): number => roundMiles(milesAt(week) * 0.25);

  return [
    {
      phaseNumber: 1,
      name: "Phase 1: Aerobic Base + Strides",
      description: `Build from roughly ${milesAt(1)} to ${milesAt(baseWeeks)} miles per week with easy running, adding relaxed strides after the opening three weeks.`,
      focus: "Establish aerobic durability and relaxed mechanics",
      targetMileage: `~${milesAt(1)} -> ${milesAt(baseWeeks)} mpw`,
      longRunRange: `${longRunAt(1)}-${longRunAt(baseWeeks)} miles, mostly easy`,
      weekRange: [1, baseWeeks],
      startDate: "",
      endDate: "",
    },
    {
      phaseNumber: 2,
      name: "Phase 2: Marathon-Specific Build",
      description: `Move from ${milesAt(buildStart)} miles per week toward a ${peakMileage} mpw peak, introduce marathon-pace long runs, and extend fatigue resistance.`,
      focus: "Marathon pace and fatigue resistance",
      targetMileage: `${milesAt(buildStart)} -> ${peakMileage} mpw peak`,
      longRunRange: `Long runs ${longRunAt(buildStart)}-${longRunAt(buildEnd)} miles with marathon-pace work`,
      weekRange: [buildStart, buildEnd],
      startDate: "",
      endDate: "",
    },
    {
      phaseNumber: 3,
      name: "Phase 3: Peak + Taper",
      description: `Reach the most specific long runs at up to ${longRunAt(taperStart - 1)} miles, then reduce volume while keeping enough intensity to stay sharp.`,
      focus: "Highest specificity, then freshen up",
      targetMileage: `Peak ${peakMileage}, then ${milesAt(taperStart)} -> ${milesAt(totalWeeks - 1)} mpw`,
      longRunRange: `Long runs taper from ${longRunAt(taperStart)} to ${longRunAt(totalWeeks - 1)} miles`,
      weekRange: [taperStart, totalWeeks],
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

// ─── Mileage Progression Curve (ramp → recovery → peak, then documented taper) ──

interface MileageWeek {
  /** Target mileage for the week. */
  mileage: number;
  /** Ramp level between start and peak mileage; null in the taper and race weeks. */
  level: number | null;
  /** True when the ramp intentionally drops this week for recovery. */
  isDownWeek: boolean;
}

function taperWeekCount(totalWeeks: number): number {
  return Math.max(3, Math.min(4, Math.round(totalWeeks * 0.2)));
}

function taperMileageForWeeksBeforeRace(weeksBeforeRace: number): number {
  return TAPER_FRACTIONS_BY_WEEKS_BEFORE_RACE[weeksBeforeRace] ?? TAPER_FRACTIONS_BY_WEEKS_BEFORE_RACE[3];
}

/**
 * Build the whole week-by-week mileage curve once. The ramp steps from the
 * runner's current mileage to peak in three-week blocks (two build weeks plus
 * a recovery week), then the final pre-race weeks hold the documented percent
 * of peak. Building the curve in one place keeps the phase ranges, the
 * recovery flags, and the taper on the same sequence.
 */
function buildMileageCurve(totalWeeks: number, startMileage: number, peakMileage: number): MileageWeek[] {
  if (totalWeeks <= 1) {
    return [{ mileage: Math.round(startMileage), level: null, isDownWeek: false }];
  }

  const taperWeeks = taperWeekCount(totalWeeks);
  const buildWeeks = Math.max(0, totalWeeks - taperWeeks);
  const fullBuildBlocks = Math.floor(buildWeeks / 3);
  const partialBuildWeeks = buildWeeks % 3;
  // Shorter plans keep one peak block: the final full block raises to peak
  // instead of repeating the last base step below it.
  const baseBlockCount = fullBuildBlocks <= BASE_BUILD_BLOCK_LEVELS.length
    ? Math.max(0, fullBuildBlocks - 1)
    : BASE_BUILD_BLOCK_LEVELS.length;
  const peakBlockCount = Math.max(0, fullBuildBlocks - baseBlockCount);
  const peakBlocks = Array.from({ length: peakBlockCount }, (_, index) =>
    PEAK_BUILD_BLOCK_LEVELS[index % PEAK_BUILD_BLOCK_LEVELS.length]
  );
  const nextPeakBlock = PEAK_BUILD_BLOCK_LEVELS[peakBlockCount % PEAK_BUILD_BLOCK_LEVELS.length];
  const blocks = [
    ...BASE_BUILD_BLOCK_LEVELS.slice(0, baseBlockCount),
    ...peakBlocks,
    nextPeakBlock.slice(0, partialBuildWeeks),
  ];
  const mileageAtLevel = (level: number): number =>
    peakMileage <= startMileage
      ? Math.round(startMileage)
      : Math.round(startMileage + (peakMileage - startMileage) * level);
  const curve: MileageWeek[] = [];

  for (const block of blocks) {
    block.forEach((level, index) => {
      curve.push({
        mileage: mileageAtLevel(level),
        level,
        isDownWeek: peakMileage > startMileage && block.length === 3 && index === 2 && level < block[1],
      });
    });
  }

  // Taper to the documented percent of peak. If that target is not actually a
  // reduction from the previous week (a runner far below peak whose last build
  // week already sits at that level), step the previous week down instead.
  const taperBase = Math.max(peakMileage, startMileage);
  for (let week = buildWeeks + 1; week <= totalWeeks; week++) {
    const previous = curve[curve.length - 1]?.mileage ?? Math.round(startMileage);
    const target = Math.round(taperBase * taperMileageForWeeksBeforeRace(totalWeeks - week));
    const mileage = Math.max(1, target <= previous ? target : Math.round(previous * TAPER_RECOVERY_FACTOR));
    curve.push({ mileage, level: null, isDownWeek: false });
  }

  return curve;
}

function roundMiles(distance: number): number {
  return Math.round(distance * 4) / 4;
}

function minimumSecondaryRunMiles(weeklyMileage: number): number {
  return roundMiles(Math.max(
    MIN_SECONDARY_RUN_MILES,
    Math.min(MAX_SECONDARY_RUN_MILES, weeklyMileage * 0.06)
  ));
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
  const allowsPaceSpecificWorkout = phase !== "base" && weeksBeforeRace > 0;
  
  const marathonPercent = weekOverrides?.marathon ?? targetPercents.marathon;
  const thresholdPercent = weekOverrides?.threshold ?? targetPercents.threshold;
  const vo2Percent = weekOverrides?.vo2 ?? targetPercents.vo2;

  // Keep requested overrides visible as targets; the session policy still
  // protects the aerobic base and caps actual work to the reference limits.
  const marathon = (weekOverrides?.marathon !== undefined || allowsPaceSpecificWorkout)
    ? roundMiles((weeklyMileage * marathonPercent) / 100)
    : 0;
  const threshold = (weekOverrides?.threshold !== undefined || allowsPaceSpecificWorkout)
    ? roundMiles((weeklyMileage * thresholdPercent) / 100)
    : 0;
  const vo2 = (weekOverrides?.vo2 !== undefined || allowsPaceSpecificWorkout)
    ? roundMiles((weeklyMileage * vo2Percent) / 100)
    : 0;

  return {
    marathon,
    threshold,
    vo2,
    easy: Math.max(0, roundMiles(weeklyMileage - marathon - threshold - vo2)),
  };
}

function distributeVariedMileage(
  totalMileage: number,
  dayCount: number,
  week: number,
  minimumMileage = 1
): number[] {
  if (dayCount <= 0) return [];
  if (dayCount === 1) return [roundMiles(totalMileage)];

  const minimum = totalMileage >= dayCount * minimumMileage
    ? minimumMileage
    : totalMileage >= dayCount ? 1 : 0;
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
    }).find((day) => shortestDistanceToLongRun(day, longRunDay) >= 2);
}

function resizeSimpleRun(workout: Workout, distance: number, paceZones: PaceZones): void {
  const hasStrides = workout.title.includes("Strides");
  const nextDistance = roundMiles(Math.max(1, distance));
  const pace = workout.type === "recovery"
    ? paceZones.recovery
    : (paceZones.easy.min + paceZones.easy.max) / 2;

  workout.totalDistance = nextDistance;
  workout.weeklyMileageContribution = nextDistance;
  workout.estimatedDuration = Math.round(nextDistance * pace);
  workout.title = workout.type === "recovery"
    ? `${nextDistance} mi Recovery Run`
    : `${nextDistance} mi ${hasStrides ? "Easy + Strides" : "Easy Run"}`;

  if (workout.segments.length === 1) {
    workout.segments[0].distance = nextDistance;
    workout.segments[0].description = workout.type === "recovery"
      ? `Recovery jog — ${nextDistance} miles, very relaxed effort`
      : `Easy run — ${nextDistance} miles at conversational pace${hasStrides ? "; finish with 6–8 relaxed 20–30 second strides" : ""}`;
  }
}

function rebalanceDailyMileage(
  days: DailyPlan[],
  weeklyMileage: number,
  longRunDay: string,
  paceZones: PaceZones
): void {
  const ordinaryDayCap = roundMiles(Math.max(8, weeklyMileage * 0.2));
  const adjacentLongRunCap = roundMiles(Math.max(6, weeklyMileage * 0.12));
  const dayMileage = (day: DailyPlan): number => roundMiles(
    (day.workout?.weeklyMileageContribution ?? 0) +
    (day.secondaryWorkout?.weeklyMileageContribution ?? 0)
  );
  const capForDay = (day: DailyPlan): number => {
    const isAdjacentToLongRun = shortestDistanceToLongRun(day.dayOfWeek, longRunDay) === 1;
    return isAdjacentToLongRun ? adjacentLongRunCap : ordinaryDayCap;
  };
  const easyPace = (paceZones.easy.min + paceZones.easy.max) / 2;
  const entries = days.flatMap((day) => [day.workout, day.secondaryWorkout]
    .filter((workout): workout is Workout => workout?.type === "easy" || workout?.type === "recovery")
    .map((workout) => ({ day, workout, cap: Math.floor(Math.min(
      workout === day.secondaryWorkout ? MAX_SECONDARY_RUN_MILES : Infinity,
      workout.type === "recovery" ? 60 / paceZones.recovery : 150 / easyPace
    ) * 4) / 4 })));
  // Clip duration/secondary limits first. Unplaceable miles remain unassigned;
  // never turn a recovery run into a second long run to force a volume target.
  for (const { day, workout, cap } of entries) {
    if (workout.totalDistance > cap) resizeSimpleRun(workout, cap, paceZones);
    day.plannedMileage = dayMileage(day);
  }
  for (const day of days.filter((candidate) => candidate.dayOfWeek !== longRunDay)) {
    for (const { workout } of entries.filter((entry) => entry.day === day)) {
      const excess = roundMiles(dayMileage(day) - ordinaryDayCap);
      if (excess <= 0) break;
      const minimum = workout === day.secondaryWorkout ? minimumSecondaryRunMiles(weeklyMileage) : 1;
      resizeSimpleRun(workout, Math.max(minimum, workout.totalDistance - excess), paceZones);
      day.plannedMileage = dayMileage(day);
    }
  }
  let remaining = roundMiles(weeklyMileage - days.reduce((sum, day) => sum + dayMileage(day), 0));
  while (remaining >= 0.25) {
    const recipient = entries.filter(({ day, workout, cap }) => workout.totalDistance + 0.25 <= cap &&
      day.dayOfWeek !== longRunDay && dayMileage(day) + 0.25 <= ordinaryDayCap)
      .sort((a, b) => dayMileage(a.day) / capForDay(a.day) - dayMileage(b.day) / capForDay(b.day) ||
        Number(a.workout === a.day.secondaryWorkout) - Number(b.workout === b.day.secondaryWorkout))[0];
    if (!recipient) break;
    resizeSimpleRun(recipient.workout, recipient.workout.totalDistance + 0.25, paceZones);
    recipient.day.plannedMileage = dayMileage(recipient.day);
    remaining = roundMiles(remaining - 0.25);
  }
}

// ─── Race Week ─────────────────────────────────────────────

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeekForDate(value: string): string {
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return WEEKDAY_NAMES[parsed.getUTCDay()] ?? "Sunday";
}

/**
 * Build the final week around the race itself, following the race-week schedule
 * in docs/elite-training-plan.md: a short easy run on every available day,
 * strides on the middle days, one light threshold sharpener five days out, and
 * a short easy run the day before the race. The race is not counted as training
 * mileage. Days that fall on the preferred rest day or outside the runner's
 * available days stay as rest.
 */
function buildRaceWeek(
  week: number,
  raceDate: string,
  trainingDays: string[],
  preferredRestDay: string,
  paceZones: PaceZones,
  powerZones: PowerZones | undefined
): DailyPlan[] {
  const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const raceDay = dayOfWeekForDate(raceDate);
  const raceIndex = DISPLAY_DAY_ORDER[raceDay] ?? 6;
  const easyRunMiles = (minutes: number): number => {
    const easyPace = (paceZones.easy.min + paceZones.easy.max) / 2;
    return Math.max(1, roundMiles(minutes / easyPace));
  };
  // Keyed by days remaining until the race, mirroring the documented schedule.
  const schedule = new Map<number, (index: number) => Workout>([
    [6, (index) => WorkoutLibrary.createShakeoutRun(week, index, easyRunMiles(60), paceZones, powerZones)],
    [5, (index) => WorkoutLibrary.createThresholdIntervals(week, index, 7.75, 4, 0.75, 120, paceZones, powerZones)],
    [4, (index) => WorkoutLibrary.createShakeoutRun(week, index, easyRunMiles(40), paceZones, powerZones)],
    [3, (index) => WorkoutLibrary.createShakeoutRun(week, index, easyRunMiles(25), paceZones, powerZones)],
    [2, (index) => WorkoutLibrary.createEasyRun(week, index, easyRunMiles(15), paceZones, powerZones)],
    [1, (index) => WorkoutLibrary.createEasyRun(week, index, easyRunMiles(25), paceZones, powerZones)],
  ]);
  let workoutIndex = 0;

  return allDays.map((day) => {
    const dayIndex = DISPLAY_DAY_ORDER[day];
    if (day === raceDay) {
      const race = WorkoutLibrary.createRaceDayWorkout(
        week,
        workoutIndex++,
        MARATHON_RACE_MILES,
        paceZones,
        powerZones
      );
      return {
        date: "",
        dayOfWeek: day,
        workout: race,
        isRestDay: false,
        plannedMileage: race.totalDistance,
        isRaceDay: true,
      };
    }

    const build = dayIndex < raceIndex ? schedule.get(raceIndex - dayIndex) : undefined;
    if (build && trainingDays.includes(day) && day !== preferredRestDay) {
      const workout = build(workoutIndex++);
      return {
        date: "",
        dayOfWeek: day,
        workout,
        isRestDay: false,
        plannedMileage: workout.totalDistance,
      };
    }

    return { date: "", dayOfWeek: day, workout: null, isRestDay: true, plannedMileage: 0 };
  });
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
  intensityTargets: NonNullable<WeeklyPlan["intensityTargetDistribution"]>
): DailyPlan[] {
  const days: DailyPlan[] = [];
  const allDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const targetRunCount = Math.max(1, Math.min(10, runsPerWeek));
  const primaryRunCount = Math.min(trainingDays.length, targetRunCount);
  const runDays = [
    longRunDay,
    ...trainingDays.filter((day) => day !== longRunDay),
  ].slice(0, primaryRunCount);

  // How many double-days? (runs exceeding training days)
  const doubleDayCount = Math.max(0, targetRunCount - primaryRunCount);
  const secondaryRunMinimum = minimumSecondaryRunMiles(weeklyMileage);

  // Distribute workouts across training days
  let workoutIndex = 2;
  let assignedMileage = 0;

  const adjustedLongRunMiles = longRunMiles;
  assignedMileage += adjustedLongRunMiles;

  // Q1 is the long session, Q2 is the separated midweek quality session.
  let keyWorkoutDay: string | null = null;
  let remainingMileage = Math.max(0, weeklyMileage - assignedMileage);
  const weeksBeforeRace = totalWeeks - week;
  const keyWorkoutTargetDay = selectKeyWorkoutDay(runDays, longRunDay);
  const secondaryReserve = doubleDayCount > 0 ? secondaryRunMinimum : 0;
  const secondSessionBudget = Math.min(
    Math.max(0, remainingMileage - (runDays.length - 2) * 3 - doubleDayCount * secondaryRunMinimum),
    Math.max(0, roundMiles(Math.max(8, weeklyMileage * 0.18)) - secondaryReserve)
  );
  const { longRun, keyWorkout } = buildMarathonSessions({
    week, weeksBeforeRace, weeklyMileage, longRunMiles: adjustedLongRunMiles,
    secondSessionBudget: keyWorkoutTargetDay ? secondSessionBudget : 0,
    isDownWeek, allowQuality: phase !== "base" && (comfortLevel !== "beginner" || week > 4),
    targets: intensityTargets, paceZones, powerZones,
  });
  days.push({
    date: "",
    dayOfWeek: longRunDay,
    workout: longRun,
    isRestDay: false,
    plannedMileage: adjustedLongRunMiles,
  });

  // Assign key workout to a mid-week day (not the long run day)
  if (keyWorkout) {
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
  const doubleDayReserve = doubleDayCount > 0
    ? Math.min(
        remainingMileage,
        Math.max(4, secondaryRunMinimum) * doubleDayCount,
        Math.max(secondaryRunMinimum * doubleDayCount, remainingMileage - easyRunDays.length * 3)
      )
    : 0;
  const primaryEasyMileage = Math.max(0, remainingMileage - doubleDayReserve);
  const easyMileageTargets = distributeVariedMileage(primaryEasyMileage, easyRunDays.length, week);
  const easyDayMileagePairs = pairEasyDaysWithMileage(easyRunDays, easyMileageTargets, longRunDay);

  for (const { day, mileage } of easyDayMileagePairs) {
    // Recovery day after hard workout, including Sunday/Monday wraparound.
    const isAfterKeyWorkout = keyWorkoutDay && daysAfterLongRun(day, keyWorkoutDay) === 1;
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
      const easy = phase === "base" && week > 3 && easyRunDays.indexOf(day) < 3
        ? WorkoutLibrary.createShakeoutRun(week, workoutIndex++, runMileage, paceZones, powerZones)
        : WorkoutLibrary.createEasyRun(week, workoutIndex++, runMileage, paceZones, powerZones);
      if (phase === "base" && week > 3 && easy.title.includes("Strides")) {
        easy.description = "Easy aerobic running followed by 6–8 relaxed 20–30 second strides with full recovery.";
        easy.segments[0].description = `Easy run — ${runMileage} miles, then 6–8 relaxed 20–30 second strides`;
      }
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
      week + 2,
      secondaryRunMinimum
    );

    for (let i = 0; i < Math.min(doubleDayCount, orderedCandidateDays.length); i++) {
      const doubleDayMiles = Math.max(
        secondaryRunMinimum,
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
      resizeSimpleRun(adjustableDay.workout, adjustedDistance, paceZones);
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
  const assessment = assessGoal(profile);
  const paceZones = calculatePaceZones(profile);
  const powerZones = calculatePowerZones(profile, paceZones);

  // Use user override if set, otherwise fall back to assessment recommendation
  const peakMileage = profile.peakMileageOverride
    ? Math.max(10, Math.min(120, profile.peakMileageOverride))
    : assessment.recommendedPeakMileage;
  const mileageCurve = buildMileageCurve(totalWeeks, profile.currentWeeklyMileage, peakMileage);
  const phases = dividePhases(totalWeeks, mileageCurve, peakMileage);
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
  const planStart = dayjs.utc(profile.raceDate)
    .startOf("isoWeek")
    .subtract(totalWeeks - 1, "week");

  // Generate weeks
  const weeks: WeeklyPlan[] = [];

  for (let week = 1; week <= totalWeeks; week++) {
    const phase = getPhaseForWeek(week, phases);
    const isRaceWeek = week === totalWeeks;
    const curveWeek = mileageCurve[week - 1];
    const progressionMileage = curveWeek?.mileage ?? profile.currentWeeklyMileage;
    const mileageOverride = profile.weeklyMileageOverrides?.[week];
    const weeklyMileage = mileageOverride === undefined
      ? progressionMileage
      : roundMiles(Math.max(5, Math.min(120, mileageOverride)));
    const isDownWeek = phase === "marathon_build" && Boolean(curveWeek?.isDownWeek);
    let intensityTargetDistribution = calculateIntensityTargets(
      weeklyMileage,
      phase,
      week,
      totalWeeks,
      intensityTargetPercents,
      profile.weeklyIntensityOverrides
    );

    let days: DailyPlan[];
    let targetMileage = weeklyMileage;
    let longRunMiles: number;
    if (isRaceWeek) {
      days = buildRaceWeek(week, profile.raceDate, trainingDays, profile.preferredRestDay, paceZones, powerZones);
      targetMileage = roundMiles(days.reduce(
        (sum, day) =>
          sum +
          (day.workout?.weeklyMileageContribution ?? 0) +
          (day.secondaryWorkout?.weeklyMileageContribution ?? 0),
        0
      ));
      longRunMiles = 0;
    } else {
      let effectiveMileage = weeklyMileage;
      // If the available runs cannot hold the requested volume, rebuild the
      // whole prescription at the feasible volume. This keeps the long-run
      // share and weekly quality limits tied to scheduled, not imaginary miles.
      // Each retry decreases by at least a quarter mile, so this is bounded.
      while (true) {
        intensityTargetDistribution = calculateIntensityTargets(
          effectiveMileage, phase, week, totalWeeks, intensityTargetPercents, profile.weeklyIntensityOverrides
        );
        const easyPace = (paceZones.easy.min + paceZones.easy.max) / 2;
        const calculatedLongRunMiles = Math.floor(Math.min(effectiveMileage * 0.25, 150 / easyPace) * 4) / 4;
        longRunMiles = maxLongRunOverride
          ? Math.min(calculatedLongRunMiles, maxLongRunOverride)
          : calculatedLongRunMiles;
        days = assignWorkoutsForWeek(
          week,
          totalWeeks,
          phase,
          effectiveMileage,
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
          intensityTargetDistribution
        );
        targetMileage = roundMiles(days.reduce((sum, day) => sum +
          (day.workout?.weeklyMileageContribution ?? 0) + (day.secondaryWorkout?.weeklyMileageContribution ?? 0), 0));
        if (targetMileage >= effectiveMileage - 0.01) break;
        effectiveMileage = targetMileage;
      }
    }

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
      totalMileage: targetMileage,
      calculatedMileage: isRaceWeek ? targetMileage : progressionMileage,
      isDownWeek,
      longRunDistance: longRunMiles,
      intensityDistribution: intensityDist,
      intensityTargetDistribution: isRaceWeek ? { ...intensityDist } : intensityTargetDistribution,
      isRaceWeek,
    });
  }

  // Set phase dates
  phases.forEach((phase) => {
    phase.startDate = planStart.add(phase.weekRange[0] - 1, "week").toISOString();
    phase.endDate = planStart.add(phase.weekRange[1], "week").subtract(1, "day").toISOString();
    const phaseWeeks = weeks.slice(phase.weekRange[0] - 1, phase.weekRange[1]).filter((week) => !week.isRaceWeek);
    const longRuns = phaseWeeks.map((week) => week.longRunDistance);
    const minimum = Math.min(...longRuns);
    const maximum = Math.max(...longRuns);
    phase.longRunRange = `${minimum}-${maximum} miles${phase.phaseNumber === 1 ? ", easy" : ", scaled Q1 sessions"}`;
    if (phase.phaseNumber === 3) {
      phase.description = `Reduce volume while retaining controlled quality. Long sessions range from ${minimum} to ${maximum} miles before race week.`;
    }
  });

  const raceDate = profile.raceDate;
  const riskWarnings = generateRiskWarnings(profile, assessment, peakMileage);
  const constrainedWeeks = weeks.filter((week) => !week.isRaceWeek && week.totalMileage + 0.01 <
    (profile.weeklyMileageOverrides?.[week.weekNumber] ?? mileageCurve[week.weekNumber - 1].mileage));
  if (constrainedWeeks.length > 0) {
    riskWarnings.push(`Weeks ${constrainedWeeks.map((week) => week.weekNumber).join(", ")}: requested mileage does not fit the available runs within duration and daily-load limits; scheduled volume is reduced. Add available runs or revise the mileage target.`);
  }
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
