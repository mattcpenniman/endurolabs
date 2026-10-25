/** Executable distance and target fidelity for standalone Garmin test workouts. */
import { describe, expect, it } from "vitest";
import { buildGarminTestWorkout } from "../lib/garmin/test-workout";
import { mapGarminWorkout } from "../lib/garmin/workout-export";
import type { PaceZones } from "../lib/training/models";

const zones = { easy: { min: 9, max: 8 }, marathon: 7 } as PaceZones;

describe("standalone test workout", () => {
  it("exports a mile warm-up and five complete on/off pairs with exact pace targets", () => {
    const original = JSON.stringify(zones);
    const workout = buildGarminTestWorkout(zones, 5);
    const payload = mapGarminWorkout(workout, { name: "test", marker: "test" });
    const steps = payload.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(11);
    expect(steps[0].endConditionValue).toBe(1609.344);
    expect(steps[0].stepType.stepTypeKey).toBe("warmup");
    for (let index = 1; index < steps.length; index++) {
      expect(steps[index].endCondition.conditionTypeKey).toBe("distance");
      expect(steps[index].endConditionValue).toBeCloseTo(100, 10);
      expect(steps[index].stepType.stepTypeKey).toBe(index % 2 ? "interval" : "recovery");
      expect(steps[index].targetValueOne).toBeCloseTo(1609.344 / ((index % 2 ? 7 : 8.5) * 60));
      expect(steps[index].targetValueTwo).toBe(steps[index].targetValueOne);
    }
    expect(workout.totalDistance * 1609.344).toBeCloseTo(2609.344);
    expect(JSON.stringify(zones)).toBe(original);
  });

  it.each([0, -1, 1.5, 25, NaN, Infinity])("rejects invalid counts %s", (count) => {
    expect(() => buildGarminTestWorkout(zones, count)).toThrow("integer from 1 to 24");
  });

  it("rejects invalid pace anchors and stays within the mapper step cap", () => {
    expect(() => buildGarminTestWorkout({ ...zones, marathon: NaN }, 5)).toThrow("pace anchors");
    expect(mapGarminWorkout(buildGarminTestWorkout(zones, 24), { name: "test", marker: "test" })
      .workoutSegments[0].workoutSteps).toHaveLength(49);
  });
});
