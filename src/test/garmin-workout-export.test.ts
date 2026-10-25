/** Prescription fidelity and uncertain-write behavior for single-run Garmin export. */
import { describe, expect, it } from "vitest";
import { mapGarminWorkout, selectPlannedRun, workoutCalendarDate } from "../lib/garmin/workout-export";
import { publishGarminWorkout, verifyRemoteWorkout } from "../lib/garmin/workout-publisher";
import type { ExportCheckpoint, ExportJournal, WorkoutTransport } from "../lib/garmin/workout-publisher";
import type { Workout, DailyPlan, PaceZones } from "../lib/training/models";
import { WorkoutLibrary } from "../lib/training/workout-library";
import { resizeWorkout } from "../lib/training/workout-edit";

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
const hrZone = { hrrPercent: { min: 0.6, max: 0.7 }, hrMaxPercent: { min: 0.6, max: 0.7 }, targetBpm: null };
const zones: PaceZones = {
  easy: { min: 8, max: 9 }, marathon: 7, threshold: 6.5, vo2: 6, recovery: 10,
  easyEffort: "Easy", marathonEffort: "Steady", thresholdEffort: "Controlled", vo2Effort: "Hard",
  heartRateZones: { recovery: hrZone, easy: hrZone, marathon: hrZone, threshold: hrZone, vo2: hrZone },
};

