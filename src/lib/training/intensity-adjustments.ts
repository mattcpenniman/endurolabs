// ============================================================
// EnduroLab — Weekly Intensity Adjustments
// ============================================================
// Pure helpers for editing a generated week's workout segments
// while preserving the week's planned mileage.
// ============================================================

import {
  PaceZones,
  PowerZones,
  WeeklyPlan,
  Workout,
  WorkoutSegment,
  WorkoutType,
} from "./models";

export type IntensityTargetKey = "marathon" | "threshold" | "vo2";

const INTENSITY_TO_WORKOUT_TYPE: Record<IntensityTargetKey, WorkoutType> = {
  marathon: "marathon_pace",
  threshold: "threshold",
  vo2: "vo2",
};

function roundMiles(distance: number): number {
  return Math.round(distance * 4) / 4;
}

function segmentDistance(segment: WorkoutSegment): number {
  return (segment.distance ?? 0) * (segment.repetitions ?? 1);
}

function cloneWorkout(workout: Workout | null | undefined): Workout | null | undefined {
  if (!workout) return workout;
  return {
    ...workout,
    segments: workout.segments.map((segment) => ({ ...segment })),
  };
}

function forEachWorkout(week: WeeklyPlan, callback: (workout: Workout) => void): void {
  week.days.forEach((day) => {
    if (day.workout) callback(day.workout);
    if (day.secondaryWorkout) callback(day.secondaryWorkout);
  });
}

function getSegmentDescription(type: WorkoutType, distance: number, workoutType: WorkoutType): string {
  if (type === "marathon_pace") return `Adjusted block — ${distance} miles at marathon pace`;
  if (type === "threshold") return `Adjusted block — ${distance} miles at threshold pace`;
  if (type === "vo2") return `Adjusted block — ${distance} miles at VO2 pace`;
  if (workoutType === "long") return `Long run — ${distance} miles at easy/conversational pace`;
  if (type === "recovery") return `Recovery jog — ${distance} miles, very relaxed effort`;
  return `Easy run — ${distance} miles at conversational pace`;
}

function getZoneSegment(
  key: IntensityTargetKey,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): WorkoutSegment {
  if (key === "marathon") {
    return {
      description: getSegmentDescription("marathon_pace", distance, "marathon_pace"),
      distance,
      pace: paceZones.marathon,
      power: powerZones?.marathon,
      effort: paceZones.marathonEffort,
      type: "marathon_pace",
    };
  }

  if (key === "threshold") {
    return {
      description: getSegmentDescription("threshold", distance, "threshold"),
      distance,
      pace: paceZones.threshold,
      power: powerZones?.threshold,
      effort: paceZones.thresholdEffort,
      type: "threshold",
    };
  }

  return {
    description: getSegmentDescription("vo2", distance, "vo2"),
    distance,
    pace: paceZones.vo2,
    power: powerZones?.vo2,
    effort: paceZones.vo2Effort,
    type: "vo2",
  };
}

function getEasySegment(distance: number, workoutType: WorkoutType, paceZones: PaceZones, powerZones?: PowerZones): WorkoutSegment {
  const type: WorkoutType = workoutType === "long" ? "long" : "easy";
  return {
    description: getSegmentDescription(type, distance, workoutType),
    distance,
    pace: (paceZones.easy.min + paceZones.easy.max) / 2,
    power: powerZones ? (powerZones.easy.min + powerZones.easy.max) / 2 : undefined,
    effort: paceZones.easyEffort,
    type,
  };
}

function addSegmentDistance(
  workout: Workout,
  segmentType: WorkoutType,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): void {
  const roundedDistance = roundMiles(distance);
  if (roundedDistance <= 0) return;

  const existing = workout.segments.find((segment) => segment.type === segmentType && !segment.repetitions);
  if (existing) {
    existing.distance = roundMiles((existing.distance ?? 0) + roundedDistance);
    existing.description = getSegmentDescription(segmentType, existing.distance, workout.type);
    return;
  }

  if (segmentType === "easy" || segmentType === "long") {
    workout.segments.push(getEasySegment(roundedDistance, workout.type, paceZones, powerZones));
    return;
  }

  if (segmentType === "marathon_pace") {
    workout.segments.push(getZoneSegment("marathon", roundedDistance, paceZones, powerZones));
  } else if (segmentType === "threshold") {
    workout.segments.push(getZoneSegment("threshold", roundedDistance, paceZones, powerZones));
  } else if (segmentType === "vo2") {
    workout.segments.push(getZoneSegment("vo2", roundedDistance, paceZones, powerZones));
  }
}

