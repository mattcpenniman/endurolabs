/** Prescription fidelity and uncertain-write behavior for single-run Garmin export. */
import { describe, expect, it } from "vitest";
import { mapGarminWorkout, selectPlannedRun, workoutCalendarDate } from "../lib/garmin/workout-export";
import { publishGarminWorkout } from "../lib/garmin/workout-publisher";
import type { ExportCheckpoint, ExportJournal, WorkoutTransport } from "../lib/garmin/workout-publisher";
import type { Workout, DailyPlan } from "../lib/training/models";

const workout: Workout = {
  id: "mp-16", title: "8 mi M + 2 mi T Alternation", type: "marathon_pace",
  description: "Alternate marathon and threshold", totalDistance: 14,
  estimatedDuration: 100, weeklyMileageContribution: 14, intensityCategory: "hard",
  segments: [
    { type: "easy", distance: 2, pace: 8.106, description: "Warm-up" },
    { type: "marathon_pace", distance: 4.75, pace: 6.87, description: "M1" },
    { type: "threshold", distance: 1, pace: 6.46, description: "T1" },
    { type: "marathon_pace", distance: 3.25, pace: 6.87, description: "M2" },
    { type: "threshold", distance: 1, pace: 6.46, description: "T2" },
    { type: "easy", distance: 2, pace: 8.106, description: "Cool-down" },
  ],
};
const options = { name: "EL test", marker: "EnduroLab export test" };

describe("Garmin workout mapping", () => {
  it("keeps all six Feb 16 steps, 14 miles and exact prescribed pace anchors", () => {
    const mapped = mapGarminWorkout(workout, options);
    const steps = mapped.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(6);
    expect(steps.reduce((sum, item) => sum + item.endConditionValue, 0)).toBeCloseTo(14 * 1609.344);
    expect(steps[1].endConditionValue).toBeCloseTo(4.75 * 1609.344);
    expect(steps[1].targetValueOne).toBeCloseTo(1609.344 / (6.87 * 60));
    expect(steps[2].targetValueOne).toBeGreaterThan(steps[1].targetValueOne!);
    expect(steps[0].stepType.stepTypeKey).toBe("warmup");
    expect(steps[5].stepType.stepTypeKey).toBe("cooldown");
  });
  it("interleaves only two recoveries for three reps, not the aggregate recovery twice", () => {
    const mapped = mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", distance: 1, pace: 6.5, repetitions: 3, restBetween: 120, description: "3 x 1 mile" },
      { type: "recovery", distance: 0.5, pace: 8, description: "Recoveries — 2 x 2 min" },
    ] }, options);
    const steps = mapped.workoutSegments[0].workoutSteps;
    expect(steps.map((item) => item.endCondition.conditionTypeKey)).toEqual(["distance", "time", "distance", "time", "distance"]);
    expect(steps.filter((item) => item.stepType.stepTypeKey === "recovery").map((item) => item.endConditionValue)).toEqual([120, 120]);
  });
  it("preserves timed work and explicit power only when selected", () => {
    const mapped = mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", duration: 8, power: 330, description: "8 min at 330 W" },
    ] }, { ...options, target: "power" });
    const step = mapped.workoutSegments[0].workoutSteps[0];
    expect(step.endConditionValue).toBe(480);
    expect(step.targetType.workoutTargetTypeKey).toBe("power.zone");
    expect(step.targetValueOne).toBe(330);
    expect(() => mapGarminWorkout(workout, { ...options, target: "power" })).toThrow("no power");
  });
  it("rejects ambiguous termination/recovery, invalid values and non-running workouts", () => {
    for (const segment of [
      { type: "easy" as const, distance: -1, description: "bad" },
      { type: "easy" as const, distance: 1, duration: 5, description: "ambiguous" },
      { type: "easy" as const, distance: 1, pace: NaN, description: "bad" },
      { type: "easy" as const, distance: 1, repetitions: 1.5, description: "bad" },
    ]) expect(() => mapGarminWorkout({ ...workout, segments: [segment] }, options)).toThrow();
    expect(() => mapGarminWorkout({ ...workout, type: "rest" }, options)).toThrow();
    expect(() => mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", distance: 1, repetitions: 3, restBetween: 120, description: "reps" },
      { type: "recovery", distance: 1, pace: 8, description: "independent recovery" },
    ] }, options)).toThrow("Ambiguous");
  });
  it("uses calendar dates and selects doubles explicitly", () => {
    expect(workoutCalendarDate("2027-02-16T00:00:00.000Z")).toBe("2027-02-16");
    expect(() => workoutCalendarDate("2027-02-30")).toThrow();
    const secondary = { ...workout, id: "easy-secondary", type: "easy" as const };
    const day = { workout, secondaryWorkout: secondary, isRestDay: false } as DailyPlan;
    expect(selectPlannedRun(day)).toBe(workout);
    expect(selectPlannedRun(day, true)).toBe(secondary);
    expect(() => selectPlannedRun({ ...day, isRestDay: true })).toThrow();
  });
});

