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
  return Math.round(distance * 4) / 4;
}

function formatMiles(distance: number): string {
  return `${roundMiles(distance)} mi`;
}

function easyPace(paceZones: PaceZones): number {
  return (paceZones.easy.min + paceZones.easy.max) / 2;
}

function recoveryDistanceForRest(restSeconds: number, repetitions: number, paceZones: PaceZones): number {
  return roundMiles((Math.max(0, repetitions - 1) * restSeconds) / 60 / paceZones.recovery);
}

function totalSegmentDistance(segments: WorkoutSegment[]): number {
  return roundMiles(segments.reduce((sum, segment) => {
    return sum + (segment.distance ?? 0) * (segment.repetitions ?? 1);
  }, 0));
}

function estimatedSegmentDuration(segments: WorkoutSegment[]): number {
  return Math.round(segments.reduce((sum, segment) => {
    if (segment.distance && segment.pace) {
      return sum + segment.distance * (segment.repetitions ?? 1) * segment.pace;
    }
    return sum + (segment.duration ?? 0);
  }, 0));
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
  const actualTotalDistance = roundMiles(totalDistance);
  const workDistance = roundMiles(thresholdDistance);
  const easyDistance = Math.max(0, actualTotalDistance - workDistance);
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
      description: `Threshold block — ${formatMiles(workDistance)} at threshold pace`,
      distance: workDistance,
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
    title: `${workDistance} mi Threshold Run`,
    description: `Sustained effort at lactate threshold. Build up gradually, settle into threshold pace, hold steady.`,
    segments,
    totalDistance: actualTotalDistance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      workDistance * paceZones.threshold
    ),
    weeklyMileageContribution: actualTotalDistance,
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

