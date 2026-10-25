/**
 * Personalized Q1/Q2 rotation from docs/elite-training-plan.md, weeks 7–23.
 * The elite examples supply session families, not unrestricted mileages: the
 * limits in training-types-reference.md govern the scaled prescriptions.
 * Long sessions use the approved 160-minute ceiling on prescribed segment time,
 * rather than the reference's conservative all-E 150-minute sizing shortcut.
 */
import { PaceZones, PowerZones, WeeklyPlan, Workout } from "./models";
import { WorkoutLibrary } from "./workout-library";

type LongSession = "marathon" | "threshold" | "easy";
type SecondSession = "threshold" | "interval";

const MAX_LONG_RUN_MINUTES = 160;

// Indexed by weeks remaining (race week is handled separately). Keeping this
// race-relative preserves the documented taper in 14–28-week plans.
const ROTATION: Record<number, [LongSession, SecondSession]> = {
  17: ["marathon", "threshold"], 16: ["threshold", "interval"], 15: ["easy", "threshold"],
  14: ["marathon", "threshold"], 13: ["threshold", "interval"], 12: ["easy", "threshold"],
  11: ["marathon", "threshold"], 10: ["threshold", "interval"], 9: ["easy", "threshold"],
  8: ["marathon", "threshold"], 7: ["threshold", "interval"], 6: ["easy", "threshold"],
  5: ["marathon", "threshold"], 4: ["threshold", "interval"], 3: ["easy", "interval"],
  2: ["marathon", "threshold"], 1: ["threshold", "threshold"],
};

function floorMiles(value: number): number {
  return Math.max(0, Math.floor((value + 1e-9) * 4) / 4);
}

function distanceAt(workout: Workout, type: "threshold" | "marathon_pace"): number {
  return workout.segments.reduce((sum, segment) => sum + (segment.type === type
    ? (segment.distance ?? 0) * (segment.repetitions ?? 1) : 0), 0);
}

function thresholdSession(
  week: number, index: number, target: number, distanceBudget: number,
  zones: PaceZones, power?: PowerZones
): Workout | null {
  const easyPace = (zones.easy.min + zones.easy.max) / 2;
  const warmup = Math.ceil(10 / easyPace * 4) / 4;
  // Reserve recovery space before selecting work; never take it from warm-up.
  const work = floorMiles(Math.min(target, distanceBudget - 2 * warmup - 0.75));
  if (work < 0.5) return null;
  const maxRep = floorMiles(Math.min(2, 15 / zones.threshold));
  if (maxRep < 0.25) return null;
  const reps = Math.max(Math.min(3, Math.floor(work / 0.5)), Math.ceil(work / maxRep));
  const repDistance = floorMiles(work / reps);
  const rest = Math.round(repDistance * zones.threshold * 60 / 5);
  const recovery = Math.round((reps - 1) * rest / 60 / zones.recovery * 4) / 4;
  const total = 2 * warmup + reps * repDistance + recovery;
  if (total > distanceBudget) return thresholdSession(week, index, work - 0.25, distanceBudget, zones, power);
  return WorkoutLibrary.createThresholdIntervals(week, index, total, reps, repDistance, rest, zones, power);
}

function intervalSession(
  week: number, target: number, distanceBudget: number, zones: PaceZones, power?: PowerZones
): Workout | null {
  const options = [0.25, 0.5, 0.75, 1].filter((distance) => distance * zones.vo2 <= 5);
  const repDistance = options.reduce((best, distance) =>
    Math.abs(distance * zones.vo2 - 4) < Math.abs(best * zones.vo2 - 4) ? distance : best, options[0] ?? 0);
  if (!repDistance) return null;
  const rest = Math.round(Math.min(120, repDistance * zones.vo2 * 60));
  for (let reps = Math.floor(target / repDistance); reps >= 2; reps--) {
    const workout = WorkoutLibrary.createVO2Intervals(week, 1, reps, repDistance, rest, zones, power);
    if (workout.totalDistance <= distanceBudget) return workout;
  }
  return null;
}

export interface MarathonSessionsInput {
  week: number;
  weeksBeforeRace: number;
  weeklyMileage: number;
  longRunMiles: number;
  /** Total Q2 distance, reserving room for the other runs and any double. */
  secondSessionBudget: number;
  isDownWeek: boolean;
  allowQuality: boolean;
  targets: NonNullable<WeeklyPlan["intensityTargetDistribution"]>;
  paceZones: PaceZones;
  powerZones?: PowerZones;
}

