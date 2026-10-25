/** Prescription fidelity and uncertain-write behavior for single-run Garmin export. */
import { describe, expect, it } from "vitest";
import { mapGarminWorkout, selectPlannedRun, workoutCalendarDate } from "../lib/garmin/workout-export";
import { publishGarminWorkout, verifyRemoteWorkout } from "../lib/garmin/workout-publisher";
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
  const strideRun: Workout = {
    ...workout, type: "easy", title: "5 mi Easy + Strides", totalDistance: 5,
    estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: "easy",
    description: "Easy aerobic running followed by 6–8 relaxed 20–30 second strides with full recovery.",
    segments: [{ type: "easy", distance: 5, pace: 8, power: 250,
      description: "Easy run — 5 miles, then 6–8 relaxed 20–30 second strides" }],
  };
  it.each(["pace", "power"] as const)("exports saved text-only strides after unchanged easy running (%s)", (target) => {
    const original = structuredClone(strideRun);
    const payload = mapGarminWorkout(strideRun, { ...options, target, cadence: true });
    const steps = payload.workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(12); // easy + 6 strides + 5 recoveries
    expect(steps[0]).toEqual(mapGarminWorkout(strideRun, { ...options, target, cadence: true, strides: false }).workoutSegments[0].workoutSteps[0]);
    expect(steps[0].endConditionValue).toBe(5 * 1609.344);
    const strides = steps.slice(1).filter((item) => item.stepType.stepTypeKey === "interval");
    const recoveries = steps.filter((item) => item.stepType.stepTypeKey === "recovery");
    expect(strides).toHaveLength(6);
    expect(strides.every((item) => item.endConditionValue === 20 && item.targetType.workoutTargetTypeKey === "no.target" &&
      item.targetValueOne === undefined && item.secondaryTargetValueOne === 180)).toBe(true);
    expect(recoveries).toHaveLength(5);
    expect(recoveries.every((item) => item.endCondition.conditionTypeKey === "lap.button" &&
      item.targetType.workoutTargetTypeKey === "no.target" && item.secondaryTargetType === undefined)).toBe(true);
    expect(steps.map((item) => item.stepOrder)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(payload.estimatedDurationInSecs).toBe(2520); // excludes unknown full-recovery time
    expect(strideRun).toEqual(original);
    expect(() => verifyRemoteWorkout({ ...payload, workoutId: 42 }, payload)).not.toThrow();
    const lapReadback = structuredClone(payload);
    // Garmin may omit a numeric end value for an athlete-controlled Lap step.
    Object.assign(lapReadback.workoutSegments[0].workoutSteps[2], { endConditionValue: null });
    expect(() => verifyRemoteWorkout({ ...lapReadback, workoutId: 42 }, payload)).not.toThrow();
    const changed = structuredClone(payload);
    changed.workoutSegments[0].workoutSteps[1].endConditionValue = 30;
    expect(() => verifyRemoteWorkout({ ...changed, workoutId: 42 }, payload)).toThrow("prescription mismatch");
    changed.workoutSegments[0].workoutSteps[1].endConditionValue = 20;
    changed.workoutSegments[0].workoutSteps[2].endCondition = { conditionTypeId: 2, conditionTypeKey: "time" };
    expect(() => verifyRemoteWorkout({ ...changed, workoutId: 42 }, payload)).toThrow("prescription mismatch");
  });
  it("exports four race-week strides and gives overall base instructions precedence over stale shakeout text", () => {
    const shakeout = { ...strideRun, description: "Short, relaxed race-week run finished with a few strides.",
      segments: [{ ...strideRun.segments[0], description: "Easy shakeout — 5 miles relaxed, then 4-6 × 20s strides" }] };
    expect(mapGarminWorkout(shakeout, options).workoutSegments[0].workoutSteps).toHaveLength(8);
    expect(mapGarminWorkout({ ...shakeout, description: strideRun.description }, options).workoutSegments[0].workoutSteps).toHaveLength(12);
  });
  it("also adds strides to an easy block resized to a time termination", () => {
    const timed = { ...strideRun, segments: [{ ...strideRun.segments[0], distance: undefined, duration: 40 }] };
    const steps = mapGarminWorkout(timed, options).workoutSegments[0].workoutSteps;
    expect(steps).toHaveLength(12);
    expect(steps[0].endCondition).toEqual({ conditionTypeId: 2, conditionTypeKey: "time" });
    expect(steps[0].endConditionValue).toBe(2400);
  });
  it("does not duplicate structured strides or silently drop unrecognized text-only prescriptions", () => {
    const structured = { ...strideRun, segments: [strideRun.segments[0],
      { type: "easy" as const, duration: 1 / 3, repetitions: 6, restBetween: 60, description: "Relaxed strides" }] };
    expect(mapGarminWorkout(structured, options).workoutSegments[0].workoutSteps).toHaveLength(12);
    expect(() => mapGarminWorkout({ ...strideRun, description: "Finish with strides",
      segments: [{ ...strideRun.segments[0], description: "Easy then strides" }] }, options)).toThrow("Strides need");
    expect(() => mapGarminWorkout({ ...strideRun, description: "25 x 20s strides" }, options)).toThrow("Invalid stride");
  });
  it.each(["pace", "power"] as const)("adds secondary cadence without changing %s targets or repeat recoveries", (target) => {
    const run = { ...workout, segments: [
      { type: "threshold" as const, duration: 5, pace: 6.5, power: 330, repetitions: 3, restBetween: 60, description: "Cruise intervals" },
      { type: "recovery" as const, duration: 2, pace: 8, power: 250, description: "Recoveries" },
    ] };
    const original = mapGarminWorkout(run, { ...options, target });
    const mapped = mapGarminWorkout(run, { ...options, target, cadence: true });
    expect(mapped.workoutSegments[0].workoutSteps).toHaveLength(5);
    mapped.workoutSegments[0].workoutSteps.forEach((item, index) => {
      const { secondaryTargetType, secondaryTargetValueOne, secondaryTargetValueTwo, ...primary } = item;
      expect(primary).toEqual(original.workoutSegments[0].workoutSteps[index]);
      expect(secondaryTargetType).toEqual({ workoutTargetTypeId: 3, workoutTargetTypeKey: "cadence" });
      expect([secondaryTargetValueOne, secondaryTargetValueTwo]).toEqual([180, 190]);
    });
  });
  it("requires cadence type and both numeric bounds in Garmin readback", () => {
    const payload = mapGarminWorkout(workout, { ...options, cadence: true });
    const remote = { ...payload, workoutId: 42 };
    expect(() => verifyRemoteWorkout(remote, payload)).not.toThrow();
    for (const mutation of [
      { secondaryTargetType: undefined },
      { secondaryTargetValueOne: undefined },
      { secondaryTargetValueTwo: 200 },
      { secondaryTargetValueOne: NaN },
    ]) {
      const changed = structuredClone(remote);
      Object.assign(changed.workoutSegments[0].workoutSteps[0], mutation);
      expect(() => verifyRemoteWorkout(changed, payload)).toThrow("prescription mismatch");
    }
    expect(() => verifyRemoteWorkout(remote, mapGarminWorkout(workout, options))).toThrow("prescription mismatch");
  });
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