export function createThresholdLadder(
  week: number,
  index: number,
  totalDistance: number,
  thresholdDistance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const actualTotalDistance = roundMiles(totalDistance);
  let remainingThreshold = roundMiles(thresholdDistance);
  const reps: number[] = [];
  const repPattern = remainingThreshold >= 8 ? [4, 3, 2, 1] : remainingThreshold >= 6 ? [3, 2, 1] : [2, 1, 1];

  for (const rep of repPattern) {
    if (remainingThreshold <= 0) break;
    const nextRep = roundMiles(Math.min(rep, remainingThreshold));
    if (nextRep > 0) {
      reps.push(nextRep);
      remainingThreshold = roundMiles(remainingThreshold - nextRep);
    }
  }

  while (remainingThreshold > 0) {
    const nextRep = roundMiles(Math.min(reps.at(-1) ?? 1, remainingThreshold));
    reps.push(nextRep);
    remainingThreshold = roundMiles(remainingThreshold - nextRep);
  }

  const thresholdMiles = roundMiles(reps.reduce((sum, rep) => sum + rep, 0));
  const recoverySegments = Math.max(0, reps.length - 1);
  const recoveryDistance = roundMiles(recoverySegments * 2 / paceZones.recovery);
  const easyDistance = Math.max(1.5, roundMiles(actualTotalDistance - thresholdMiles - recoveryDistance));
  const warmupDistance = roundMiles(easyDistance * 0.55);
  const cooldownDistance = roundMiles(easyDistance - warmupDistance);
  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: easyPace(paceZones),
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  reps.forEach((rep, repIndex) => {
    segments.push({
      description: `Threshold rep ${repIndex + 1} — ${formatMiles(rep)} at threshold pace`,
      distance: rep,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    });
    if (repIndex < reps.length - 1) {
      segments.push({
        description: "Float recovery — 2 min easy jog",
        duration: 2,
        distance: roundMiles(2 / paceZones.recovery),
        pace: paceZones.recovery,
        power: powerZones?.easy.min,
        effort: "Relaxed jog between threshold reps",
        type: "recovery",
      });
    }
  });

  segments.push({
    description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
    distance: cooldownDistance,
    pace: easyPace(paceZones),
    effort: paceZones.easyEffort,
    type: "easy",
  });

  const actualDistance = totalSegmentDistance(segments);

  return {
    id: makeId("threshold", week, index),
    type: "threshold",
    title: `${thresholdMiles} mi Threshold Ladder`,
    description: "Broken threshold work with short float recoveries. Longer reps come first, then the pace stays controlled as reps shorten.",
    segments,
    totalDistance: actualDistance,
    estimatedDuration: estimatedSegmentDuration(segments),
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

export function createMixedVO2SpeedWorkout(
  week: number,
  index: number,
  vo2Distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const targetFastDistance = roundMiles(Math.max(1, vo2Distance));
  const oneKDistance = 0.62;
  const speedDistance = 0.25;
  const oneKReps = Math.max(2, Math.floor((targetFastDistance * 0.7) / oneKDistance));
  const oneKFastDistance = roundMiles(oneKReps * oneKDistance);
  const remainingFastDistance = Math.max(0, roundMiles(targetFastDistance - oneKFastDistance));
  const speedReps = Math.max(remainingFastDistance > 0 ? 2 : 0, Math.round(remainingFastDistance / speedDistance));
  const actualFastDistance = roundMiles(oneKFastDistance + speedReps * speedDistance);
  const oneKRecovery = recoveryDistanceForRest(120, oneKReps, paceZones);
  const speedRecovery = speedReps > 0 ? recoveryDistanceForRest(180, speedReps, paceZones) : 0;
  const warmupDistance = 1.5;
  const cooldownDistance = 1.5;
  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: easyPace(paceZones),
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `${oneKReps}× ${formatMiles(oneKDistance)} at VO2 pace`,
      distance: oneKDistance,
      pace: paceZones.vo2,
      power: powerZones?.vo2,
      effort: paceZones.vo2Effort,
      restBetween: 120,
      repetitions: oneKReps,
      type: "vo2",
    },
    {
      description: `Recoveries — ${Math.max(0, oneKReps - 1)}× 2 min easy jog (${formatMiles(oneKRecovery)} total)`,
      distance: oneKRecovery,
      pace: paceZones.recovery,
      power: powerZones?.easy.min,
      effort: "Easy jog until breathing settles",
      type: "recovery",
    },
    ...(speedReps > 0
      ? [
          {
            description: `${speedReps}× ${formatMiles(speedDistance)} fast but relaxed`,
            distance: speedDistance,
            pace: paceZones.vo2,
            power: powerZones?.vo2,
            effort: "Fast, smooth mechanics with full control",
            restBetween: 180,
            repetitions: speedReps,
            type: "vo2" as const,
          },
          {
            description: `Speed recoveries — ${Math.max(0, speedReps - 1)}× 3 min easy jog (${formatMiles(speedRecovery)} total)`,
            distance: speedRecovery,
            pace: paceZones.recovery,
            power: powerZones?.easy.min,
            effort: "Full easy jog recovery before the fast reps",
            type: "recovery" as const,
          },
        ]
      : []),
    {
      description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
      distance: cooldownDistance,
      pace: easyPace(paceZones),
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];

  const totalDistance = totalSegmentDistance(segments);

  return {
    id: makeId("vo2", week, index),
    type: "vo2",
    title: `${actualFastDistance} mi VO2 + Speed Mix`,
    description: "Longer VO2 reps first, then short fast reps while mechanics are still controlled.",
    segments,
    totalDistance,
    estimatedDuration: estimatedSegmentDuration(segments),
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
  const actualTotalDistance = roundMiles(totalDistance);
  const marathonDistance = roundMiles(mpDistance);
  const easyDistance = Math.max(0, actualTotalDistance - marathonDistance);
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
      description: `${formatMiles(marathonDistance)} at marathon goal pace`,
      distance: marathonDistance,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
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
    id: makeId("marathon_pace", week, index),
    type: "marathon_pace",
    title: `${marathonDistance} mi @ Marathon Pace`,
    description: `Practice at goal marathon pace. Focus on even splits and consistent effort.`,
    segments,
    totalDistance: actualTotalDistance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      marathonDistance * paceZones.marathon
    ),
    weeklyMileageContribution: actualTotalDistance,
    intensityCategory: "moderate",
  };
}