function fixture(initial: ExportCheckpoint | null = null): {
  transport: WorkoutTransport; journal: ExportJournal; posts: string[];
  state: { checkpoint: ExportCheckpoint | null; created: boolean; scheduled: boolean; failCreate: boolean; failSchedule: boolean; mismatch: boolean };
} {
  const payload = mapGarminWorkout(workout, options);
  const state = { checkpoint: initial, created: Boolean(initial?.workoutId), scheduled: false, failCreate: false, failSchedule: false, mismatch: false };
  const posts: string[] = [];
  return {
    state, posts,
    journal: { read: async () => state.checkpoint, save: async (value) => { state.checkpoint = value; } },
    transport: {
      async get<T>(url: string): Promise<T> {
        if (url.includes("workouts?")) return (state.created ? [{ workoutId: 42, workoutName: payload.workoutName }] : []) as T;
        if (url.includes("workout/42")) return { ...payload, workoutId: 42, workoutName: state.mismatch ? "edited" : payload.workoutName } as T;
        if (url.includes("workoutScheduleByPeriod")) return (state.scheduled ? [{ workoutScheduleId: 101, workout: { workoutId: 42 }, calendarDate: "2027-02-16" }] : []) as T;
        throw new Error(`Unexpected GET ${url}`);
      },
      async post<T>(url: string): Promise<T> {
        posts.push(url);
        if (url.endsWith("/workout")) {
          if (state.failCreate) throw new Error("Timed out after dispatch");
          state.created = true;
          return { workoutId: 42 } as T;
        }
        if (url.includes("schedule/42")) {
          if (state.failSchedule) throw new Error("Uncertain schedule outcome");
          state.scheduled = true;
          return {} as T;
        }
        throw new Error(`Unexpected POST ${url}`);
      },
    },
  };
}

describe("Garmin publisher", () => {
  const payload = mapGarminWorkout(workout, options);
  it("verifies upload and date then reruns without creating or scheduling duplicates", async () => {
    const f = fixture();
    expect(await publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).toMatchObject({ workoutId: 42, verified: true });
    expect(f.posts).toHaveLength(2);
    expect(await publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).toMatchObject({ reused: true });
    expect(f.posts).toHaveLength(2);
  });
  it("checkpoints create before dispatch and refuses an unresolved retry", async () => {
    const f = fixture(); f.state.failCreate = true;
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).rejects.toThrow();
    expect(f.state.checkpoint?.phase).toBe("creating");
    f.state.failCreate = false;
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).rejects.toThrow("do not retry");
    expect(f.posts).toHaveLength(1);
  });
  it("reconciles a create timeout only through positive remote readback", async () => {
    const f = fixture({ fingerprint: "sha", phase: "creating" }); f.state.created = true;
    await publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha");
    expect(f.posts).toEqual([expect.stringContaining("schedule/42")]);
  });
  it("reconciles the observed nested schedule response without repeating either write", async () => {
    const f = fixture({ fingerprint: "sha", phase: "scheduling", workoutId: 42 });
    f.state.scheduled = true;
    await publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha");
    expect(f.posts).toHaveLength(0);
    expect(f.state.checkpoint?.phase).toBe("scheduled");
  });
  it("does not resubmit an uncertain schedule or silently replace a changed prescription", async () => {
    const f = fixture(); f.state.failSchedule = true;
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).rejects.toThrow();
    expect(f.state.checkpoint?.phase).toBe("scheduling");
    f.state.failSchedule = false;
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).rejects.toThrow("unresolved");
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "changed")).rejects.toThrow("Prescription changed");
    expect(f.posts).toHaveLength(2);
  });
  it("stops before scheduling when Garmin readback differs", async () => {
    const f = fixture(); f.state.mismatch = true;
    await expect(publishGarminWorkout(f.transport, f.journal, payload, "2027-02-16", "sha")).rejects.toThrow("mismatch");
    expect(f.posts).toHaveLength(1);
  });
});
