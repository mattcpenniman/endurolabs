/** Pure mapping of EnduroLab running prescriptions to Garmin Connect workouts. */
import type { DailyPlan, Workout, WorkoutSegment } from "../training/models";

const MILES_TO_METERS = 1609.344;
const RUNNING = { sportTypeId: 1, sportTypeKey: "running", displayOrder: 1 };
const NON_RUNNING = new Set(["rest", "strength", "cross_training"]);

export interface GarminWorkoutStep {
  type: "ExecutableStepDTO";
  stepOrder: number;
  stepType: { stepTypeId: number; stepTypeKey: string };
  endCondition: { conditionTypeId: number; conditionTypeKey: string };
  endConditionValue: number;
  targetType: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  targetValueOne?: number;
  targetValueTwo?: number;
  description: string;
}

export interface GarminWorkoutPayload {
  workoutName: string;
  description: string;
  sportType: typeof RUNNING;
  estimatedDurationInSecs: number;
  workoutSegments: Array<{
    segmentOrder: number;
    sportType: typeof RUNNING;
    workoutSteps: GarminWorkoutStep[];
  }>;
}

export function selectPlannedRun(day: DailyPlan, secondary = false): Workout {
  const workout = secondary ? day.secondaryWorkout : day.workout;
  if (day.isRestDay || !workout || NON_RUNNING.has(workout.type)) {
    throw new Error("Selected entry is not a planned running workout");
  }
  return workout;
}

function positive(value: number | undefined, field: string): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be finite and positive`);
  }
  return value;
}

/** Dates stay as plan calendar dates, not host-local or UTC-shifted timestamps. */
export function workoutCalendarDate(value: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Workout date must be a valid YYYY-MM-DD calendar date");
  }
  return date;
}

function step(segment: WorkoutSegment, order: number, target: "pace" | "power"): GarminWorkoutStep {
  if (NON_RUNNING.has(segment.type)) throw new Error("Non-running segment cannot be exported");
  if (segment.distance !== undefined && segment.duration !== undefined) {
    throw new Error("Segment has both distance and duration; choose a termination rule first");
  }
  const distance = segment.distance !== undefined;
  const value = distance
    ? positive(segment.distance, "Distance") * MILES_TO_METERS
    : positive(segment.duration, "Duration") * 60;
  const key = /warm[- ]?up/i.test(segment.description) ? "warmup"
    : /cool[- ]?down/i.test(segment.description) ? "cooldown"
    : segment.type === "recovery" ? "recovery" : "interval";
  const result: GarminWorkoutStep = {
    type: "ExecutableStepDTO", stepOrder: order,
    stepType: { stepTypeId: { warmup: 1, cooldown: 2, interval: 3, recovery: 4 }[key], stepTypeKey: key },
    endCondition: { conditionTypeId: distance ? 3 : 2, conditionTypeKey: distance ? "distance" : "time" },
    endConditionValue: value,
    targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
    description: `${segment.description}${segment.effort ? ` — ${segment.effort}` : ""}`,
  };
  const anchor = target === "power" ? segment.power : segment.pace;
  if (anchor !== undefined) {
    positive(anchor, target);
    result.targetType = {
      workoutTargetTypeId: target === "power" ? 2 : 6,
      workoutTargetTypeKey: target === "power" ? "power.zone" : "pace.zone",
    };
    result.targetValueOne = target === "power" ? anchor : MILES_TO_METERS / (anchor * 60);
    result.targetValueTwo = result.targetValueOne;
  } else if (target === "power" || segment.power !== undefined) {
    throw new Error(`Segment has no ${target} prescription; select a supported target explicitly`);
  }
  return result;
}

/** Expand repeats with between-rep recovery only, consuming known aggregate recovery rows. */
export function mapGarminWorkout(
  workout: Workout,
  options: { name: string; marker: string; target?: "pace" | "power" },
): GarminWorkoutPayload {
  if (NON_RUNNING.has(workout.type) || !workout.segments.length) throw new Error("Not a running workout");
  const target = options.target ?? "pace";
  const steps: GarminWorkoutStep[] = [];
  for (let index = 0; index < workout.segments.length; index++) {
    const segment = workout.segments[index];
    const repetitions = segment.repetitions ?? 1;
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 50) {
      throw new Error("Repetitions must be between 1 and 50");
    }
    if (segment.restBetween !== undefined) positive(segment.restBetween, "Recovery seconds");
    let recovery: WorkoutSegment | undefined;
    if (repetitions > 1 && segment.restBetween) {
      const next = workout.segments[index + 1];
      if (next?.type === "recovery") {
        // These are aggregate distance rows in EnduroLab's interval builders.
        // Require both the naming convention and a numerically consistent total.
        const expected = (repetitions - 1) * segment.restBetween / 60;
        const aggregateMinutes = next.distance !== undefined && next.pace !== undefined
          ? next.distance * next.pace : next.duration;
        if (!/recoveries/i.test(next.description) || aggregateMinutes === undefined ||
            !Number.isFinite(aggregateMinutes) || Math.abs(aggregateMinutes - expected) > 0.2 ||
            next.repetitions !== undefined || next.restBetween !== undefined) {
          throw new Error("Ambiguous aggregate recovery segment; normalize it before export");
        }
        recovery = next;
        index++;
      }
    }
    for (let rep = 0; rep < repetitions; rep++) {
      steps.push(step({ ...segment, description: repetitions > 1
        ? `${segment.description} (rep ${rep + 1}/${repetitions})` : segment.description }, steps.length + 1, target));
      if (rep < repetitions - 1 && segment.restBetween) {
        steps.push(step({
          type: "recovery", duration: segment.restBetween / 60,
          pace: recovery?.pace, power: recovery?.power,
          description: "Between-rep recovery", effort: recovery?.effort,
        }, steps.length + 1, target));
      }
    }
  }
  if (steps.length > 50) throw new Error("Export exceeds the initial 50-step limit");
  return {
    workoutName: options.name,
    description: `${options.marker}\n${workout.description}`,
    sportType: RUNNING,
    estimatedDurationInSecs: Math.round(positive(workout.estimatedDuration, "Estimated duration") * 60),
    workoutSegments: [{ segmentOrder: 1, sportType: RUNNING, workoutSteps: steps }],
  };
}
