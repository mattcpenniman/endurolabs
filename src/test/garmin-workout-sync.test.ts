/** In-place edits, calendar moves and durable recovery after uncertain writes. */
import { describe, it, expect } from "vitest";
import { syncGarminWorkout } from "../lib/garmin/workout-sync";
import type { WorkoutSyncState, WorkoutSyncTransport, WorkoutSyncVersion } from "../lib/garmin/workout-sync";
import { mapGarminWorkout } from "../lib/garmin/workout-export";
import { resizeWorkout } from "../lib/training/workout-edit";
import type { Workout } from "../lib/training/models";

const workout: Workout = {
  id: "easy-w1", type: "easy", title: "Easy run", description: "Easy running", totalDistance: 5,
  weeklyMileageContribution: 5, estimatedDuration: 40, intensityCategory: "easy",
  segments: [{ type: "easy", distance: 5, pace: 8, description: "Easy" }],
};
function version(distance = 5, date = "2027-02-16"): WorkoutSyncVersion {
  return { payload: mapGarminWorkout(resizeWorkout(workout, distance, 40), { name: "EL stable", marker: `distance ${distance}` }), date, fingerprint: `${distance}:${date}` };
}
function fixture(initial = version()) {
  let state: WorkoutSyncState = { confirmed: { ...initial, workoutId: 42 } };
  let remote = { ...initial.payload, workoutId: 42 };
  let date = initial.date;
  const writes: string[] = [];
  const fail = { update: false, move: false, apply: true };
  const transport: WorkoutSyncTransport = {
    async get<T>(url: string): Promise<T> {
      if (url.includes("workoutScheduleByPeriod")) return (url.includes(`startDate=${date}&`)
        ? [{ workoutScheduleId: 101, workout: { workoutId: 42 }, calendarDate: date }] : []) as T;
      if (url.endsWith("/schedule/101")) return { workoutScheduleId: 101, workout: { workoutId: 42 }, calendarDate: date } as T;
      if (url.endsWith("/workout/42")) return remote as T;
      throw new Error(`Unexpected GET ${url}`);
    },
    async post<T>(): Promise<T> { throw new Error("Updates must not create or schedule duplicates"); },
    async put<T>(url: string, body: unknown): Promise<T> {
      writes.push(url);
      if (url.endsWith("/workout/42")) {
        expect(state.pending?.phase).toBe("updating");
        if (!fail.update || fail.apply) remote = body as typeof remote;
        if (fail.update) throw new Error("timeout");
      } else if (url.endsWith("/schedule/101")) {
        expect(state.pending?.phase).toBe("moving");
        if (!fail.move || fail.apply) date = (body as { calendarDate: string }).calendarDate;
        if (fail.move) throw new Error("timeout");
      } else throw new Error(`Unexpected PUT ${url}`);
      return {} as T;
    },
  };
  return {
    transport, writes, fail,
    journal: { read: async () => state, save: async (next: WorkoutSyncState) => { state = structuredClone(next); } },
    state: () => state,
    editRemotely: () => { remote = { ...remote, workoutName: "User edit" }; },
  };
}

describe("Durable Garmin workout updates", () => {
  it("updates distance in place, then repeats without writing", async () => {
    const f = fixture();
    await syncGarminWorkout(f.transport, f.journal, version(6));
    await syncGarminWorkout(f.transport, f.journal, version(6));
    expect(f.writes).toEqual([expect.stringContaining("/workout/42")]);
    expect(f.state().confirmed?.workoutId).toBe(42);
    expect(Date.parse(f.state().confirmed!.verifiedAt!)).toBeGreaterThan(0);
    expect(f.state().pending).toBeUndefined();
  });
  it("moves the existing schedule and keeps the workout ID", async () => {
    const f = fixture();
    const desired = version(6, "2027-02-18");
    await syncGarminWorkout(f.transport, f.journal, desired);
    await syncGarminWorkout(f.transport, f.journal, desired);
    expect(f.writes).toEqual([expect.stringContaining("/workout/42"), expect.stringContaining("/schedule/101")]);
    expect(f.state().confirmed?.date).toBe("2027-02-18");
  });
  it.each(["update", "move"] as const)("reconciles a successful but timed-out %s without replay", async (operation) => {
    const f = fixture(); f.fail[operation] = true;
    const desired = version(6, "2027-02-18");
    await expect(syncGarminWorkout(f.transport, f.journal, desired)).rejects.toThrow("timeout");
    f.fail[operation] = false;
    await syncGarminWorkout(f.transport, f.journal, desired);
    expect(f.writes).toHaveLength(2);
  });
  it.each(["update", "move"] as const)("blocks an unconfirmed %s and further edits", async (operation) => {
    const f = fixture(); f.fail[operation] = true; f.fail.apply = false;
    const desired = version(6, "2027-02-18");
    await expect(syncGarminWorkout(f.transport, f.journal, desired)).rejects.toThrow("timeout");
    const count = f.writes.length;
    await expect(syncGarminWorkout(f.transport, f.journal, desired)).rejects.toThrow("unresolved");
    await expect(syncGarminWorkout(f.transport, f.journal, version(7))).rejects.toThrow("previous sync");
    expect(f.writes).toHaveLength(count);
  });
  it("refuses to overwrite external Garmin edits", async () => {
    const f = fixture(); f.editRemotely();
    await expect(syncGarminWorkout(f.transport, f.journal, version(6))).rejects.toThrow("mismatch");
    expect(f.writes).toHaveLength(0);
  });
});

describe("Executable workout editing", () => {
  it("scales distance, totals and recoveries without changing targets", () => {
    const resized = resizeWorkout(workout, 6, 40);
    expect(resized.segments[0]).toMatchObject({ distance: 6, pace: 8 });
    expect(resized.estimatedDuration).toBe(48);
    expect(resized.weeklyMileageContribution).toBe(6);
    expect(workout.segments[0].distance).toBe(5);
  });
  it("converts distance steps to the requested executable duration", () => {
    const resized = resizeWorkout(workout, 5, 50);
    const mapped = mapGarminWorkout(resized, { name: "test", marker: "test" });
    expect(resized.segments[0].distance).toBeUndefined();
    expect(mapped.workoutSegments[0].workoutSteps[0]).toMatchObject({ endConditionValue: 3000, endCondition: { conditionTypeKey: "time" } });
  });
  it("keeps repeated work and aggregate recovery consistent after either resize", () => {
    const intervals: Workout = { ...workout, segments: [
      { type: "threshold", distance: 1, pace: 6, repetitions: 3, restBetween: 120, description: "3 reps" },
      { type: "recovery", distance: 0.5, pace: 8, description: "Recoveries" },
    ], estimatedDuration: 22, totalDistance: 3.5 };
    for (const resized of [resizeWorkout(intervals, 7, 22), resizeWorkout(intervals, 3.5, 44)]) {
      const steps = mapGarminWorkout(resized, { name: "test", marker: "test" }).workoutSegments[0].workoutSteps;
      expect(steps).toHaveLength(5);
      expect(steps[1].endConditionValue).toBe(240);
    }
  });
  it("rejects invalid and conflicting totals", () => {
    expect(() => resizeWorkout(workout, 0, 40)).toThrow("positive");
    expect(() => resizeWorkout(workout, 6, 50)).toThrow("either");
  });
});
