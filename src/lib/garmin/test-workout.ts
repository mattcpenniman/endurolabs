/** Standalone Garmin test prescription, using an owned plan's pace anchors without editing it. */
import type { PaceZones, Workout, WorkoutSegment } from "../training/models";

export function buildGarminTestWorkout(zones: PaceZones, repetitions: number): Workout {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 24) {
    throw new Error("--test-intervals must be an integer from 1 to 24 (50-step export limit)");
  }
  const easy = (zones.easy.min + zones.easy.max) / 2;
  if (![zones.easy.min, zones.easy.max, zones.marathon].every((pace) => Number.isFinite(pace) && pace > 0)) {
    throw new Error("Test workout requires positive finite easy and marathon pace anchors");
  }
  const intervalMiles = 100 / 1609.344;
  const segments: WorkoutSegment[] = [{
    type: "easy", description: "1 mile easy warm-up", distance: 1, pace: easy,
  }];
  for (let rep = 1; rep <= repetitions; rep++) {
    segments.push(
      { type: "marathon_pace", description: `100 m marathon pace (${rep}/${repetitions})`, distance: intervalMiles, pace: zones.marathon },
      { type: "recovery", description: `100 m easy off (${rep}/${repetitions})`, distance: intervalMiles, pace: easy },
    );
  }
  const totalDistance = 1 + repetitions * 2 * intervalMiles;
  return {
    id: "test-100m-v1", type: "marathon_pace",
    title: `Test: 1 mi easy + ${repetitions} x 100 m MP / 100 m easy`,
    description: "Standalone test. Easy targets use the midpoint of the plan's easy range. Includes the final 100 m easy recovery; no additional cool-down.",
    segments, totalDistance, weeklyMileageContribution: totalDistance,
    estimatedDuration: easy + repetitions * intervalMiles * (zones.marathon + easy),
    intensityCategory: "moderate",
  };
}