export function createMarathonThresholdAlternation(
  week: number,
  index: number,
  marathonDistance: number,
  thresholdDistance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): Workout {
  const marathonMiles = roundMiles(Math.max(1, marathonDistance));
  const thresholdMiles = roundMiles(Math.max(0.5, thresholdDistance));
  const firstMarathon = roundMiles(Math.max(1, marathonMiles * 0.6));
  const secondMarathon = roundMiles(Math.max(0, marathonMiles - firstMarathon));
  const firstThreshold = roundMiles(Math.max(0.5, thresholdMiles * 0.5));
  const secondThreshold = roundMiles(Math.max(0, thresholdMiles - firstThreshold));
  const warmupDistance = 2;
  const cooldownDistance = 2;
  const segments: WorkoutSegment[] = [
    {
      description: `Warm-up — ${formatMiles(warmupDistance)} easy pace`,
      distance: warmupDistance,
      pace: easyPace(paceZones),
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `Marathon block 1 — ${formatMiles(firstMarathon)} at goal marathon pace`,
      distance: firstMarathon,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
    },
    {
      description: `Threshold insert 1 — ${formatMiles(firstThreshold)} at threshold pace`,
      distance: firstThreshold,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    },
    ...(secondMarathon > 0
      ? [{
          description: `Marathon block 2 — ${formatMiles(secondMarathon)} at goal marathon pace`,
          distance: secondMarathon,
          pace: paceZones.marathon,
          power: powerZones?.marathon,
          effort: paceZones.marathonEffort,
          type: "marathon_pace" as const,
        }]
      : []),
    ...(secondThreshold > 0
      ? [{
          description: `Threshold insert 2 — ${formatMiles(secondThreshold)} at threshold pace`,
          distance: secondThreshold,
          pace: paceZones.threshold,
          power: powerZones?.threshold,
          effort: paceZones.thresholdEffort,
          type: "threshold" as const,
        }]
      : []),
    {
      description: `Cool-down — ${formatMiles(cooldownDistance)} easy pace`,
      distance: cooldownDistance,
      pace: easyPace(paceZones),
      effort: paceZones.easyEffort,
      type: "easy",
    },
  ];
  const totalDistance = totalSegmentDistance(segments);

  return {
    id: makeId("marathon_pace", week, index),
    type: "marathon_pace",
    title: `${marathonMiles} mi M + ${thresholdMiles} mi T Alternation`,
    description: "Marathon-pace work with threshold inserts to practice clearing fatigue while returning to goal pace.",
    segments,
    totalDistance,
    estimatedDuration: estimatedSegmentDuration(segments),
    weeklyMileageContribution: totalDistance,
    intensityCategory: "hard",
  };
}

// ─── Long Run ───────────────────────────────────────────────

export function createLongRun(
  week: number,
  index: number,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones,
  marathonFinishDistance = 0
): Workout {
  const finishDistance = Math.min(distance, Math.max(0, marathonFinishDistance));
  const easyDistance = Math.max(0, distance - finishDistance);
  const segments: WorkoutSegment[] = [
    ...(easyDistance > 0
      ? [{
          description: `Long run — ${easyDistance} miles at easy/conversational pace`,
          distance: easyDistance,
          pace: (paceZones.easy.min + paceZones.easy.max) / 2,
          power: powerZones ? (powerZones.easy.min + powerZones.easy.max) / 2 : undefined,
          effort: paceZones.easyEffort,
          type: "long" as const,
        }]
      : []),
    ...(finishDistance > 0
      ? [{
          description: `Fast finish — ${finishDistance} miles at marathon pace`,
          distance: finishDistance,
          pace: paceZones.marathon,
          power: powerZones?.marathon,
          effort: paceZones.marathonEffort,
          type: "marathon_pace" as const,
        }]
      : []),
  ];

  return {
    id: makeId("long", week, index),
    type: "long",
    title: finishDistance > 0 ? `${distance} mi Long Run w/ MP Finish` : `${distance} mi Long Run`,
    description: finishDistance > 0
      ? `Slow endurance run finishing with marathon-pace work.`
      : `Slow, steady miles to build endurance. The last few miles will feel harder — that's the point.`,
    segments,
    totalDistance: distance,
    estimatedDuration: Math.round(
      easyDistance * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      finishDistance * paceZones.marathon
    ),
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
  const actualTotalDistance = roundMiles(totalDistance);
  const first = roundMiles(actualTotalDistance / 3);
  const middle = roundMiles(actualTotalDistance / 3);
  const final = roundMiles(actualTotalDistance - first - middle);

  const segments: WorkoutSegment[] = [
    {
      description: `First section — ${formatMiles(first)} easy pace`,
      distance: first,
      pace: (paceZones.easy.min + paceZones.easy.max) / 2,
      effort: paceZones.easyEffort,
      type: "easy",
    },
    {
      description: `Middle section — ${formatMiles(middle)} marathon pace`,
      distance: middle,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
    },
    {
      description: `Final section — ${formatMiles(final)} threshold pace`,
      distance: final,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    },
  ];

  return {
    id: makeId("progression", week, index),
    type: "progression",
    title: `${actualTotalDistance} mi Progression Run`,
    description: `Start easy, finish strong. Gradually increase pace through marathon to threshold.`,
    segments,
    totalDistance: actualTotalDistance,
    estimatedDuration: Math.round(
      first * ((paceZones.easy.min + paceZones.easy.max) / 2) +
      middle * paceZones.marathon +
      final * paceZones.threshold
    ),
    weeklyMileageContribution: actualTotalDistance,
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
  createThresholdLadder,
  createVO2Intervals,
  createMixedVO2SpeedWorkout,
  createMarathonPaceRun,
  createMarathonThresholdAlternation,
  createLongRun,
  createProgressionRun,
  createStrengthSession,
  createCrossTraining,
  createRestDay,
};
