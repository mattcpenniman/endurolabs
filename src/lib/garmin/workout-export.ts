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
  secondaryTargetType?: { workoutTargetTypeId: number; workoutTargetTypeKey: string };
  secondaryTargetValueOne?: number;
  secondaryTargetValueTwo?: number;
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

/** Normalize the generator's legacy text-only strides without editing saved plans.
 * Ranges use their lower bound. Full recovery stays athlete-controlled (Lap),
 * and relaxed strides have no invented pace/power anchor in either export mode.
 */
function textStrideSteps(workout: Workout, firstOrder: number): GarminWorkoutStep[] {
  const descriptions = [workout.description, ...workout.segments.map((segment) => segment.description)];
  const mentionsStrides = [workout.title, ...descriptions].some((text) => /\bstrides\b/i.test(text));
  if (!mentionsStrides) return [];
  // Already executable strides are handled by the ordinary segment/repeat mapper.
  if (workout.segments.some((segment) => segment.duration !== undefined &&
      (workout.segments.length > 1 || (segment.repetitions ?? 1) > 1) &&
      /\bstrides?\b/i.test(segment.description))) return [];
  const prescription = /(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:[×x]\s*|relaxed\s+)(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:s\b|seconds?\b)\s+strides\b/i;
  // Overall description is authoritative for base runs; their original shakeout
  // segment text can carry the shorter race-week prescription in old plans.
  const match = descriptions.map((text) => text.match(prescription)).find((item) => item !== null);
  const segment = workout.segments[0];
  if (!match || workout.segments.length !== 1 || !["easy", "recovery"].includes(segment.type) ||
      (segment.repetitions ?? 1) !== 1 || segment.restBetween !== undefined) {
    throw new Error("Strides need an explicit count and seconds on a simple easy run, or structured timed segments");
  }
  const count = Number(match[1]), seconds = Number(match[3]);
  if (count < 1 || count > 20 || seconds < 1 || seconds > 60 ||
      (match[2] && Number(match[2]) < count) || (match[4] && Number(match[4]) < seconds)) {
    throw new Error("Invalid stride count or duration");
  }
  const steps: GarminWorkoutStep[] = [];
  for (let rep = 1; rep <= count; rep++) {
    steps.push({
      type: "ExecutableStepDTO", stepOrder: firstOrder + steps.length,
      stepType: { stepTypeId: 3, stepTypeKey: "interval" },
      endCondition: { conditionTypeId: 2, conditionTypeKey: "time" }, endConditionValue: seconds,
      targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
      description: `Relaxed stride ${rep}/${count} — ${seconds}s; fast and smooth, not a sprint`,
    });
    if (rep < count) steps.push({
      type: "ExecutableStepDTO", stepOrder: firstOrder + steps.length,
      stepType: { stepTypeId: 4, stepTypeKey: "recovery" },
      endCondition: { conditionTypeId: 1, conditionTypeKey: "lap.button" }, endConditionValue: 0,
      targetType: { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target" },
      description: "Full recovery — walk or jog; press Lap when ready for the next stride",
    });
  }
  return steps;
}

/** Expand repeats with between-rep recovery only, consuming known aggregate recovery rows. */
export function mapGarminWorkout(
  workout: Workout,
  options: { name: string; marker: string; target?: "pace" | "power"; cadence?: boolean; strides?: boolean },
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
  const strides = options.strides === false ? [] : textStrideSteps(workout, steps.length + 1);
  // Cadence remains on running steps, not the athlete-controlled walk/jog recovery.
  if (options.cadence) for (const item of [...steps, ...strides.filter((item) => item.stepType.stepTypeKey !== "recovery")]) {
    item.secondaryTargetType = { workoutTargetTypeId: 3, workoutTargetTypeKey: "cadence" };
    item.secondaryTargetValueOne = 180;
    item.secondaryTargetValueTwo = 190;
  }
  steps.push(...strides);
  if (steps.length > 50) throw new Error("Export exceeds the initial 50-step limit");
  return {
    workoutName: options.name,
    description: `${options.marker}\n${workout.description}`,
    sportType: RUNNING,
    // Open-ended full recovery cannot be included in the duration estimate.
    estimatedDurationInSecs: Math.round(positive(workout.estimatedDuration, "Estimated duration") * 60 +
      strides.filter((item) => item.endCondition.conditionTypeKey === "time").reduce((sum, item) => sum + item.endConditionValue, 0)),
    workoutSegments: [{ segmentOrder: 1, sportType: RUNNING, workoutSteps: steps }],
  };
}