function buildSessionsAtDistance(input: MarathonSessionsInput): { longRun: Workout; keyWorkout: Workout | null } {
  const { week, weeksBeforeRace, weeklyMileage, longRunMiles, secondSessionBudget,
    isDownWeek, targets, paceZones: zones, powerZones: power } = input;
  const rotation = input.allowQuality ? ROTATION[weeksBeforeRace] : undefined;
  let longRun = WorkoutLibrary.createLongRun(week, 0, longRunMiles, zones, power);
  if (!rotation) return { longRun, keyWorkout: null };

  const thresholdBudget = floorMiles(Math.min(targets.threshold, weeklyMileage * 0.1, 60 / zones.threshold));
  const marathonBudget = floorMiles(Math.min(targets.marathon, 16, 90 / zones.marathon));
  // Reduced-volume weeks retain Q2 as in the reference, but Q1 is steady E.
  const longKind = isDownWeek ? "easy" : rotation[0];
  if (longKind === "marathon" && marathonBudget >= 0.5) {
    const threshold = floorMiles(Math.min(2, thresholdBudget / 2, Math.max(0, longRunMiles - 4) / 4));
    const baseWeeks = Math.max(3, week + weeksBeforeRace - 18);
    const progression = 4 + 2 * Math.floor((week - baseWeeks - 1) / 3);
    const marathon = floorMiles(Math.min(marathonBudget, progression, longRunMiles - 4 - threshold));
    if (marathon >= 1 && threshold >= 0.5) {
      longRun = WorkoutLibrary.createMarathonThresholdAlternation(week, 0, marathon, threshold, zones, power, longRunMiles);
      longRun.type = "long";
      longRun.id = `long-w${week}-0`;
      longRun.title = `${longRunMiles} mi Long Run w/ ${marathon} mi M + ${threshold} mi T`;
    } else if (marathon >= 1) {
      // Keep easy running on both sides even when no T inserts were requested.
      longRun = WorkoutLibrary.createMarathonPaceRun(week, 0, marathon, longRunMiles, zones, power);
      longRun.type = "long";
      longRun.id = `long-w${week}-0`;
      longRun.title = `${longRunMiles} mi Long Run w/ ${marathon} mi M`;
    }
  } else if (longKind === "threshold") {
    const threshold = floorMiles(Math.min(thresholdBudget / 2, 2 * floorMiles(15 / zones.threshold), longRunMiles - 4));
    if (threshold >= 1) {
      longRun = WorkoutLibrary.createThresholdLongRun(week, 0, longRunMiles, threshold, zones, power);
    }
  }

  const remainingThreshold = thresholdBudget - distanceAt(longRun, "threshold");
  const intervalBudget = floorMiles(Math.min(targets.vo2, weeklyMileage * 0.08, 10 / 1.609344));
  // The mileage recovery cycle can land on an I week in compressed/extended
  // plans. Recovery policy takes precedence over the race-relative rotation.
  const keyWorkout = !isDownWeek && rotation[1] === "interval" && intervalBudget > 0
    ? intervalSession(week, intervalBudget, secondSessionBudget, zones, power)
    : thresholdSession(week, 1, remainingThreshold, secondSessionBudget, zones, power);
  return { longRun, keyWorkout };
}

/**
 * Q1 owns the long-run slot and shares the weekly T budget with Q2. Build the
 * actual segments before testing duration: faster M/T miles must not be priced
 * as easy miles. Rebuild in quarter-mile steps so work, titles, Q2's remaining
 * threshold budget, and totals stay consistent when a long run must shrink.
 */
export function buildMarathonSessions(input: MarathonSessionsInput): { longRun: Workout; keyWorkout: Workout | null } {
  const maximumDistance = floorMiles(Math.min(input.longRunMiles, input.weeklyMileage * 0.25));
  for (let distance = maximumDistance; distance >= 0; distance -= 0.25) {
    const sessions = buildSessionsAtDistance({ ...input, longRunMiles: distance });
    const minutes = sessions.longRun.segments.reduce((sum, segment) => sum +
      (segment.duration ?? (segment.distance ?? 0) * (segment.pace ?? 0)) * (segment.repetitions ?? 1), 0);
    // Do not use rounded estimatedDuration: 160.2 minutes is still over the cap.
    if (minutes <= MAX_LONG_RUN_MINUTES) return sessions;
  }
  throw new Error("Unable to fit a long run within the prescribed duration limit");
}