function removeDistanceFromSegments(workout: Workout, segmentType: WorkoutType, distance: number): number {
  let remaining = distance;
  let removed = 0;

  workout.segments = workout.segments.flatMap((segment) => {
    if (segment.type !== segmentType || remaining <= 0) return [segment];

    const currentDistance = segmentDistance(segment);
    const reduction = Math.min(currentDistance, remaining);
    const nextDistance = roundMiles(currentDistance - reduction);
    remaining = roundMiles(remaining - reduction);
    removed = roundMiles(removed + reduction);

    if (nextDistance <= 0) return [];

    return [{
      ...segment,
      distance: nextDistance,
      repetitions: undefined,
      restBetween: undefined,
      description: getSegmentDescription(segmentType, nextDistance, workout.type),
    }];
  });

  return removed;
}

function getWorkoutsByPriority(week: WeeklyPlan, key: IntensityTargetKey): Workout[] {
  const workouts: Workout[] = [];
  forEachWorkout(week, (workout) => workouts.push(workout));

  if (key === "marathon") {
    return [
      ...workouts.filter((workout) => workout.type === "long"),
      ...workouts.filter((workout) => workout.type !== "long" && workout.segments.some((segment) => segment.type === "marathon_pace")),
      ...workouts.filter((workout) => workout.type !== "long" && !workout.segments.some((segment) => segment.type === "marathon_pace")),
    ];
  }

  const targetType = INTENSITY_TO_WORKOUT_TYPE[key];
  return [
    ...workouts.filter((workout) => workout.segments.some((segment) => segment.type === targetType)),
    ...workouts.filter((workout) => workout.type !== "long" && !workout.segments.some((segment) => segment.type === targetType)),
    ...workouts.filter((workout) => workout.type === "long" && !workout.segments.some((segment) => segment.type === targetType)),
  ];
}

function convertEasyToIntensity(
  week: WeeklyPlan,
  key: IntensityTargetKey,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): number {
  const targetType = INTENSITY_TO_WORKOUT_TYPE[key];
  let remaining = distance;
  let converted = 0;

  for (const workout of getWorkoutsByPriority(week, key)) {
    if (remaining <= 0) break;

    for (const easyType of ["easy", "long", "recovery"] as WorkoutType[]) {
      if (remaining <= 0) break;
      const removed = removeDistanceFromSegments(workout, easyType, remaining);
      if (removed > 0) {
        addSegmentDistance(workout, targetType, removed, paceZones, powerZones);
        remaining = roundMiles(remaining - removed);
        converted = roundMiles(converted + removed);
      }
    }
  }

  return converted;
}

function convertIntensityToEasy(
  week: WeeklyPlan,
  key: IntensityTargetKey,
  distance: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): number {
  const targetType = INTENSITY_TO_WORKOUT_TYPE[key];
  let remaining = distance;
  let converted = 0;

  for (const workout of getWorkoutsByPriority(week, key)) {
    if (remaining <= 0) break;
    const removed = removeDistanceFromSegments(workout, targetType, remaining);
    if (removed > 0) {
      addSegmentDistance(workout, workout.type === "long" ? "long" : "easy", removed, paceZones, powerZones);
      remaining = roundMiles(remaining - removed);
      converted = roundMiles(converted + removed);
    }
  }

  return converted;
}

function updateWorkoutMetadata(workout: Workout, paceZones: PaceZones): void {
  const totalDistance = roundMiles(workout.segments.reduce((sum, segment) => sum + segmentDistance(segment), 0));
  workout.totalDistance = totalDistance;
  workout.weeklyMileageContribution = totalDistance;
  workout.estimatedDuration = Math.round(workout.segments.reduce((sum, segment) => {
    if (segment.distance && segment.pace) return sum + segmentDistance(segment) * segment.pace;
    if (segment.duration) return sum + segment.duration;
    return sum;
  }, 0));

  const marathonMiles = workoutDistanceByType(workout, "marathon_pace");
  const thresholdMiles = workoutDistanceByType(workout, "threshold");
  const vo2Miles = workoutDistanceByType(workout, "vo2");

  if (workout.type === "long") {
    workout.title = marathonMiles > 0 ? `${totalDistance} mi Long Run w/ MP Finish` : `${totalDistance} mi Long Run`;
    return;
  }

  if (vo2Miles > 0) {
    workout.title = `${vo2Miles} mi VO2 Work`;
    workout.intensityCategory = "hard";
    return;
  }

  if (thresholdMiles > 0) {
    workout.title = `${thresholdMiles} mi Threshold Work`;
    workout.intensityCategory = "hard";
    return;
  }

  if (marathonMiles > 0) {
    workout.title = `${marathonMiles} mi @ Marathon Pace`;
    workout.intensityCategory = "moderate";
    return;
  }

  if (totalDistance > 0) {
    workout.title = `${totalDistance} mi Easy Run`;
    workout.description = "Steady, conversational-paced run.";
    workout.intensityCategory = "easy";
    workout.segments.forEach((segment) => {
      if ((segment.type === "easy" || segment.type === "long") && segment.pace === undefined) {
        segment.pace = (paceZones.easy.min + paceZones.easy.max) / 2;
      }
    });
  }
}