describe("Garmin workout mapping", () => {
  it.each([8, 10, 14])("exports interval builders at recovery pace %s, including single-rep sessions", (recoveryPace) => {
    const paceZones = { ...zones, recovery: recoveryPace };
    for (const count of [1, 2, 3]) {
      const runs = [
        WorkoutLibrary.createThresholdIntervals(1, 0, 6, count, 0.5, 45, paceZones),
        WorkoutLibrary.createVO2Intervals(1, 0, count, 0.5, 120, paceZones),
      ];
      for (const run of runs) {
        const original = structuredClone(run);
        const steps = mapGarminWorkout(run, options).workoutSegments[0].workoutSteps;
        const recoveries = steps.filter((item) => item.stepType.stepTypeKey === "recovery");
        expect(recoveries).toHaveLength(count - 1);
        expect(recoveries.every((item) => item.endConditionValue === (run.type === "threshold" ? 45 : 120))).toBe(true);
        expect(steps).toHaveLength(2 * count + 1); // bookends + work + between-rep recovery
        expect(run).toEqual(original);
      }
    }
  });
  it.each([8, 10, 14])("exports ladder floats and both mixed-interval recovery groups at pace %s", (recoveryPace) => {
    const paceZones = { ...zones, recovery: recoveryPace };
    const ladder = WorkoutLibrary.createThresholdLadder(1, 0, 10, 4, paceZones);
    const original = structuredClone(ladder);
    const steps = mapGarminWorkout(ladder, options).workoutSegments[0].workoutSteps;
    expect(steps.filter((item) => item.stepType.stepTypeKey === "recovery")
      .map((item) => [item.endCondition.conditionTypeKey, item.endConditionValue])).toEqual([["time", 120], ["time", 120]]);
    expect(ladder).toEqual(original);
    const mixed = WorkoutLibrary.createMixedVO2SpeedWorkout(1, 0, 4, paceZones);
    const mixedSteps = mapGarminWorkout(mixed, options).workoutSegments[0].workoutSteps;
    const repeated = mixed.segments.filter((segment) => (segment.repetitions ?? 1) > 1);
    expect(mixedSteps.filter((item) => item.stepType.stepTypeKey === "recovery").map((item) => item.endConditionValue))
      .toEqual(repeated.flatMap((segment) => Array.from({ length: segment.repetitions! - 1 }, () => segment.restBetween)));
  });
  it("does not treat nonzero single-rep recovery or contradictory float distance as bookkeeping", () => {
    const single = WorkoutLibrary.createThresholdIntervals(1, 0, 6, 1, 0.5, 60, zones);
    single.segments[2].duration = 1;
    expect(() => mapGarminWorkout(single, options)).toThrow("Ambiguous aggregate recovery");
    const ladder = WorkoutLibrary.createThresholdLadder(1, 0, 10, 4, zones);
    ladder.segments[2].distance = 1;
    expect(() => mapGarminWorkout(ladder, options)).toThrow("both distance and duration");
  });
  it("preserves power targets on timed ladder floats and omits legacy zero aggregate rows", () => {
    const steps = mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", distance: 1, power: 330, description: "Threshold rep" },
      { type: "recovery", distance: 0.25, duration: 2, pace: 10, power: 250,
        description: "Float recovery — 2 min easy jog" },
      { type: "threshold", distance: 1, power: 330, description: "Threshold rep" },
    ] }, { ...options, target: "power" }).workoutSegments[0].workoutSteps;
    expect(steps[1]).toMatchObject({ endConditionValue: 120, targetValueOne: 250,
      endCondition: { conditionTypeKey: "time" }, targetType: { workoutTargetTypeKey: "power.zone" } });
    const single = WorkoutLibrary.createThresholdIntervals(1, 0, 6, 1, 0.5, 60, zones);
    delete single.segments[2].duration;
    expect(mapGarminWorkout(single, options).workoutSegments[0].workoutSteps).toHaveLength(3);
  });
  it("exports ladder floats after distance or duration edits", () => {
    const ladder = WorkoutLibrary.createThresholdLadder(1, 0, 10, 4, zones);
    const distanceEdit = resizeWorkout(ladder, ladder.totalDistance * 1.2, ladder.estimatedDuration);
    const timeEdit = resizeWorkout(ladder, ladder.totalDistance, ladder.estimatedDuration * 1.2);
    for (const run of [distanceEdit, timeEdit]) {
      const steps = mapGarminWorkout(run, options).workoutSegments[0].workoutSteps;
      const floats = run.segments.filter((segment) => segment.type === "recovery");
      expect(steps.filter((item) => item.stepType.stepTypeKey === "recovery").map((item) => item.endConditionValue))
        .toEqual(floats.map((segment) => segment.duration! * 60));
    }
  });
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
  it.each(["pace", "power"] as const)("exports 3×0.5 mi cruise intervals with rounded recovery estimates (%s)", (target) => {
    // Planner rounds 2 min / 10 min/mi = 0.2 mi to 0.25 mi.
    // Older saved plans omit duration; newer ones retain the exact 2 minutes.
    for (const duration of [undefined, 2]) {
      const run: Workout = { ...workout, title: "3×0.5 mi Cruise Intervals", segments: [
        { ...workout.segments[0], power: 250 },
        { type: "threshold", distance: 0.5, pace: 6.5, power: 330, repetitions: 3,
          restBetween: 60, description: "3× 0.5 mi at threshold pace" },
        { type: "recovery", distance: 0.25, duration, pace: 10, power: 250,
          description: "Recoveries — 2× 60 sec relaxed jog (0.25 mi estimated total)" },
        { ...workout.segments[5], power: 250 },
      ] };
      const original = structuredClone(run);
      const steps = mapGarminWorkout(run, { ...options, target }).workoutSegments[0].workoutSteps;
      expect(steps.map((item) => item.stepType.stepTypeKey)).toEqual([
        "warmup", "interval", "recovery", "interval", "recovery", "interval", "cooldown",
      ]);
      expect(steps.filter((item) => item.stepType.stepTypeKey === "recovery")
        .map((item) => item.endConditionValue)).toEqual([60, 60]);
      expect(steps[1].endConditionValue).toBeCloseTo(0.5 * 1609.344);
      expect(steps[2].targetValueOne).toBeCloseTo(target === "power" ? 250 : 1609.344 / 600);
      expect(run).toEqual(original);
    }
  });
  it("accepts a legacy recovery distance rounded to zero without losing timed recovery", () => {
    const steps = mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", distance: 0.5, repetitions: 2, restBetween: 60, description: "2 reps" },
      { type: "recovery", distance: 0, pace: 10, description: "Recoveries — 1× 60 sec relaxed jog" },
    ] }, options).workoutSegments[0].workoutSteps;
    expect(steps.map((item) => item.endConditionValue)).toEqual([0.5 * 1609.344, 60, 0.5 * 1609.344]);
  });
  it("rejects conflicting recovery duration or a distance outside the planner's rounding", () => {
    for (const recovery of [
      { distance: 0.25, duration: 3 }, // Correct rounded distance must not mask conflicting time.
      { distance: 0.5 },
      { distance: 0.25, duration: NaN },
    ]) expect(() => mapGarminWorkout({ ...workout, segments: [
      { type: "threshold", distance: 0.5, repetitions: 3, restBetween: 60, description: "3 reps" },
      { type: "recovery", ...recovery, pace: 10, description: "Recoveries" },
    ] }, options)).toThrow("Ambiguous aggregate recovery");
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
