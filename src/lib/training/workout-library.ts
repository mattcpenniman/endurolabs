// ============================================================
// EnduroLab — Workout Library
// ============================================================
// Catalog of workout templates used by the plan generator.
// Each template is parameterized by the runner's pace zones
// and training phase to produce concrete weekly workouts.
// ============================================================

import {
  Workout,
  WorkoutSegment,
  WorkoutType,
  PaceZones,
  PowerZones,
} from "./models";

// ─── Template Helpers ───────────────────────────────────────

function makeId(type: WorkoutType, week: number, index: number): string {
  return `${type}-w${week}-${index}`;
}

function roundMiles(distance: number): number {
  return Math.round(distance * 10) / 10;
}

function formatMiles(distance: number): string {
  return `${roundMiles(distance)} mi`;
}

// ─── Easy Run ───────────────────────────────────────────────

export function createEasyRun(
  week: number,
  index: number,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const segments: WorkoutSegment[] = [
    {
      description: `Easy run — ${distance} miles at conversational pace`,
      distance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      power: powerZones ? (powerZones.easy.min + powerZones.easy.max) / 2 : undefined,
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  return {
    id: makeId("easy", week, index),
    type: "easy",
    title: `${distance} mi Easy Run`,
    description: `Steady, conversational-paced run. Focus on form and relaxation.`,
    segments,
    totalDistance: distance,
    estimatedDuration: Math.round(distance * ((paceZones.easy.min + paceZones.easy.max) / 2)),
    weeklyMileageContribution: distance,
    intensityCategory: "easy",
  };
}

// ─── Recovery Run ───────────────────────────────────────────

export function createRecoveryRun(
  week: number,
  index: number,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const segments: WorkoutSegment[] = [
    {
      description: `Recovery jog — ${distance} miles, very relaxed effort`,
      distance,
      pace: paceZones.recovery,
      power: powerZones?.easy.min,
      effort: "Very easy — slower than conversational",
      type: "recovery",
    },
  ];

  return {
    id: makeId("recovery", week, index),
    type: "recovery",
    title: `${distance} mi Recovery Run`,
    description: `Very relaxed jog to promote blood flow and recovery. Do not check your pace.`,
    segments,
    totalDistance: distance,
    estimatedDuration: Math.round(distance * paceZones.recovery),
    weeklyMileageContribution: distance,
    intensityCategory: "easy",
  };
}

// ─── Threshold Run ──────────────────────────────────────────

export function createThresholdRun(
  week: number,
  index: number,
  totalDistance: number,
  thresholdDistance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const easyDistance = totalDistance - thresholdDistance;
  const warmupDistance = roundMiles(easyDistance / 2);
  const cooldownDistance = roundMiles(easyDistance - warmupDistance);
  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `Threshold block — ${formatMiles(thresholdDistance)} at threshold pace`,
      distance: thresholdDistance,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    },
    {
      description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
      distance: cooldownDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  return {
    id: makeId("threshold", week, index),
    type: "threshold",
    title: `${thresholdDistance} mi Threshold Run`,
    description: `Sustained effort at lactate threshold. Build up gradually, settle into threshold pace, hold steady.`,
    segments,
    totalDistance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      thresholdDistance * paceZones.threshold
    ),
    weeklyMileageContribution: totalDistance,
    intensityCategory: "hard",
  };
}

export function createThresholdIntervals(
  week: number,
  index: number,
  totalDistance: number,
  repCount: number,
  repDistance: number,
  restSeconds: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const thresholdDistance = roundMiles(repCount * repDistance);
  const recoveryDistance = roundMiles(((repCount - 1) * restSeconds) / 60 / paceZones.recovery);
  const easyDistance = Math.max(1.5, totalDistance - thresholdDistance - recoveryDistance);
  const warmupDistance = roundMiles(easyDistance * 0.55);
  const cooldownDistance = roundMiles(easyDistance - warmupDistance);
  const actualDistance = roundMiles(warmupDistance + thresholdDistance + recoveryDistance + cooldownDistance);

  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `${repCount}× ${formatMiles(repDistance)} at threshold pace`,
      distance: repDistance,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      restBetween: restSeconds,
      repetitions: repCount,
      type: "threshold",
    },
    {
      description: `Recoveries — ${repCount - 1}× ${Math.round(restSeconds / 60)} min relaxed jog (${formatMiles(recoveryDistance)} total)`,
      distance: recoveryDistance,
      pace: paceZones.recovery,
      power: powerZones?.easy.min,
      effort: "Relaxed jog between threshold reps",
      type: "recovery",
    },
    {
      description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
      distance: cooldownDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  return {
    id: makeId("threshold", week, index),
    type: "threshold",
    title: `${repCount}×${repDistance} mi Cruise Intervals`,
    description: "Threshold intervals with short float recoveries. Keep each rep controlled, not race-hard.",
    segments,
    totalDistance: actualDistance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      thresholdDistance * paceZones.threshold +
      recoveryDistance * paceZones.recovery
    ),
    weeklyMileageContribution: actualDistance,
    intensityCategory: "hard",
  };
}