function workoutDistanceByType(workout: Workout | null | undefined, type: WorkoutType): number {
  if (!workout) return 0;
  return roundMiles(workout.segments.reduce((sum, segment) => {
    if (segment.type !== type) return sum;
    return sum + segmentDistance(segment);
  }, 0));
}

export function calculateWeekIntensityDistribution(week: WeeklyPlan): WeeklyPlan["intensityDistribution"] {
  const distribution = { easy: 0, threshold: 0, marathon: 0, vo2: 0 };

  forEachWorkout(week, (workout) => {
    workout.segments.forEach((segment) => {
      const distance = segmentDistance(segment);
      if (segment.type === "threshold") distribution.threshold += distance;
      if (segment.type === "marathon_pace") distribution.marathon += distance;
      if (segment.type === "vo2") distribution.vo2 += distance;
      if (segment.type === "easy" || segment.type === "long" || segment.type === "recovery") {
        distribution.easy += distance;
      }
    });
  });

  return {
    easy: roundMiles(distribution.easy),
    threshold: roundMiles(distribution.threshold),
    marathon: roundMiles(distribution.marathon),
    vo2: roundMiles(distribution.vo2),
  };
}

export function adjustWeeklyIntensityPercent(
  week: WeeklyPlan,
  key: IntensityTargetKey,
  percent: number,
  paceZones: PaceZones,
  powerZones?: PowerZones
): WeeklyPlan {
  const nextWeek: WeeklyPlan = {
    ...week,
    days: week.days.map((day) => ({
      ...day,
      workout: cloneWorkout(day.workout) ?? null,
      secondaryWorkout: cloneWorkout(day.secondaryWorkout) ?? null,
    })),
    intensityDistribution: { ...week.intensityDistribution },
    intensityTargetDistribution: week.intensityTargetDistribution
      ? { ...week.intensityTargetDistribution }
      : undefined,
  };
  const targetMiles = roundMiles((nextWeek.totalMileage * percent) / 100);
  const currentDistribution = calculateWeekIntensityDistribution(nextWeek);
  const currentMiles = currentDistribution[key === "marathon" ? "marathon" : key];
  const delta = roundMiles(targetMiles - currentMiles);

  if (delta > 0) {
    convertEasyToIntensity(nextWeek, key, delta, paceZones, powerZones);
  } else if (delta < 0) {
    convertIntensityToEasy(nextWeek, key, Math.abs(delta), paceZones, powerZones);
  }

  nextWeek.days.forEach((day) => {
    if (day.workout) {
      updateWorkoutMetadata(day.workout, paceZones);
      day.plannedMileage = day.workout.weeklyMileageContribution + (day.secondaryWorkout?.weeklyMileageContribution ?? 0);
    }
    if (day.secondaryWorkout) {
      updateWorkoutMetadata(day.secondaryWorkout, paceZones);
      day.plannedMileage = (day.workout?.weeklyMileageContribution ?? 0) + day.secondaryWorkout.weeklyMileageContribution;
    }
  });

  nextWeek.intensityDistribution = calculateWeekIntensityDistribution(nextWeek);
  nextWeek.intensityTargetDistribution = {
    easy: roundMiles(nextWeek.totalMileage - targetMiles - (nextWeek.intensityTargetDistribution?.threshold ?? 0) - (nextWeek.intensityTargetDistribution?.marathon ?? 0) - (nextWeek.intensityTargetDistribution?.vo2 ?? 0)),
    threshold: nextWeek.intensityTargetDistribution?.threshold ?? 0,
    marathon: nextWeek.intensityTargetDistribution?.marathon ?? 0,
    vo2: nextWeek.intensityTargetDistribution?.vo2 ?? 0,
    [key === "marathon" ? "marathon" : key]: targetMiles,
  };
  nextWeek.intensityTargetDistribution.easy = Math.max(
    0,
    roundMiles(
      nextWeek.totalMileage -
      nextWeek.intensityTargetDistribution.threshold -
      nextWeek.intensityTargetDistribution.marathon -
      nextWeek.intensityTargetDistribution.vo2
    )
  );

  return nextWeek;
}
