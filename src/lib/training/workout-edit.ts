/** Resize the executable prescription alongside the workout's displayed totals. */
import type { Workout } from "./models";

export function resizeWorkout(workout: Workout, distance: number, duration: number): Workout {
  if (distance === workout.totalDistance && duration === workout.estimatedDuration) return workout;
  if (["rest", "strength", "cross_training"].includes(workout.type)) {
    if (![distance, duration].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Distance and duration cannot be negative.");
    return { ...workout, totalDistance: distance, estimatedDuration: duration };
  }
  if (![distance, duration].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Distance and duration must be positive numbers.");
  }
  const distanceChanged = distance !== workout.totalDistance;
  const durationChanged = duration !== workout.estimatedDuration;
  if (distanceChanged && durationChanged) throw new Error("Change either distance or duration at a time; the other total is adjusted automatically.");
  const ratio = distanceChanged ? distance / workout.totalDistance : duration / workout.estimatedDuration;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("This workout cannot be resized.");
  // Duration edits turn distance-terminated steps into timed steps. Preserve
  // pace/power targets and repeat counts, scaling the whole session uniformly.
  let timeScale = ratio;
  if (durationChanged) {
    const minutes = workout.segments.reduce((sum, segment, index) => {
      const time = segment.duration ?? (segment.distance !== undefined && segment.pace ? segment.distance * segment.pace : NaN);
      const recovery = segment.restBetween && (segment.repetitions ?? 1) > 1 &&
        workout.segments[index + 1]?.type !== "recovery"
        ? ((segment.repetitions ?? 1) - 1) * segment.restBetween / 60 : 0;
      return sum + time * (segment.repetitions ?? 1) + recovery;
    }, 0);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Timed resizing requires a pace or duration for every segment.");
    timeScale = duration / minutes;
  }
  return {
    ...workout,
    totalDistance: distanceChanged ? distance : workout.totalDistance * ratio,
    estimatedDuration: durationChanged ? duration : workout.estimatedDuration * ratio,
    weeklyMileageContribution: workout.weeklyMileageContribution * ratio,
    segments: workout.segments.map((segment) => {
      const resized = { ...segment };
      if (durationChanged) {
        resized.duration = (segment.duration ?? segment.distance! * segment.pace!) * timeScale;
        delete resized.distance;
      } else {
        if (segment.distance !== undefined) resized.distance = segment.distance * ratio;
        if (segment.duration !== undefined) resized.duration = segment.duration * ratio;
      }
      if (segment.restBetween !== undefined) resized.restBetween = segment.restBetween * timeScale;
      return resized;
    }),
  };
}