// ─── VO2 Intervals ──────────────────────────────────────────

export function createVO2Intervals(
  week: number,
  index: number,
  repCount: number,
  repDistance: number,
  restSeconds: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const warmupCooldown = 2; // miles
  const warmupDistance = roundMiles(warmupCooldown * 0.55);
  const cooldownDistance = roundMiles(warmupCooldown - warmupDistance);
  const fastDistance = roundMiles(repCount * repDistance);
  const recoveryDistance = roundMiles(((repCount - 1) * restSeconds) / 60 / paceZones.recovery);
  const totalDistance = roundMiles(warmupDistance + fastDistance + recoveryDistance + cooldownDistance);

  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `${repCount}× ${formatMiles(repDistance)} at VO2 pace`,
      distance: repDistance,
      pace: paceZones.vo2,
      power: powerZones?.vo2,
      effort: paceZones.vo2Effort,
      restBetween: restSeconds,
      repetitions: repCount,
      type: "vo2",
    },
    {
      description: `Recoveries — ${repCount - 1}× ${Math.round(restSeconds / 60)} min easy jog (${formatMiles(recoveryDistance)} total)`,
      distance: recoveryDistance,
      pace: paceZones.recovery,
      power: powerZones?.easy.min,
      effort: "Easy jog until breathing settles",
      type: "recovery",
    },
    {
      description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
      distance: cooldownDistance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  return {
    id: makeId("vo2", week, index),
    type: "vo2",
    title: `${repCount}×${repDistance} mi VO2 Intervals`,
    description: `High-intensity intervals at VO2 max pace. Keep reps in the 3-5 minute range and jog the recoveries.`,
    segments,
    totalDistance,
    estimatedDuration: Math.round(
      warmupCooldown * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      fastDistance * paceZones.vo2 +
      recoveryDistance * paceZones.recovery
    ),
    weeklyMileageContribution: totalDistance,
    intensityCategory: "hard",
  };
}

// ─── Marathon Pace Run ──────────────────────────────────────

export function createMarathonPaceRun(
  week: number,
  index: number,
  mpDistance: number,
  totalDistance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const easyDistance = totalDistance - mpDistance;

  const segments: WorkoutSegment[] = [
    {
      description: "Warm-up — easy pace",
      distance: easyDistance * 0.3,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `${mpDistance} miles at marathon goal pace`,
      distance: mpDistance,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
    },
    {
      description: "Cool-down — easy pace",
      distance: easyDistance * 0.7,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  return {
    id: makeId("marathon_pace", week, index),
    type: "marathon_pace",
    title: `${mpDistance} mi @ Marathon Pace`,
    description: `Practice at goal marathon pace. Focus on even splits and consistent effort.`,
    segments,
    totalDistance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      mpDistance * paceZones.marathon
    ),
    weeklyMileageContribution: totalDistance,
    intensityCategory: "moderate",
  };
}

// ─── Long Run ───────────────────────────────────────────────

export function createLongRun(
  week: number,
  index: number,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const segments: WorkoutSegment[] = [
    {
      description: `Long run — ${distance} miles at easy/conversational pace`,
      distance,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      power: powerZones ? (powerZones.easy.min + powerZones.easy.max) / 2 : undefined,
      effort: paceZones.easyEffort,
      type: "long",
    },
  ];

  return {
    id: makeId("long", week, index),
    type: "long",
    title: `${distance} mi Long Run`,
    description: `Slow, steady miles to build endurance. The last few miles will feel harder — that's the point.`,
    segments,
    totalDistance: distance,
    estimatedDuration: Math.round(distance * ((paceZones.easy.min + paceZones.easy.max) / 2)),
    weeklyMileageContribution: distance,
    intensityCategory: "easy",
  };
}

// ─── Progression Run ────────────────────────────────────────

export function createProgressionRun(
  week: number,
  index: number,
  totalDistance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const third = totalDistance / 3;

  const segments: WorkoutSegment[] = [
    {
      description: "First third — easy pace",
      distance: third,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: "Middle third — marathon pace",
      distance: third,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
    },
    {
      description: "Final third — threshold pace",
      distance: third,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    },
  ];

  return {
    id: makeId("progression", week, index),
    type: "progression",
    title: `${totalDistance} mi Progression Run`,
    description: `Start easy, finish strong. Gradually increase pace through marathon to threshold.`,
    segments,
    totalDistance,
    estimatedDuration: Math.round(
      third * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      third * paceZones.marathon +
      third * paceZones.threshold
    ),
    weeklyMileageContribution: totalDistance,
    intensityCategory: "moderate",
  };
}

// ─── Strength Session ───────────────────────────────────────

export function createStrengthSession(
  week: number,
  index: number
): Workout {
  const segments: WorkoutSegment[] = [
    {
      description: "Running-specific strength training",
      duration: 30,
      effort: "Focus on form, not weight",
      type: "strength",
    },
  ];

  return {
    id: makeId("strength", week, index),
    type: "strength",
    title: "Strength Training (30 min)",
    description:
      "Single-leg work, core, and hip stability. Squats, lunges, calf raises, planks, glute bridges.",
    segments,
    totalDistance: 0,
    estimatedDuration: 30,
    weeklyMileageContribution: 0,
    intensityCategory: "moderate",
  };
}

// ─── Rest Day ───────────────────────────────────────────────

export function createRestDay(): Workout | null {
  return null;
}

// ─── Cross Training ─────────────────────────────────────────

export function createCrossTraining(
  week: number,
  index: number,
  duration: number = 45
): Workout {
  const segments: WorkoutSegment[] = [
    {
      description: `Cross-training session — ${duration} minutes`,
      duration,
      effort: "Moderate effort — cycling, swimming, elliptical, or pool run",
      type: "cross_training",
    },
  ];

  return {
    id: makeId("cross_training", week, index),
    type: "cross_training",
    title: `${duration} min Cross Training`,
    description:
      "Low-impact cardio to maintain aerobic fitness while reducing joint stress. Cycling, swimming, elliptical, or pool run.",
    segments,
    totalDistance: 0,
    estimatedDuration: duration,
    weeklyMileageContribution: 0,
    intensityCategory: "easy",
  };
}

// ─── Public API ─────────────────────────────────────────────

export const WorkoutLibrary = {
  createEasyRun,
  createRecoveryRun,
  createThresholdRun,
  createThresholdIntervals,
  createVO2Intervals,
  createMarathonPaceRun,
  createLongRun,
  createProgressionRun,
  createStrengthSession,
  createCrossTraining,
  createRestDay,
};
